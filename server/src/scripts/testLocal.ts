import 'dotenv/config';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { cleanJsonResponse, isMetaEntity } from '../lib/extraction.js';
import { BASE_EXTRACTION_PROMPT } from '../lib/extractionPrompts.js';

const MODEL = process.argv[3] || 'gemma2:9b';
const CHID = process.argv[2] || '9c8259aa-6341-4b8c-bbb7-18353b2f73ab'; // гл.10
const strip = (h: string) => (h || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

(async () => {
  const [ch] = await db.select({ content: schema.chapters.content }).from(schema.chapters).where(eq(schema.chapters.id, CHID));
  const text = strip(ch?.content ?? '').slice(0, 3500);
  const t0 = Date.now();
  const r = await fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, temperature: 0.2,
      messages: [{ role: 'system', content: BASE_EXTRACTION_PROMPT }, { role: 'user', content: `ТЕКСТ ГЛАВЫ:\n${text}` }],
    }),
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  if (!r.ok) { console.log('HTTP', r.status, await r.text()); process.exit(1); }
  const d: any = await r.json();
  const raw = d?.choices?.[0]?.message?.content ?? '';
  const cjk = /[一-鿿]/.test(raw);
  let ok = false, n = 0, types: Record<string, number> = {}, names: string[] = [];
  try {
    const p = JSON.parse(cleanJsonResponse(raw));
    const ents = (Array.isArray(p) ? p : p.entities ?? []).filter((e: any) => !isMetaEntity(e));
    ok = true; n = ents.length;
    for (const e of ents) { types[e.type] = (types[e.type] || 0) + 1; }
    names = ents.slice(0, 4).map((e: any) => e.name);
    console.log('pov:', p.pov, '| synopsis есть:', !!p.synopsis, '| chapterSummary:', p.chapterSummary);
  } catch (e) { console.log('JSON НЕ распарсился. Первые 200:', raw.slice(0, 200)); }
  console.log(`модель: ${MODEL} | время: ${dt}с | валидный JSON: ${ok} | сущностей: ${n} ${JSON.stringify(types)} | китайский в ответе: ${cjk}`);
  console.log('первые имена:', names.join(', '));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
