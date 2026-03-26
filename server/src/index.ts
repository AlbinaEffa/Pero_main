import { runMigrations } from './db/migrate.js';
import { startWorker } from './jobs/worker.js';
import { app } from './app.js';

const port = process.env.PORT || 3001;

// ── Critical startup guards ───────────────────────────────────────────────────
if (!process.env.JWT_SECRET) {
  console.error('[startup] FATAL: JWT_SECRET env var is not set. Refusing to start — tokens would be signed with a hardcoded fallback key.');
  process.exit(1);
}

// ── Optional Sentry error tracking ──────────────────────────────────────────
// Install: npm install @sentry/node  (in /server)
// Set env: SENTRY_DSN=https://...@sentry.io/...
let Sentry: any = null;
if (process.env.SENTRY_DSN) {
  try {
    // Function-based import avoids tsc errors when @sentry/node isn't installed yet
    const _import = new Function('s', 'return import(s)');
    Sentry = await _import('@sentry/node');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      environment: process.env.NODE_ENV ?? 'development',
    });
    console.log('[sentry] Error tracking enabled');
  } catch {
    console.warn('[sentry] @sentry/node not installed — error tracking disabled');
    Sentry = null;
  }
}

// ── Run DB migrations before accepting requests ──────────────────────────────
if (process.env.DATABASE_URL) {
  try {
    await runMigrations(process.env.DATABASE_URL);
  } catch (err) {
    console.error('[migrate] Fatal migration error — server will NOT start:', err);
    process.exit(1);
  }
} else {
  console.warn('[migrate] DATABASE_URL not set — skipping migrations');
}

// ── Sentry Express error handler (must be after all routes) ─────────────────
if (Sentry) {
  Sentry.setupExpressErrorHandler(app);
}

// ── Start background job worker ──────────────────────────────────────────────
if (process.env.DATABASE_URL) {
  startWorker(process.env.DATABASE_URL);
} else {
  console.warn('[worker] DATABASE_URL not set — job worker not started');
}

// ── Start listening ──────────────────────────────────────────────────────────
app.listen(port, () => {
  console.log(`[server] Listening at http://localhost:${port}`);
});
