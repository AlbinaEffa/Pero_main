/**
 * security-smoke.mjs — security & regression smoke tests for Pero backend.
 *
 * Usage:
 *   node server/tests/security-smoke.mjs [--help] [--no-color]
 *
 * Environment:
 *   API_URL=http://localhost:3001/api   Target server (default: localhost:3001)
 *   SMOKE_ALLOW_REMOTE=true            Required to run against non-localhost URLs
 *   NO_COLOR=1                         Disable ANSI colour output
 *
 * What runs automatically:
 *   T-2a  embed ownership → 403
 *   T-3   ai/chat with foreign projectId → 403
 *   T-7a  GET /projects/:id  cross-user isolation → 403
 *   T-7b  GET /chapters/:id  cross-user isolation → 403
 *   T-8   register → login → /me (auth pool regression)
 *   T-10a /auth/me returns correct user
 *   T-10b project create + list
 *   T-10c chapter create + content PUT
 *   T-10e export/markdown + export/backup respond 200
 *   T-10f bible/extract reachable (200 or 503 if no AI key)
 *   T-10g revision/entity-trace returns { chapters: [] }
 *
 * Manual-only (documented in skip messages):
 *   T-1   JWT_SECRET startup guard
 *   T-2b  semantic_memory no-leak SQL query
 *   T-4   guardChat timeout + circuit breaker
 *   T-5   import processingWarning UI
 *   T-6   401 → localStorage clear + redirect
 *   T-7c  403 → user stays logged in (frontend)
 *   T-9   cost_logs entry after live AI call
 *   T-10d import modal (file upload)
 *
 * Cleanup:
 *   Projects created during the run are deleted in a finally block.
 *   Test users are NOT deleted (no user-delete endpoint); they accumulate
 *   only in non-production DBs given the remote-URL guard.
 *
 * Requirements: Node >= 18 (built-in fetch + AbortSignal.timeout)
 */

// ─── --help ───────────────────────────────────────────────────────────────────
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(`
security-smoke.mjs — Pero backend smoke tests

Usage:
  node server/tests/security-smoke.mjs [--help] [--no-color]

  Or via npm (from /server directory):
    npm run smoke
    npm run smoke -- --no-color

Environment variables:
  API_URL=<url>           Target API base URL (default: http://localhost:3001/api)
  SMOKE_ALLOW_REMOTE=true Allow running against non-localhost URLs (staging etc.)
  NO_COLOR=1              Disable ANSI colour output (auto-set in most CI environments)

Notes:
  - Creates temporary test users on each run (left in DB — use only on test/staging DBs)
  - Creates projects and chapters; these ARE deleted in the cleanup step
  - Exits with code 0 on success, 1 if any automated test fails

`);
  process.exit(0);
}

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE      = process.env.API_URL ?? 'http://localhost:3001/api';
const NO_COLOR  = !!process.env.NO_COLOR || process.argv.includes('--no-color') || !process.stdout.isTTY;
const TIMEOUT_MS = 12_000; // per-request timeout

// ─── Production guard ────────────────────────────────────────────────────────
// Prevent accidental runs against a real deployment.

const isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(BASE);
if (!isLocal && !process.env.SMOKE_ALLOW_REMOTE) {
  console.error(`
ERROR: API_URL does not look like a local server:
  ${BASE}

Running smoke tests against a remote/staging URL creates real users and data.
If this is intentional, re-run with:
  SMOKE_ALLOW_REMOTE=true node server/tests/security-smoke.mjs
`);
  process.exit(1);
}

// ─── Colours ─────────────────────────────────────────────────────────────────

const C = NO_COLOR
  ? { reset:'', green:'', red:'', yellow:'', cyan:'', bold:'', dim:'' }
  : { reset:'\x1b[0m', green:'\x1b[32m', red:'\x1b[31m',
      yellow:'\x1b[33m', cyan:'\x1b[36m', bold:'\x1b[1m', dim:'\x1b[2m' };

// ─── Result tracking ─────────────────────────────────────────────────────────

