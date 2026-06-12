import express from 'express';
import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '../db/schema.js';
import { pool, db } from '../db/client.js';
import { authenticateToken } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimiter.js';
import { guardChat, CircuitOpenError } from '../lib/aiGuard.js';
import { getAIProvider, getEmbeddingProvider, type ChatTurn } from '../lib/aiProvider.js';
import { aiQuota, getQuotaStatus } from '../lib/quota.js';

// ── Input schemas ─────────────────────────────────────────────────────────────

const ChatSchema = z.object({
  message:        z.string().min(1, 'message is required').max(10_000, 'message too long'),
  chapterContent: z.string().max(500_000).optional(),
  projectId:      z.string().optional(),
  chapterId:      z.string().optional(),
});

const ConsistencySchema = z.object({
  projectId:      z.string().min(1, 'projectId is required'),
  chapterContent: z.string().min(1, 'chapterContent is required').max(500_000),
});

const DictationSchema = z.object({
  rawText:        z.string().min(1, 'rawText is required').max(20_000),
  chapterContent: z.string().max(500_000).optional(),
  projectId:      z.string().optional(),
  chapterId:      z.string().optional(),
});

const TransformSchema = z.object({
  text:      z.string().min(1, 'text is required').max(50_000),
  action:    z.string().min(1, 'action is required'),
  projectId: z.string().optional(),
});

const router = express.Router();

const ai = getAIProvider();

const SYSTEM_INSTRUCTION = `Вы — профессиональный редактор и литературный соавтор.
Помогайте писателю с текстом: советы по стилистике, развитие сюжета, дописывание абзацев.
Отвечайте креативно и конструктивно, но ОЧЕНЬ ЛАКОНИЧНО (максимум 2-3 небольших абзаца).
Строго по делу, никакой воды.
У вас есть доступ к Библии истории — одобренным фактам о мире, персонажах и локациях.
Используйте их для точных, консистентных ответов. Никогда не противоречьте установленным фактам.`;

const DICTATION_SYSTEM_INSTRUCTION = `Вы — невидимый слой постобработки диктовки для писателя.
Ваша задача: превратить сырой фрагмент голосового ввода в чистый литературный текст.

Правила:
- Верните ТОЛЬКО итоговый текст без пояснений, кавычек, markdown и комментариев.
- Исправляйте пунктуацию, регистр, очевидные огрехи распознавания речи и повторы.
- Сохраняйте исходный смысл, не переписывайте содержание заново.
- Если в контексте Библии истории или текущей рукописи есть каноническое имя/термин, используйте именно его.
- Не выдумывайте новых фактов.
- Если фрагмент уже выглядит нормально, верните его почти без изменений.
- Не добавляйте вводных фраз вроде "Вот исправленный текст".`;

const isValidUUID = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Key character attributes worth surfacing to the AI (token-capped). */
const CONTEXT_ATTRIBUTE_LABELS: Record<string, string> = {
  speech:      'Речь',
  motivations: 'Мотивация',
  secrets:     'Секреты',
};
const CONTEXT_ATTRIBUTE_MAX_CHARS = 160;

