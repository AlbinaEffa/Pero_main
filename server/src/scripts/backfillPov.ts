/**
 * Книжный резолв POV для глав проекта (CLI-обёртка над общей логикой Фазы 3).
 * Запуск: npx tsx src/scripts/backfillPov.ts <projectId> [--all]
 *
 * Детерминированно (без AI): служебные → «Автор»; структурные/третье лицо → POV null
 * (рассказчика-персонажа нет). Фокусный AI-детект имени рассказчика тратится ТОЛЬКО на
 * narrative-главы от первого лица. По умолчанию заполняет лишь пустые POV; --all перепроверяет все.
 *
 * Тот же конвейер живёт в эндпоинте POST /api/bible/:projectId/resolve-pov (продуктовый триггер).
 */
import 'dotenv/config';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { eq, asc } from 'drizzle-orm';
import { sanitizePov } from '../lib/extraction.js';
import { AUTHOR_POV } from '../lib/chapterPov.js';
import { classifyChapterPov, buildPovDetectPrompt } from '../lib/povResolution.js';

const projectId = process.argv[2];
const resolveAll = process.argv.includes('--all');
if (!projectId) { console.error('usage: backfillPov.ts <projectId> [--all]'); process.exit(1); }

const BASE = (process.env.AI_BASE_URL || 'https://api.moonshot.ai/v1').replace(/\/+$/, '');
const KEY = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '';
const MODEL = process.env.AI_MODEL || 'moonshot-v1-32k';
const CONCURRENCY = 5;

function strip(html: string): string {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
}

async function detectPov(text: string): Promise<string | null> {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, temperature: 0.1, messages: [{ role: 'user', content: buildPovDetectPrompt(text) }] }),
  });
  if (!r.ok) { console.warn('AI', r.status); return null; }
  const d: any = await r.json();
  const raw = d?.choices?.[0]?.message?.content ?? '';
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    return sanitizePov(JSON.parse(m ? m[0] : raw).pov);
  } catch { return null; }
}

async function main() {
  const chapters = await db
    .select({ id: schema.chapters.id, title: schema.chapters.title, content: schema.chapters.content,
              chapterType: schema.chapters.chapterType, povCharacter: schema.chapters.povCharacter })
    .from(schema.chapters).where(eq(schema.chapters.projectId, projectId))
    .orderBy(asc(schema.chapters.order));

  let byAuthor = 0, none = 0, already = 0;
  const toDetect: { id: string; text: string }[] = [];
  for (const c of chapters) {
    if (!resolveAll && c.povCharacter) { already++; continue; }
    const text = strip(c.content ?? '');
    const { plan } = classifyChapterPov({ chapterType: c.chapterType, text });
    if (plan === 'author') {
      await db.update(schema.chapters).set({ povCharacter: AUTHOR_POV }).where(eq(schema.chapters.id, c.id));
      byAuthor++;
    } else if (plan === 'none') {
      none++;
    } else {
      toDetect.push({ id: c.id, text });
    }
  }
  console.log(`детерминированно: служебные→«Автор» ${byAuthor}, структурные/3-е лицо ${none}, уже с POV ${already}`);
  console.log(`AI-детект рассказчика нужен для: ${toDetect.length} глав (первое лицо)`);

  let set = 0, done = 0;
  for (let i = 0; i < toDetect.length; i += CONCURRENCY) {
    const batch = toDetect.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async ({ id, text }) => {
      const pov = await detectPov(text);
      if (pov) { await db.update(schema.chapters).set({ povCharacter: pov }).where(eq(schema.chapters.id, id)); set++; }
      done++;
    }));
    console.log(`${done}/${toDetect.length} (POV проставлен: ${set})`);
  }
  console.log('готово');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