/** @type {{ status: 'pass'|'fail'|'skip', name: string, detail: string }[]} */
const results = [];

function pass(name, detail = '') { results.push({ status: 'pass', name, detail }); }
function fail(name, detail = '') { results.push({ status: 'fail', name, detail }); }
function skip(name, detail = '') { results.push({ status: 'skip', name, detail }); }

function assert(condition, name, passDetail, failDetail) {
  if (condition) pass(name, passDetail);
  else           fail(name, failDetail);
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function req(method, path, body, token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body)  headers['Content-Type']  = 'application/json';

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const msg = e?.name === 'TimeoutError' ? `timeout after ${TIMEOUT_MS}ms` : String(e?.message ?? e);
    return { status: 0, data: {}, error: msg };
  }

  let data = {};
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

const post  = (p, b, t) => req('POST',   p, b, t);
const get   = (p, t)    => req('GET',    p, undefined, t);
const put   = (p, b, t) => req('PUT',    p, b, t);
const del   = (p, t)    => req('DELETE', p, undefined, t);

// ─── Test ID generator ───────────────────────────────────────────────────────

const RUN_ID = Date.now().toString(36);
function email(name) { return `smoke-${name}-${RUN_ID}@test.pero`; }

// ─── Cleanup registry ─────────────────────────────────────────────────────────
// All project IDs created during the run are registered here and deleted in finally.

const createdProjectIds = [];   // { id, token }
function registerProject(id, token) { createdProjectIds.push({ id, token }); }