/** Build a compact story-bible block from approved entities (+ optional relations). */
function buildStoryBibleContext(
  entities: (typeof schema.storyEntities.$inferSelect)[],
  links: (typeof schema.entityLinks.$inferSelect)[] = [],
): string {
  if (entities.length === 0) return '';

  const sections: Record<string, string[]> = {
    character: [],
    location: [],
    item: [],
    rule: [],
  };

  for (const e of entities) {
    let line = e.description ? `- ${e.name}: ${e.description}` : `- ${e.name}`;
    // Для персонажей добавляем поля, критичные для консистентности текста
    if (e.type === 'character' && e.attributes && typeof e.attributes === 'object') {
      const attrs = e.attributes as Record<string, unknown>;
      for (const [key, label] of Object.entries(CONTEXT_ATTRIBUTE_LABELS)) {
        const value = attrs[key];
        if (typeof value === 'string' && value.trim()) {
          line += `\n  · ${label}: ${value.trim().slice(0, CONTEXT_ATTRIBUTE_MAX_CHARS)}`;
        }
      }
    }
    if (sections[e.type]) sections[e.type].push(line);
  }

  const parts: string[] = [];
  if (sections.character.length) parts.push(`ПЕРСОНАЖИ:\n${sections.character.join('\n')}`);
  if (sections.location.length)  parts.push(`ЛОКАЦИИ:\n${sections.location.join('\n')}`);
  if (sections.item.length)      parts.push(`ПРЕДМЕТЫ:\n${sections.item.join('\n')}`);
  if (sections.rule.length)      parts.push(`ПРАВИЛА МИРА:\n${sections.rule.join('\n')}`);

  // Связи между сущностями («Имя → тип связи → Имя»)
  if (links.length > 0) {
    const nameById = new Map(entities.map(e => [e.id, e.name]));
    const relLines = links
      .map(l => {
        const from = nameById.get(l.sourceEntityId);
        const to   = nameById.get(l.targetEntityId);
        return from && to ? `- ${from} → ${l.relation} → ${to}` : null;
      })
      .filter((s): s is string => Boolean(s));
    if (relLines.length) parts.push(`СВЯЗИ:\n${relLines.join('\n')}`);
  }

  return parts.length
    ? `=== БИБЛИЯ ИСТОРИИ (установленные факты) ===\n${parts.join('\n\n')}`
    : '';
}

/** Load last N messages for a project+chapter, oldest-first */
async function loadHistory(
  userId: string,
  projectId: string,
  chapterId: string | null,
  limit = 20
): Promise<(typeof schema.chatHistory.$inferSelect)[]> {
  try {
    const rows = await db
      .select()
      .from(schema.chatHistory)
      .where(
        and(
          eq(schema.chatHistory.userId, userId),
          eq(schema.chatHistory.projectId, projectId),
          chapterId
            ? eq(schema.chatHistory.chapterId, chapterId)
            : isNull(schema.chatHistory.chapterId)
        )
      )
      .orderBy(desc(schema.chatHistory.timestamp))
      .limit(limit);

    return rows.reverse(); // chronological for Gemini
  } catch (e: any) {
    // Graceful fallback if table doesn't exist yet (run 0001_memory_tables.sql)
    if (e?.code !== '42P01') console.error('Failed to load chat history:', e);
    return [];
  }
}

/** Persist a single message; silently skips if table missing */
async function saveMessage(
  userId: string,
  projectId: string,
  chapterId: string | null,
  role: string,
  content: string
): Promise<void> {
  try {
    await db.insert(schema.chatHistory).values({
      userId,
      projectId,
      chapterId: chapterId ?? undefined,
      role,
      content,
    });
  } catch (e: any) {
    if (e?.code !== '42P01') console.error('Failed to save chat message:', e);
  }
}

// ─── Semantic Retrieval ───────────────────────────────────────────────────────

/** Embed a query string for retrieval */
async function embedQuery(text: string): Promise<number[] | null> {
  const embedder = getEmbeddingProvider();
  if (!embedder) return null;
  return embedder.embed(text, 'query');
}

/** Retrieve top-k semantically relevant chunks for a query in a project */
async function retrieveSemanticChunks(
  userId: string,
  projectId: string,
  queryVec: number[],
  topK = 5
): Promise<string[]> {
  try {
    const vecStr = `[${queryVec.join(',')}]`;
    const rows = await pool.query<{ chunk_text: string }>(
      `SELECT chunk_text
         FROM semantic_memory
        WHERE project_id = $1
          AND user_id    = $2
          AND embedding  IS NOT NULL
        ORDER BY embedding <=> $3::vector
        LIMIT $4`,
      [projectId, userId, vecStr, topK]
    );
    return rows.rows.map(r => r.chunk_text);
  } catch (e: any) {
    // Gracefully skip if pgvector not installed or table missing
    if (!['42P01', '42703', '42883'].includes(e?.code)) {
      console.warn('Semantic retrieval failed:', e?.message ?? e);
    }
    return [];
  }
}

