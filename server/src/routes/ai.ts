import express from 'express';
import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { GoogleGenAI } from '@google/genai';
import * as schema from '../db/schema.js';
import { pool, db } from '../db/client.js';
import { authenticateToken } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimiter.js';
import { guardChat, CircuitOpenError } from '../lib/aiGuard.js';

const router = express.Router();

let aiClient: GoogleGenAI | null = null;
try {
  if (process.env.GEMINI_API_KEY) {
    aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  } else {
    console.warn('GEMINI_API_KEY is not defined. AI features will not work.');
  }
} catch (e) {
  console.error('Failed to initialize GoogleGenAI', e);
}

const SYSTEM_INSTRUCTION = `Вы — профессиональный редактор и литературный соавтор.
Помогайте писателю с текстом: советы по стилистике, развитие сюжета, дописывание абзацев.
Отвечайте креативно и конструктивно, но ОЧЕНЬ ЛАКОНИЧНО (максимум 2-3 небольших абзаца).
Строго по делу, никакой воды.
У вас есть доступ к Библии истории — одобренным фактам о мире, персонажах и локациях.
Используйте их для точных, консистентных ответов. Никогда не противоречьте установленным фактам.`;

const isValidUUID = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a compact story-bible block from approved entities */
function buildStoryBibleContext(
  entities: (typeof schema.storyEntities.$inferSelect)[]
): string {
  if (entities.length === 0) return '';

  const sections: Record<string, string[]> = {
    character: [],
    location: [],
    item: [],
    rule: [],
  };

  for (const e of entities) {
    const line = e.description ? `- ${e.name}: ${e.description}` : `- ${e.name}`;
    if (sections[e.type]) sections[e.type].push(line);
  }

  const parts: string[] = [];
  if (sections.character.length) parts.push(`ПЕРСОНАЖИ:\n${sections.character.join('\n')}`);
  if (sections.location.length)  parts.push(`ЛОКАЦИИ:\n${sections.location.join('\n')}`);
  if (sections.item.length)      parts.push(`ПРЕДМЕТЫ:\n${sections.item.join('\n')}`);
  if (sections.rule.length)      parts.push(`ПРАВИЛА МИРА:\n${sections.rule.join('\n')}`);

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

/** Embed a query string for retrieval (RETRIEVAL_QUERY task type) */
async function embedQuery(text: string): Promise<number[] | null> {
  if (!aiClient) return null;
  try {
    const result = await (aiClient.models as any).embedContent({
      model: 'text-embedding-004',
      content: text,
      config: { taskType: 'RETRIEVAL_QUERY' },
    });
    return result.embedding?.values ?? null;
  } catch (e) {
    console.warn('embedQuery failed:', e);
    return null;
  }
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

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────
// Body: { message, chapterContent, projectId, chapterId? }
// Returns: { text }
//
// Context layering:
//   1. Story bible (approved entities)  → injected as first user+model turn
//   2. Chapter content                  → appended to context block
//   3. Recent chat history from DB      → replayed as multi-turn conversation
//   4. Current user message             → last user turn
// ─────────────────────────────────────────────────────────────────────────────
router.post('/chat',
  authenticateToken,
  rateLimit('ai:chat', 40, 60 * 60 * 1000),   // 40 per hour
  async (req: any, res) => {
  try {
    if (!aiClient) return res.status(503).json({ error: 'AI service is not configured' });

    const { message, chapterContent, projectId, chapterId } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }

    const validProjectId  = projectId && isValidUUID(projectId)   ? (projectId as string)  : null;
    const validChapterId  = chapterId && isValidUUID(chapterId)   ? (chapterId as string)  : null;

    // 1. Load story bible — verify ownership before reading entities
    let entities: (typeof schema.storyEntities.$inferSelect)[] = [];
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
    }

    // 2. Load chat history
    const history = validProjectId
      ? await loadHistory(req.user.userId, validProjectId, validChapterId)
      : [];

    // 3. Semantic retrieval — find relevant manuscript chunks for the user's query
    let semanticBlock = '';
    if (validProjectId) {
      const queryVec = await embedQuery(message.trim());
      if (queryVec) {
        const chunks = await retrieveSemanticChunks(req.user.userId, validProjectId, queryVec);
        if (chunks.length > 0) {
          semanticBlock = `=== РЕЛЕВАНТНЫЕ ФРАГМЕНТЫ РУКОПИСИ ===\n${chunks.map((c, i) => `[${i + 1}] ${c}`).join('\n\n')}`;
        }
      }
    }

    // 4. Build the context block (bible + semantic chunks + chapter)
    const bibleBlock   = buildStoryBibleContext(entities);
    const chapterBlock = `=== ТЕКУЩАЯ ГЛАВА ===\n${chapterContent?.trim() || '(пока пусто)'}`;
    const contextBlock = [bibleBlock, semanticBlock, chapterBlock].filter(Boolean).join('\n\n');

    // 5. Assemble Gemini multi-turn contents array
    type GeminiContent = { role: string; parts: { text: string }[] };
    const contents: GeminiContent[] = [];

    // Inject context as the first turn so it's always available throughout the conversation
    contents.push(
      { role: 'user',  parts: [{ text: `Вот контекст для нашей работы:\n\n${contextBlock}` }] },
      { role: 'model', parts: [{ text: 'Контекст получен. Готов помогать с учётом Библии истории и текущей главы.' }] }
    );

    // Replay persisted history
    for (const msg of history) {
      contents.push({
        role:  msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }],
      });
    }

    // Current user message
    const userText = message.trim() as string;
    contents.push({ role: 'user', parts: [{ text: userText }] });

    // 6. Persist user message before calling AI (don't lose it on timeout)
    if (validProjectId) {
      await saveMessage(req.user.userId, validProjectId, validChapterId, 'user', userText);
    }

    // 7. Call Gemini — wrapped in timeout + circuit breaker + cost logging
    const response = await guardChat(
      () => aiClient!.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: contents as any,
        config: { systemInstruction: SYSTEM_INSTRUCTION, temperature: 0.7 },
      }),
      { userId: req.user.userId, projectId: validProjectId, route: 'ai:chat' }
    );

    const aiText = response.text ?? '';

    // 8. Persist AI response
    if (validProjectId) {
      await saveMessage(req.user.userId, validProjectId, validChapterId, 'model', aiText);
    }

    res.json({ text: aiText });
  } catch (error: any) {
    console.error('Error in POST /ai/chat:', error);
    if (error?.isCircuitOpen) {
      return res.status(503).json({ error: 'AI сервис временно недоступен. Попробуйте через минуту.' });
    }
    if (error?.message?.includes('Timeout')) {
      return res.status(504).json({ error: 'AI сервис не ответил вовремя. Попробуйте ещё раз.' });
    }
    res.status(500).json({ error: 'Failed to generate AI response' });
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
  async (req: any, res) => {
  try {
    if (!aiClient) return res.status(503).json({ error: 'AI service is not configured' });

    const { projectId, chapterContent } = req.body;

    if (!projectId || !isValidUUID(projectId)) {
      return res.status(400).json({ error: 'Valid projectId is required' });
    }
    if (!chapterContent?.trim()) {
      return res.status(400).json({ error: 'chapterContent is required' });
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

    const storyBible = buildStoryBibleContext(entities);

    const prompt = `Ты — редактор, проверяющий консистентность текста.

${storyBible}

=== ТЕКСТ ГЛАВЫ ===
${chapterContent.trim()}

=== ЗАДАЧА ===
Найди ТОЛЬКО фактические противоречия между текстом главы и Библией истории.
Ищи: несоответствия в описании персонажей, локаций, предметов; нарушение правил мира.
НЕ комментируй стиль, орфографию, сюжетные решения или то, чего нет в Библии.
Если противоречий нет — верни пустой массив.

Верни ТОЛЬКО валидный JSON-массив без markdown-обёртки:
[
  { "entity": "Имя сущности из Библии", "issue": "Краткое описание противоречия", "severity": "low|medium|high" }
]`;

    const response = await aiClient.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { temperature: 0.1 },
    });

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

export default router;
