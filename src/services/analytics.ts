/**
 * Analytics service — thin wrapper around PostHog.
 *
 * Setup:
 *   npm install posthog-js          (in project root)
 *   Add to .env.local:
 *     VITE_POSTHOG_KEY=phc_xxxx
 *     VITE_POSTHOG_HOST=https://eu.posthog.com   # optional, defaults to EU cloud
 *
 * Without VITE_POSTHOG_KEY the module is a silent no-op — safe for local dev.
 *
 * Sentry (frontend):
 *   npm install @sentry/react
 *   Add to .env.local:
 *     VITE_SENTRY_DSN=https://...@sentry.io/...
 */

// ── PostHog ──────────────────────────────────────────────────────────────────

let _ph: any = null;
let _phInitialized = false;

function getPosthog(): any {
  if (_phInitialized) return _ph;
  _phInitialized = true;

  const key  = (import.meta as any).env?.VITE_POSTHOG_KEY;
  const host = (import.meta as any).env?.VITE_POSTHOG_HOST ?? 'https://eu.posthog.com';
  if (!key) return null;

  // Dynamic import via Function() — bypasses TypeScript module resolution
  // so the build never fails when posthog-js is not installed.
  const _import = new Function('s', 'return import(s)');
  _import('posthog-js')
    .then(({ default: posthog }: any) => {
      posthog.init(key, {
        api_host: host,
        capture_pageview: false,   // we handle page views manually
        capture_pageleave: true,
        persistence: 'localStorage',
      });
      _ph = posthog;
    })
    .catch(() => {
      // posthog-js not installed — stay silent
    });

  return null; // will be populated after init resolves
}

// ── Sentry ───────────────────────────────────────────────────────────────────

export function initSentry(): void {
  const dsn = (import.meta as any).env?.VITE_SENTRY_DSN;
  if (!dsn) return;
  const _import = new Function('s', 'return import(s)');
  _import('@sentry/react')
    .then((Sentry: any) => {
      Sentry.init({
        dsn,
        tracesSampleRate: 0.1,
        environment: (import.meta as any).env?.MODE ?? 'development',
      });
    })
    .catch(() => {
      // @sentry/react not installed — stay silent
    });
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Identify the authenticated user. Call after login/register. */
export function identifyUser(userId: string, props?: { email?: string; name?: string }): void {
  getPosthog(); // trigger init
  // Give posthog a tick to init before identifying
  setTimeout(() => { _ph?.identify(userId, props); }, 500);
}

/** Reset identity on logout. */
export function resetUser(): void {
  _ph?.reset();
}

/**
 * Track a product event.
 * Fire-and-forget — never throws, never blocks UI.
 *
 * Named events (keep in sync with analytics dashboard):
 *   project_created         { genre?, imported }
 *   chapter_opened          { projectId, chapterId }
 *   chat_message_sent       { projectId, chapterId, messageLength }
 *   consistency_checked     { projectId, issueCount }
 *   entities_extracted      { projectId, chapterId, count }
 *   entity_approved         { projectId, type }
 *   entity_rejected         { projectId }
 *   import_completed        { chapterCount, totalWords, genre? }
 *   revision_trace_run      { projectId, semantic }
 *   revision_arc_run        { projectId }
 *   bible_update_checked    { projectId, suggestionCount }
 */
export function track(event: string, props?: Record<string, unknown>): void {
  try {
    if (_ph) {
      _ph.capture(event, props);
    } else {
      // PostHog not ready yet — retry once after 1s (handles first events before init)
      setTimeout(() => { _ph?.capture(event, props); }, 1000);
    }
    // Dev logging
    if ((import.meta as any).env?.DEV) {
      console.debug(`[analytics] ${event}`, props ?? '');
    }
  } catch {
    // never crash the app over analytics
  }
}