function cleanAiPlainText(text: string): string {
  return (text ?? '')
    .replace(/```(?:json)?\n?/g, '')
    .replace(/```\n?/g, '')
    .replace(/^["'«»]+|["'«»]+$/g, '')
    .trim();
}

// ─── Shared: build provider-agnostic multi-turn contents for chat ────────────
// Used by both /chat (non-streaming) and /chat/stream (SSE).
// Returns null if access is denied (caller should respond with 403).
// ─────────────────────────────────────────────────────────────────────────────

async function buildChatContents(
  userId: string,
  message: string,
  chapterContent: string | undefined,
  validProjectId: string | null,
  validChapterId: string | null,
): Promise<ChatTurn[] | null> {
  let entities: (typeof schema.storyEntities.$inferSelect)[] = [];
  let entityLinks: (typeof schema.entityLinks.$inferSelect)[] = [];
  if (validProjectId) {
    const projectRows = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(and(eq(schema.projects.id, validProjectId), eq(schema.projects.userId, userId)));
    if (projectRows.length === 0) return null; // access denied

    entities = await db
      .select()
      .from(schema.storyEntities)
      .where(and(
        eq(schema.storyEntities.projectId, validProjectId),
        eq(schema.storyEntities.status, 'approved'),
      ));
    entityLinks = await db
      .select()
      .from(schema.entityLinks)
      .where(eq(schema.entityLinks.projectId, validProjectId));
  }

  const history = validProjectId
    ? await loadHistory(userId, validProjectId, validChapterId)
    : [];

  let semanticBlock = '';
  if (validProjectId) {
    const queryVec = await embedQuery(message.trim());
    if (queryVec) {
      const chunks = await retrieveSemanticChunks(userId, validProjectId, queryVec);
      if (chunks.length > 0) {
        semanticBlock = `=== РЕЛЕВАНТНЫЕ ФРАГМЕНТЫ РУКОПИСИ ===\n${chunks.map((c, i) => `[${i + 1}] ${c}`).join('\n\n')}`;
      }
    }
  }

  const bibleBlock   = buildStoryBibleContext(entities, entityLinks);
  const chapterBlock = `=== ТЕКУЩАЯ ГЛАВА ===\n<chapter_content>\n${chapterContent?.trim() || '(пока пусто)'}\n</chapter_content>`;
  const contextBlock = [bibleBlock, semanticBlock, chapterBlock].filter(Boolean).join('\n\n');

  const contents: ChatTurn[] = [
    { role: 'user',  text: `Вот контекст для нашей работы:\n\n${contextBlock}` },
    { role: 'model', text: 'Контекст получен. Готов помогать с учётом Библии истории и текущей главы.' },
  ];

  for (const msg of history) {
    contents.push({ role: msg.role === 'user' ? 'user' : 'model', text: msg.content });
  }
  contents.push({ role: 'user', text: message.trim() });

  return contents;
}

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────
// Body: { message, chapterContent, projectId, chapterId? }
// Returns: { text }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/chat',
  authenticateToken,
  rateLimit('ai:chat', 40, 60 * 60 * 1000),
  aiQuota,
  async (req: any, res) => {
  try {
    if (!ai) return res.status(503).json({ error: 'AI service is not configured' });

    const parsed = ChatSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message });
    const { message, chapterContent, projectId, chapterId } = parsed.data;

    const validProjectId = projectId && isValidUUID(projectId) ? projectId : null;
    const validChapterId = chapterId && isValidUUID(chapterId) ? chapterId : null;
    const userText       = message.trim();

    const contents = await buildChatContents(
      req.user.userId, userText, chapterContent, validProjectId, validChapterId,
    );
    if (contents === null) return res.status(403).json({ error: 'Access denied' });

    if (validProjectId) await saveMessage(req.user.userId, validProjectId, validChapterId, 'user', userText);

    const response = await guardChat(
      () => ai.generate({
        contents,
        system: SYSTEM_INSTRUCTION,
        temperature: 0.7,
      }),
      { userId: req.user.userId, projectId: validProjectId, route: 'ai:chat' }
    );

    const aiText = response.text ?? '';
    if (validProjectId) await saveMessage(req.user.userId, validProjectId, validChapterId, 'model', aiText);

    res.json({ text: aiText });
  } catch (error: any) {
    console.error('Error in POST /ai/chat:', error);
    if (error?.isCircuitOpen)             return res.status(503).json({ error: 'AI сервис временно недоступен. Попробуйте через минуту.' });
    if (error?.message?.includes('Timeout')) return res.status(504).json({ error: 'AI сервис не ответил вовремя. Попробуйте ещё раз.' });
    res.status(500).json({ error: 'Failed to generate AI response' });
  }
});