async function cleanup() {
  if (createdProjectIds.length === 0) return;
  process.stdout.write(`\n${C.dim}── Cleanup ─────────────────────────────────────────────${C.reset}\n`);
  for (const { id, token } of createdProjectIds) {
    const r = await del(`/projects/${id}`, token);
    const ok = r.status === 200 || r.status === 204 || r.status === 404;
    process.stdout.write(`${C.dim}  DELETE /projects/${id} → ${r.status} ${ok ? '✓' : '✗'}${C.reset}\n`);
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────

function printSummary() {
  const nPass = results.filter(r => r.status === 'pass').length;
  const nFail = results.filter(r => r.status === 'fail').length;
  const nSkip = results.filter(r => r.status === 'skip').length;

  const icon = { pass: `${C.green}✅${C.reset}`, fail: `${C.red}❌${C.reset}`, skip: `${C.yellow}⏭ ${C.reset}` };
  const maxName = Math.max(...results.map(r => r.name.length), 10);

  console.log(`\n${C.bold}Results${C.reset}`);
  console.log('─'.repeat(72));
  for (const r of results) {
    const name   = r.name.padEnd(maxName + 2);
    const detail = r.detail ? `${C.dim}${r.detail}${C.reset}` : '';
    console.log(`  ${icon[r.status]}  ${name}${detail}`);
  }
  console.log('─'.repeat(72));

  const sc = nFail > 0 ? C.red : C.green;
  console.log(`\n${C.bold}${sc}${nPass} passed  ${nFail} failed  ${nSkip} skipped${C.reset}`);
  if (nSkip > 0) console.log(`${C.dim}Skipped tests require manual steps — see descriptions above.${C.reset}`);
  console.log('');
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n${C.bold}${C.cyan}Pero security smoke tests${C.reset}`);
  console.log(`${C.dim}Target : ${BASE}${C.reset}`);
  console.log(`${C.dim}Run ID : ${RUN_ID}${C.reset}\n`);

  if (!isLocal) {
    console.log(`${C.yellow}⚠ Running against non-local URL — SMOKE_ALLOW_REMOTE is set${C.reset}\n`);
  }

  // ── Connectivity ─────────────────────────────────────────────────────────
  const ping = await get('/health');
  if (ping.status === 0) {
    console.error(`${C.red}Cannot reach server at ${BASE}${C.reset}`);
    console.error(`${C.dim}Start with: cd server && npm run dev${C.reset}\n`);
    process.exit(1);
  }
  console.log(`${C.dim}Server reachable (${ping.status})${C.reset}`);

  // ══════════════════════════════════════════════════════════════════════════
  // T-1 — JWT Secret Guard (manual only)
  // ══════════════════════════════════════════════════════════════════════════
  skip('T-1: JWT_SECRET startup guard',
    'Manual: remove JWT_SECRET from .env → server must refuse to start with FATAL log');

  // ══════════════════════════════════════════════════════════════════════════
  // Setup — create users A and B
  // ══════════════════════════════════════════════════════════════════════════
  console.log(`\n${C.dim}── Setup ───────────────────────────────────────────────────${C.reset}`);

  const regA = await post('/auth/register', { email: email('user-a'), password: 'SmokePass1!', displayName: 'Smoke A' });
  if (regA.status !== 201) {
    fail('SETUP: register user A', `HTTP ${regA.status} — ${JSON.stringify(regA.data)}`);
    printSummary();
    process.exit(1);
  }
  const tokenA = regA.data.token;
  console.log(`${C.dim}User A: ${email('user-a')}${C.reset}`);

  const regB = await post('/auth/register', { email: email('user-b'), password: 'SmokePass1!', displayName: 'Smoke B' });
  if (regB.status !== 201) {
    fail('SETUP: register user B', `HTTP ${regB.status} — ${JSON.stringify(regB.data)}`);
    printSummary();
    process.exit(1);
  }
  const tokenB = regB.data.token;
  console.log(`${C.dim}User B: ${email('user-b')}${C.reset}`);

  // Project + chapter for user B (cross-user target)
  const projB = await post('/projects', { title: 'B-Project', color: '#3A4F41' }, tokenB);
  if (projB.status !== 201) {
    fail('SETUP: create project for B', `HTTP ${projB.status}`);
    printSummary();
    process.exit(1);
  }
  const projectIdB = projB.data.project?.id ?? projB.data.id;
  registerProject(projectIdB, tokenB);

  const chapB = await post(`/projects/${projectIdB}/chapters`, { title: 'B-Chapter' }, tokenB);
  if (chapB.status !== 201) {
    fail('SETUP: create chapter for B', `HTTP ${chapB.status}`);
    printSummary();
    process.exit(1);
  }
  const chapterIdB = chapB.data.chapter?.id ?? chapB.data.id;
  console.log(`${C.dim}B project=${projectIdB}  chapter=${chapterIdB}${C.reset}\n`);

  // ══════════════════════════════════════════════════════════════════════════
  // T-2a — embed ownership → 403
  // ══════════════════════════════════════════════════════════════════════════
  {
    const r = await post('/embed/chapter', {
      projectId: projectIdB, chapterId: chapterIdB,
      content: 'Attempt by user A to embed user B chapter.',
    }, tokenA);
    assert(r.status === 403, 'T-2a: embed/chapter cross-user → 403',
      'Rejected as expected',
      `Expected 403, got ${r.status} — ${JSON.stringify(r.data)}`);
  }

  // T-2b — no semantic_memory leak (SQL query for manual verification)
  skip('T-2b: semantic_memory no-leak',
    `Manual SQL: SELECT * FROM semantic_memory WHERE chapter_id = '${chapterIdB}' AND user_id != '${regB.data.user?.id ?? '?'}'  → expect 0 rows`);

  // ══════════════════════════════════════════════════════════════════════════
  // T-3 — ai/chat with foreign projectId → 403
  // ══════════════════════════════════════════════════════════════════════════
  {
    const r = await post('/ai/chat', {
      message: 'Hello', projectId: projectIdB, chapterContent: '',
    }, tokenA);
    assert(r.status === 403, 'T-3: ai/chat cross-user projectId → 403',
      'Rejected as expected',
      `Expected 403, got ${r.status} — ${JSON.stringify(r.data)}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // T-4 — guardChat (manual only — requires bad GEMINI_API_KEY)
  // ══════════════════════════════════════════════════════════════════════════
  skip('T-4a: guardChat timeout',
    'Manual: set GEMINI_API_KEY=invalid → POST /api/bible/extract → response within 30 s, HTTP 5xx, no hang');
  skip('T-4b: circuit breaker — bible/extract',
    'Manual: 6 × POST /api/bible/extract with bad key → 6th returns 503 without calling Gemini');
  skip('T-4c: circuit breaker — revision/entity-arc',
    'Manual: same pattern → 6th returns 503');
  skip('T-4d: circuit breaker — revision/bible-update',
    'Manual: same pattern → 6th returns 503');

  // ══════════════════════════════════════════════════════════════════════════
  // T-5 — import processingWarning (manual only)
  // ══════════════════════════════════════════════════════════════════════════
  skip('T-5: import processingWarning',
    'Manual: throw in enqueueJobs() → ImportModal shows amber banner ~2.5 s before redirect');

  // ══════════════════════════════════════════════════════════════════════════
  // T-6 — 401 → localStorage clear + redirect (frontend only)
  // ══════════════════════════════════════════════════════════════════════════
  skip('T-6: 401 → logout + /login redirect',
    'Frontend: corrupt pero_token in localStorage → any api.* call → token cleared, navigate to /login');

  // ══════════════════════════════════════════════════════════════════════════
  // T-7 — Cross-user project/chapter isolation
  // T-7a: A cannot fetch B's project
  // T-7b: A cannot fetch B's chapter
  // T-7c: 403 does NOT log the user out (frontend only)
  // ══════════════════════════════════════════════════════════════════════════
  {
    const r = await get(`/projects/${projectIdB}`, tokenA);
    assert([403, 404].includes(r.status), 'T-7a: GET /projects/:id cross-user isolation',
      `HTTP ${r.status} — access denied correctly`,
      `Expected 403/404, got ${r.status} — ${JSON.stringify(r.data)}`);
  }
  {
    const r = await get(`/chapters/${chapterIdB}`, tokenA);
    assert([403, 404].includes(r.status), 'T-7b: GET /chapters/:id cross-user isolation',
      `HTTP ${r.status} — access denied correctly`,
      `Expected 403/404, got ${r.status} — ${JSON.stringify(r.data)}`);
  }
  skip('T-7c: 403 → user stays logged in',
    'Frontend: 403 response must NOT clear token or redirect to /login');

  // ══════════════════════════════════════════════════════════════════════════
  // T-8 — Auth shared pool: register → login → /me
  // ══════════════════════════════════════════════════════════════════════════
  {
    const regC  = await post('/auth/register', { email: email('pool-c'), password: 'SmokePass1!' });
    const loginC = regC.status === 201
      ? await post('/auth/login', { email: email('pool-c'), password: 'SmokePass1!' })
      : { status: 0, data: {} };
    const meC = loginC.data?.token
      ? await get('/auth/me', loginC.data.token)
      : { status: 0, data: {} };

    assert(
      regC.status === 201 && loginC.status === 200 && meC.status === 200 && meC.data.user?.email === email('pool-c'),
      'T-8: auth register → login → /me (shared pool)',
      'All three steps OK',
      `register=${regC.status} login=${loginC.status} me=${meC.status}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // T-9 — cost_logs (manual only — requires live GEMINI_API_KEY)
  // ══════════════════════════════════════════════════════════════════════════
  skip('T-9: cost_logs entry after AI chat',
    'Manual (live key): POST /api/ai/chat → SELECT * FROM cost_logs ORDER BY created_at DESC LIMIT 1 → row present, estimated_cost_usd > 0');

  // ══════════════════════════════════════════════════════════════════════════
  // T-10 — Regression
  // ══════════════════════════════════════════════════════════════════════════
  console.log(`\n${C.dim}── Regression ──────────────────────────────────────────────${C.reset}`);

  // T-10a: /me returns correct user
  {
    const r = await get('/auth/me', tokenA);
    assert(r.status === 200 && r.data.user?.email === email('user-a'),
      'T-10a: /auth/me returns correct user',
      `email=${r.data.user?.email}`,
      `HTTP ${r.status} — ${JSON.stringify(r.data)}`);
  }

  // T-10b: project create + list
  let projectIdA;
  {
    const create = await post('/projects', { title: 'Smoke Regression', color: '#C66B49' }, tokenA);
    projectIdA = create.data.project?.id ?? create.data.id;
    if (projectIdA) registerProject(projectIdA, tokenA);

    const list  = projectIdA ? await get('/projects', tokenA) : { status: 0, data: {} };
    const found = Array.isArray(list.data.projects) && list.data.projects.some(p => p.id === projectIdA);
    assert(create.status === 201 && found,
      'T-10b: project create + appears in list',
      `id=${projectIdA}`,
      `create=${create.status} list=${list.status} found=${found}`);
  }

  // T-10c: chapter create + content save
  let chapterIdA;
  if (projectIdA) {
    const create = await post(`/projects/${projectIdA}/chapters`, { title: 'Chapter 1' }, tokenA);
    chapterIdA = create.data.chapter?.id ?? create.data.id;

    if (chapterIdA) {
      const save = await put(`/chapters/${chapterIdA}`, { content: '<p>Иван вошёл в замок.</p>' }, tokenA);
      assert(create.status === 201 && save.status === 200,
        'T-10c: chapter create + content PUT',
        `chapterId=${chapterIdA} save=${save.status}`,
        `create=${create.status} save=${save.status} — ${JSON.stringify(save.data)}`);
    } else {
      fail('T-10c: chapter create + content PUT', `Chapter create returned ${create.status}`);
    }
  } else {
    skip('T-10c: chapter create + content PUT', 'Skipped — project unavailable (T-10b failed)');
  }

  // T-10d: import (file upload — manual only)
  skip('T-10d: import modal',
    'Manual: drag .docx/.fb2 → chapters detected → project created → editor opens');

  // T-10e: export endpoints
  if (projectIdA && chapterIdA) {
    // Chapter has content; both formats should return 200
    const mdR  = await get(`/export/${projectIdA}/markdown`, tokenA);
    const zipR = await get(`/export/${projectIdA}/backup`,   tokenA);
    assert(mdR.status === 200,
      'T-10e: export/markdown → 200',
      `HTTP ${mdR.status}`,
      `Expected 200, got ${mdR.status}`);
    assert(zipR.status === 200,
      'T-10e: export/backup → 200',
      `HTTP ${zipR.status}`,
      `Expected 200, got ${zipR.status}`);
  } else {
    skip('T-10e: export/markdown + export/backup', 'Skipped — project/chapter unavailable');
  }

  // T-10f: bible/extract reachable (200 or 503 if no AI key)
  if (projectIdA && chapterIdA) {
    const r = await post('/bible/extract', {
      chapterContent: 'Иван вошёл в замок Стронгхолд.',
      projectId: projectIdA,
      chapterId:  chapterIdA,
    }, tokenA);
    assert([200, 503].includes(r.status),
      'T-10f: bible/extract reachable (200 or 503 without AI key)',
      `HTTP ${r.status}`,
      `Unexpected HTTP ${r.status} — ${JSON.stringify(r.data)}`);
  } else {
    skip('T-10f: bible/extract', 'Skipped — project/chapter unavailable');
  }

  // T-10g: revision/entity-trace (no AI needed)
  if (projectIdA) {
    const r = await post('/revision/entity-trace', { projectId: projectIdA, entityName: 'Иван' }, tokenA);
    assert(r.status === 200 && Array.isArray(r.data.chapters),
      'T-10g: revision/entity-trace returns { chapters }',
      `semantic=${r.data.semantic} chapters=${r.data.chapters?.length ?? 'n/a'}`,
      `HTTP ${r.status} — ${JSON.stringify(r.data)}`);
  } else {
    skip('T-10g: revision/entity-trace', 'Skipped — project unavailable');
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

(async () => {
  try {
    await run();
  } catch (e) {
    console.error(`\n${C.red}Unexpected error:${C.reset}`, e);
  } finally {
    await cleanup();
  }
  printSummary();
  const failed = results.filter(r => r.status === 'fail').length;
  process.exit(failed > 0 ? 1 : 0);
})();
