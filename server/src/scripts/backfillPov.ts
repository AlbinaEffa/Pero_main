/**
 * Одноразовый бэкфилл POV-рассказчика для глав проекта (фикстур).
 * Запуск: npx tsx src/scripts/backfillPov.ts <projectId>
 * Берёт начало каждой главы, спрашивает у модели имя рассказчика, пишет в pov_character.
 */
import 'dotenv/config';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { eq, asc } from 'drizzle-orm';
import { sanitizePov } from '../lib/extraction.js';

const projectId = process.argv[2];
if (!projectId) { console.error('usage: backfillPov.ts <projectId>'); process.exit(1); }

const BASE = (process.env.AI_BASE_URL || 'https://api.moonshot.ai/v1').replace(/\/+$/, '');
const KEY = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '';
const MODEL = process.env.AI_MODEL || 'moonshot-v1-32k';
const CONCURRENCY = 5;

function strip(html: string): string {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
}

async function detectPov(text: string): Promise<string | null> {
  const prompt = `Ниже начало главы романа. Определи, от чьего лица ведётся повествование.
Если первое лицо («я») — назови каноническое имя рассказчика (по контексту, как его зовут другие).
Если третье лицо или рассказчика не определить — null. НЕ возвращай местоимение.
Ответ строго JSON: {"pov": "Имя" | null}

ТЕКСТ:
${text.slice(0, 1800)}`;
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, temperature: 0.1, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok) { console.warn('AI', r.status); return null; }
  const d: any = await r.json();
  const raw = d?.choices?.[0]?.message?.content ?? '';
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : raw);
    return sanitizePov(parsed.pov);
  } catch { return null; }
}

async function main() {
  const chapters = await db.select({ id: schema.chapters.id, title: schema.chapters.title, content: schema.chapters.content })
    .from(schema.chapters).where(eq(schema.chapters.projectId, projectId))
    .orderBy(asc(schema.chapters.order));
  const withText = chapters.filter(c => strip(c.content ?? '').length > 200);
  console.log(`главы с текстом: ${withText.length}/${chapters.length}`);

  let done = 0, set = 0;
  for (let i = 0; i < withText.length; i += CONCURRENCY) {
    const batch = withText.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async c => {
      const pov = await detectPov(strip(c.content ?? ''));
      if (pov) { await db.update(schema.chapters).set({ povCharacter: pov }).where(eq(schema.chapters.id, c.id)); set++; }
      done++;
    }));
    console.log(`${done}/${withText.length} (POV проставлен: ${set})`);
  }
  console.log('готово');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