// ─── POST /api/ai/chat/stream ─────────────────────────────────────────────────
// SSE streaming version of /chat.
// Body: same as /chat
// Response: text/event-stream
//   data: {"text":"chunk"}   — incremental text
//   data: [DONE]             — stream complete
//   data: {"error":"..."}    — stream error
// ─────────────────────────────────────────────────────────────────────────────
router.post('/chat/stream',
  authenticateToken,
  rateLimit('ai:chat', 40, 60 * 60 * 1000),
  aiQuota,
  async (req: any, res) => {
    if (!ai) return res.status(503).json({ error: 'AI service is not configured' });

    const parsed = ChatSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message });
    const { message, chapterContent, projectId, chapterId } = parsed.data;

    const validProjectId = projectId && isValidUUID(projectId) ? projectId : null;
    const validChapterId = chapterId && isValidUUID(chapterId) ? chapterId : null;
    const userText       = message.trim();

    // Prepare SSE headers before async work so the connection stays open
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // prevent nginx buffering
    res.flushHeaders();

    const send = (data: string) => res.write(`data: ${data}\n\n`);
    const sendJson = (obj: object) => send(JSON.stringify(obj));

    try {
      const contents = await buildChatContents(
        req.user.userId, userText, chapterContent, validProjectId, validChapterId,
      );
      if (contents === null) {
        sendJson({ error: 'Access denied' });
        return res.end();
      }

      if (validProjectId) await saveMessage(req.user.userId, validProjectId, validChapterId, 'user', userText);

      // Abort the stream if the AI provider doesn't complete within 45 seconds
      const abortController = new AbortController();
      const streamTimeout = setTimeout(() => abortController.abort(), 45_000);

      const stream = ai.generateStream({
        contents,
        system: SYSTEM_INSTRUCTION,
        temperature: 0.7,
      });

      let fullText = '';
      try {
        for await (const text of stream) {
          if (abortController.signal.aborted) break;
          if (text) {
            fullText += text;
            sendJson({ text });
          }
        }
      } finally {
        clearTimeout(streamTimeout);
      }

      if (abortController.signal.aborted) {
        sendJson({ error: 'Превышено время ожидания ответа AI.' });
        return res.end();
      }

      if (validProjectId && fullText) {
        await saveMessage(req.user.userId, validProjectId, validChapterId, 'model', fullText);
      }

      send('[DONE]');
      res.end();
    } catch (error: any) {
      console.error('Error in POST /ai/chat/stream:', error);
      sendJson({ error: 'Ошибка генерации. Попробуйте ещё раз.' });
      res.end();
    }
  }
);

