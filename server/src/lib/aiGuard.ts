/**
 * AI Guard — timeout, circuit breaker, and cost logging for Gemini API calls.
 *
 * Usage:
 *   const result = await aiGuard.chat(() => aiClient.models.generateContent({...}), {
 *     userId, projectId, timeoutMs: 30_000,
 *   });
 *
 * What it does:
 *   1. Wraps the call in a timeout — throws if Gemini doesn't respond in time
 *   2. Passes through a circuit breaker — if Gemini fails N times, opens the circuit
 *      and returns 503 immediately for recoveryMs, then tests again (HALF_OPEN)
 *   3. Logs estimated cost to the cost_logs table after a successful call
 */

import { pool as sharedPool } from '../db/client.js';

// ── Pricing constants (Gemini 2.5 Flash, 2025) ──────────────────────────────
// https://ai.google.dev/pricing
const PRICE_USD_PER_1M = {
  'gemini-2.5-flash': { input: 0.075, output: 0.30 },
  'gemini-2.0-flash': { input: 0.10,  output: 0.40 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'default':          { input: 0.10,  output: 0.40 },
};

// text-embedding-004: $0.00013 per 1K chars (=0.13 per 1M chars)
const EMBEDDING_PRICE_PER_1M_CHARS = 0.13;

// ── Circuit Breaker ──────────────────────────────────────────────────────────

type CBState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

class CircuitBreaker {
  private state: CBState = 'CLOSED';
  private failures = 0;
  private lastFailureAt = 0;

  constructor(
    private readonly name: string,
    private readonly failureThreshold = 5,
    private readonly recoveryMs = 60_000
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureAt >= this.recoveryMs) {
        this.state = 'HALF_OPEN';
        console.log(`[circuit:${this.name}] HALF_OPEN — testing`);
      } else {
        throw new CircuitOpenError(`AI service temporarily unavailable (circuit open: ${this.name})`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      if (err instanceof CircuitOpenError) throw err;
      this.onFailure(err);
      throw err;
    }
  }

  private onSuccess() {
    if (this.state !== 'CLOSED') {
      console.log(`[circuit:${this.name}] CLOSED — recovered`);
    }
    this.failures = 0;
    this.state = 'CLOSED';
  }

  private onFailure(err: unknown) {
    this.failures++;
    this.lastFailureAt = Date.now();
    console.warn(`[circuit:${this.name}] failure ${this.failures}/${this.failureThreshold}:`, (err as Error)?.message);
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      console.error(`[circuit:${this.name}] OPEN — circuit tripped`);
    }
  }

  getState(): CBState { return this.state; }
  getFailures(): number { return this.failures; }
}

export class CircuitOpenError extends Error {
  readonly isCircuitOpen = true;
  constructor(message: string) { super(message); this.name = 'CircuitOpenError'; }
}

// One circuit per AI capability
const circuits = {
  chat:      new CircuitBreaker('gemini:chat',      5, 60_000),
  embed:     new CircuitBreaker('gemini:embed',     5, 60_000),
  extract:   new CircuitBreaker('gemini:extract',   5, 60_000),
};

// ── Timeout ───────────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout after ${ms}ms [${label}]`));
    }, ms);
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); }
    );
  });
}

// ── Cost logging ───────────────────────────────────────────────────────────────

function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const prices = PRICE_USD_PER_1M[model as keyof typeof PRICE_USD_PER_1M]
    ?? PRICE_USD_PER_1M.default;
  return (inputTokens * prices.input + outputTokens * prices.output) / 1_000_000;
}

async function logCost(opts: {
  userId: string;
  projectId?: string | null;
  model: string;
  route: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}): Promise<void> {
  try {
    await sharedPool.query(
      `INSERT INTO cost_logs
         (user_id, project_id, model, route, input_tokens, output_tokens, estimated_cost_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        opts.userId,
        opts.projectId ?? null,
        opts.model,
        opts.route,
        opts.inputTokens,
        opts.outputTokens,
        opts.estimatedCostUsd,
      ]
    );
  } catch (e: any) {
    // Table may not exist if migration hasn't run — skip silently
    if (e.code !== '42P01') console.error('[cost_log] insert failed:', e.message);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface GuardOpts {
  userId: string;
  projectId?: string | null;
  route: string;
  timeoutMs?: number;
  circuit?: keyof typeof circuits;
}

/**
 * Wrap a Gemini generateContent call with timeout + circuit breaker + cost logging.
 * `fn` should return the raw SDK response object (which has `.usageMetadata`).
 */
export async function guardChat<T extends {
  text?: string;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}>(
  fn: () => Promise<T>,
  opts: GuardOpts
): Promise<T> {
  const cb = circuits[opts.circuit ?? 'chat'];
  const ms = opts.timeoutMs ?? 30_000;

  const result = await cb.execute(() =>
    withTimeout(fn(), ms, opts.route)
  );

  // Log cost fire-and-forget
  const inputTokens  = result.usageMetadata?.promptTokenCount    ?? 0;
  const outputTokens = result.usageMetadata?.candidatesTokenCount ?? 0;
  const model = 'gemini-2.5-flash';
  if (inputTokens > 0 || outputTokens > 0) {
    logCost({
      userId: opts.userId,
      projectId: opts.projectId,
      model,
      route: opts.route,
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimateCost(model, inputTokens, outputTokens),
    }).catch(() => {});
  }

  return result;
}

/**
 * Wrap a Gemini embedContent call with timeout + circuit breaker + cost logging.
 * Embeddings are priced per character, not per token.
 */
export async function guardEmbed<T>(
  fn: () => Promise<T>,
  opts: GuardOpts & { inputChars?: number }
): Promise<T> {
  const cb = circuits.embed;
  const ms = opts.timeoutMs ?? 15_000;

  const result = await cb.execute(() =>
    withTimeout(fn(), ms, opts.route)
  );

  const chars = opts.inputChars ?? 0;
  if (chars > 0) {
    const costUsd = (chars / 1_000_000) * EMBEDDING_PRICE_PER_1M_CHARS;
    logCost({
      userId: opts.userId,
      projectId: opts.projectId,
      model: 'text-embedding-004',
      route: opts.route,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: costUsd,
    }).catch(() => {});
  }

  return result;
}

/** Expose circuit states for the /health endpoint */
export function getCircuitStates() {
  return Object.fromEntries(
    Object.entries(circuits).map(([k, cb]) => [k, { state: cb.getState(), failures: cb.getFailures() }])
  );
}