// ─── GET /api/ai/quota ───────────────────────────────────────────────────────
// Returns: { plan, used, limit, remaining, resetsAt }
// Для отображения остатка AI-действий в интерфейсе.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/quota', authenticateToken, async (req: any, res) => {
  try {
    const status = await getQuotaStatus(req.user.userId);
    res.json(status);
  } catch (error) {
    console.error('Error in GET /ai/quota:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/ai/history ─────────────────────────────────────────────────────
// Query: projectId (required), chapterId (optional)
// Returns: { messages: { id, role, text, timestamp }[] }
// ─────────────────────────────────────────────────────────────────────────────
router.get('/history', authenticateToken, async (req: any, res) => {
  try {
    const { projectId, chapterId } = req.query as {
      projectId?: string;
      chapterId?: string;
    };

    if (!projectId || !isValidUUID(projectId)) {
      return res.status(400).json({ error: 'Valid projectId is required' });
    }

    const validChapterId = chapterId && isValidUUID(chapterId) ? chapterId : null;
    const rows = await loadHistory(req.user.userId, projectId, validChapterId, 60);

    res.json({
      messages: rows.map(r => ({
        id:        r.id,
        role:      r.role,
        text:      r.content,
        timestamp: r.timestamp,
      })),
    });
  } catch (error) {
    console.error('Error in GET /ai/history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/ai/consistency ─────────────────────────────────────────────────
// Body: { projectId, chapterContent }
// Returns: { issues: { entity, issue, severity }[] }
//
// Asks Gemini to compare the chapter text against approved story-bible entities
// and return a structured list of contradictions.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/consistency',
  authenticateToken,
  rateLimit('ai:consistency', 15, 60 * 60 * 1000), // 15 per hour
  aiQuota,
  async (req: any, res) => {
  try {
    if (!ai) return res.status(503).json({ error: 'AI service is not configured' });

    const parsed = ConsistencySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message });
    const { projectId, chapterContent } = parsed.data;

    if (!isValidUUID(projectId)) {
      return res.status(400).json({ error: 'Valid projectId is required' });
    }

    // Authorization: verify the user owns this project
    const projectRows = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, req.user.userId)));
    if (projectRows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const entities = await db
      .select()
      .from(schema.storyEntities)
      .where(
        and(
          eq(schema.storyEntities.projectId, projectId),
          eq(schema.storyEntities.status, 'approved')
        )
      );

    if (entities.length === 0) {
      return res.json({
        issues: [],
        note: 'Нет одобренных сущностей для проверки — одобрите факты в Библии истории.',
      });
    }

    const consistencyLinks = await db
      .select()
      .from(schema.entityLinks)
      .where(eq(schema.entityLinks.projectId, projectId));

    const storyBible = buildStoryBibleContext(entities, consistencyLinks);

    const prompt = `Ты — редактор, проверяющий консистентность текста.

${storyBible}

=== ТЕКСТ ГЛАВЫ ===
<chapter_content>
${chapterContent.trim()}
</chapter_content>

=== ЗАДАЧА ===
Найди ТОЛЬКО фактические противоречия между текстом главы и Библией истории.
Ищи: несоответствия в описании персонажей, локаций, предметов; нарушение правил мира.
НЕ комментируй стиль, орфографию, сюжетные решения или то, чего нет в Библии.
Если противоречий нет — верни пустой массив.

Верни ТОЛЬКО валидный JSON-массив без markdown-обёртки:
[
  { "entity": "Имя сущности из Библии", "issue": "Краткое описание противоречия", "severity": "low|medium|high" }
]`;

    const response = await guardChat(
      () => ai.generate({ contents: prompt, temperature: 0.1 }),
      { userId: req.user.userId, projectId, route: 'ai:consistency' }
    );

    const raw     = response.text ?? '[]';
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let issues: { entity: string; issue: string; severity: string }[] = [];
    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) issues = parsed;
    } catch {
      // AI returned malformed JSON — treat as no issues found
    }

    res.json({ issues });
  } catch (error) {
    console.error('Error in POST /ai/consistency:', error);
    res.status(500).json({ error: 'Failed to check consistency' });
  }
});

// ─── POST /api/ai/dictation/normalize ────────────────────────────────────────
// Body: { rawText, chapterContent, projectId?, chapterId? }
// Returns: { text }
//
// Converts raw speech-recognition output into punctuated text and normalizes
// names/terms against the Story Bible and current manuscript context.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/dictation/normalize',
  authenticateToken,
  rateLimit('ai:dictation', 120, 60 * 60 * 1000),
  aiQuota,
  async (req: any, res) => {
    try {
      if (!ai) return res.status(503).json({ error: 'AI service is not configured' });

      const bodyParsed = DictationSchema.safeParse(req.body);
      if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.errors[0]?.message });
      const { rawText, chapterContent, projectId, chapterId } = bodyParsed.data;

      const input = rawText.trim();
      const validProjectId = projectId && isValidUUID(projectId) ? projectId : null;
      const validChapterId = chapterId && isValidUUID(chapterId) ? chapterId : null;

      let entities: (typeof schema.storyEntities.$inferSelect)[] = [];
      let semanticBlock = '';

      if (validProjectId) {
        const projectRows = await db
          .select({ id: schema.projects.id })
          .from(schema.projects)
          .where(and(eq(schema.projects.id, validProjectId), eq(schema.projects.userId, req.user.userId)));

        if (projectRows.length === 0) {
          return res.status(403).json({ error: 'Access denied' });
        }

        entities = await db
          .select()
          .from(schema.storyEntities)
          .where(
            and(
              eq(schema.storyEntities.projectId, validProjectId),
              eq(schema.storyEntities.status, 'approved')
            )
          );

        const queryVec = await embedQuery(input);
        if (queryVec) {
          const chunks = await retrieveSemanticChunks(req.user.userId, validProjectId, queryVec, 3);
          if (chunks.length > 0) {
            semanticBlock = `=== РЕЛЕВАНТНЫЕ ФРАГМЕНТЫ РУКОПИСИ ===\n${chunks.map((c, i) => `[${i + 1}] ${c}`).join('\n\n')}`;
          }
        }
      }

      const recentHistory = validProjectId
        ? await loadHistory(req.user.userId, validProjectId, validChapterId, 6)
        : [];

      const historyBlock = recentHistory.length
        ? `=== НЕДАВНИЙ КОНТЕКСТ РАБОТЫ ===\n${recentHistory.map(m => `${m.role === 'user' ? 'Автор' : 'ИИ'}: ${m.content}`).join('\n')}`
        : '';

      const bibleBlock = buildStoryBibleContext(entities);
      const chapterBlock = chapterContent?.trim()
        ? `=== ТЕКУЩАЯ ГЛАВА ===\n${chapterContent.trim()}`
        : '';

      const prompt = [
        bibleBlock,
        semanticBlock,
        historyBlock,
        chapterBlock,
        `=== СЫРОЙ ФРАГМЕНТ ДИКТОВКИ ===\n${input}`,
        `=== ЗАДАЧА ===
Преобразуйте сырой фрагмент диктовки в чистый текст для вставки в рукопись.
Расставьте уместные знаки препинания, нормализуйте регистр и исправьте очевидные ошибки распознавания речи.
Если в контексте уже есть каноническое имя, термин, локация или предмет, используйте именно это написание.
Верните только итоговый текст без пояснений.`
      ]
        .filter(Boolean)
        .join('\n\n');

      const response = await guardChat(
        () => ai.generate({
          contents: prompt,
          system: DICTATION_SYSTEM_INSTRUCTION,
          temperature: 0.15,
        }),
        { userId: req.user.userId, projectId: validProjectId, route: 'ai:dictation' }
      );

      const text = cleanAiPlainText(response.text ?? '') || input;
      res.json({ text });
    } catch (error: any) {
      console.error('Error in POST /ai/dictation/normalize:', error);
      if (error?.isCircuitOpen) {
        return res.status(503).json({ error: 'AI сервис временно недоступен. Попробуйте через минуту.' });
      }
      if (error?.message?.includes('Timeout')) {
        return res.status(504).json({ error: 'AI сервис не ответил вовремя. Попробуйте ещё раз.' });
      }
      res.status(500).json({ error: 'Failed to normalize dictation' });
    }
  }
);

// ─── POST /api/ai/transform ──────────────────────────────────────────────────
// Lightweight inline text transformation — no chat history, no multi-turn.
// Used by the editor's inline bubble menu when the writer selects text and
// clicks a quick action.
//
// Body: { text, action, projectId? }
//   action: 'denser' | 'shorten' | 'dialogue' | 'conflict' | 'rewrite'
// Returns: { result }
// ─────────────────────────────────────────────────────────────────────────────

const TRANSFORM_PROMPTS: Record<string, (text: string) => string> = {
  denser: (text) =>
    `Сделай этот фрагмент плотнее и насыщеннее. Убери воду, длинноты и слабые слова. Сохрани смысл и стиль, но каждое слово должно работать. Верни только результат без пояснений.\n\n<fragment>\n${text}\n</fragment>`,

  shorten: (text) =>
    `Сократи этот фрагмент примерно вдвое, сохранив весь смысл и тон. Убирай повторения, лишние прилагательные, очевидные объяснения. Верни только результат без пояснений.\n\n<fragment>\n${text}\n</fragment>`,

  dialogue: (text) =>
    `Сделай этот диалог живее и естественнее. Реплики должны звучать как настоящая речь — с паузами, незаконченными мыслями, характером. Сохрани суть разговора. Верни только результат без пояснений.\n\n<fragment>\n${text}\n</fragment>`,

  conflict: (text) =>
    `Усиль конфликт в этом фрагменте. Подними ставки, добавь напряжение, сделай столкновение острее — но органично. Верни только результат без пояснений.\n\n<fragment>\n${text}\n</fragment>`,

  rewrite: (text) =>
    `Перепиши этот фрагмент свежим взглядом. Другие слова, другой ритм предложений, но тот же смысл и настроение. Верни только результат без пояснений.\n\n<fragment>\n${text}\n</fragment>`,

  expand: (text) =>
    `Разверни этот фрагмент подробнее. Добавь деталей, ощущений, атмосферы — органично, в том же стиле. Верни только результат без пояснений.\n\n<fragment>\n${text}\n</fragment>`,
};

router.post('/transform',
  authenticateToken,
  rateLimit('ai:transform', 60, 60 * 60 * 1000),  // 60 per hour
  aiQuota,
  async (req: any, res) => {
    try {
      if (!ai) return res.status(503).json({ error: 'AI service is not configured' });

      const bodyParsed = TransformSchema.safeParse(req.body);
      if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.errors[0]?.message });
      const { text, action, projectId } = bodyParsed.data;

      if (!TRANSFORM_PROMPTS[action]) {
        return res.status(400).json({ error: `Unknown action. Valid: ${Object.keys(TRANSFORM_PROMPTS).join(', ')}` });
      }

      // Optionally load story bible for name/term consistency
      let bibleBlock = '';
      const validProjectId = projectId && isValidUUID(projectId) ? projectId : null;
      if (validProjectId) {
        const projectRows = await db
          .select({ id: schema.projects.id })
          .from(schema.projects)
          .where(and(eq(schema.projects.id, validProjectId), eq(schema.projects.userId, req.user.userId)));

        if (projectRows.length > 0) {
          const entities = await db
            .select()
            .from(schema.storyEntities)
            .where(and(
              eq(schema.storyEntities.projectId, validProjectId),
              eq(schema.storyEntities.status, 'approved'),
            ));
          bibleBlock = buildStoryBibleContext(entities);
        }
      }

      const promptText = TRANSFORM_PROMPTS[action](text.trim());
      const fullPrompt = bibleBlock
        ? `${bibleBlock}\n\nПри редактуре используй имена и термины из Библии истории.\n\n${promptText}`
        : promptText;

      const response = await guardChat(
        () => ai.generate({ contents: fullPrompt, temperature: 0.55 }),
        { userId: req.user.userId, projectId: validProjectId, route: 'ai:transform' }
      );

      const result = cleanAiPlainText(response.text ?? '') || text.trim();
      res.json({ result });
    } catch (error: any) {
      console.error('Error in POST /ai/transform:', error);
      if (error?.isCircuitOpen) {
        return res.status(503).json({ error: 'AI временно недоступен. Попробуйте через минуту.' });
      }
      res.status(500).json({ error: 'Failed to transform text' });
    }
  }
);

export default router;
