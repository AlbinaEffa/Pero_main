/**
 * AI Provider Layer — единая точка доступа к LLM с переключением провайдеров.
 *
 * Поддерживаемые провайдеры (env AI_PROVIDER):
 *   • gemini     — Google Gemini через @google/genai (по умолчанию)
 *   • openai     — любой OpenAI-совместимый API (OpenAI, OpenRouter, DeepSeek,
 *                  LM Studio, Ollama, vLLM…) через AI_BASE_URL
 *   • anthropic  — Anthropic Claude API
 *
 * Конфигурация (server/.env):
 *   AI_PROVIDER=gemini|openai|anthropic        (default: gemini)
 *   AI_MODEL=<имя модели>                      (default зависит от провайдера)
 *   AI_API_KEY=<ключ>                          (fallback: GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY)
 *   AI_BASE_URL=<url>                          (только openai; default https://api.openai.com/v1)
 *
 *   EMBEDDING_PROVIDER=auto|gemini|openai|none (default: auto)
 *   EMBEDDING_MODEL=<имя модели>               (default: text-embedding-004 / text-embedding-3-small)
 *
 * ВАЖНО: размерность эмбеддингов зафиксирована = 768 (pgvector колонка vector(768)).
 *   Gemini text-embedding-004 даёт 768; для OpenAI text-embedding-3-* передаётся
 *   параметр dimensions=768. При смене модели эмбеддингов на несовместимую
 *   потребуется переиндексация (semantic_memory очистится при следующем embed).
 */

import { GoogleGenAI } from '@google/genai';

// ── Public types ──────────────────────────────────────────────────────────────

export type ChatTurn = { role: 'user' | 'model'; text: string };

export interface GenerateParams {
  /** Строка-промпт или мультитёрн диалог */
  contents: string | ChatTurn[];
  /** Системная инструкция */
  system?: string;
  temperature?: number;
  /** Максимум выходных токенов (обязателен для Anthropic; default 4096) */
  maxTokens?: number;
}

export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AIResponse {
  text: string;
  usage: AIUsage;
}

export type EmbedTaskType = 'query' | 'document';

export interface AIProvider {
  readonly name: 'gemini' | 'openai' | 'anthropic';
  readonly chatModel: string;
  generate(params: GenerateParams): Promise<AIResponse>;
  /** Стриминг: выдаёт текстовые чанки по мере генерации */
  generateStream(params: GenerateParams): AsyncGenerator<string, void, unknown>;
}

export interface EmbeddingProvider {
  readonly name: 'gemini' | 'openai';
  readonly embedModel: string;
  /** Возвращает вектор размерности EMBEDDING_DIM или null при ошибке/недоступности */
  embed(text: string, taskType: EmbedTaskType): Promise<number[] | null>;
}

export const EMBEDDING_DIM = 768;

const DEFAULT_MAX_TOKENS = 4096;

// ── Helpers ───────────────────────────────────────────────────────────────────

function toTurns(contents: string | ChatTurn[]): ChatTurn[] {
  return typeof contents === 'string' ? [{ role: 'user', text: contents }] : contents;
}

/**
 * Разбор SSE-потока: отдаёт payload каждой строки `data: ...`.
 * body типизирован как any, чтобы не зависеть от DOM-типов (tsconfig lib: ES2022).
 */
async function* sseLines(body: any): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data:')) yield trimmed.slice(5).trim();
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function readErrorBody(res: { text(): Promise<string> }): Promise<string> {
  try { return (await res.text()).slice(0, 300); } catch { return ''; }
}

// ── Gemini ────────────────────────────────────────────────────────────────────

class GeminiProvider implements AIProvider {
  readonly name = 'gemini' as const;
  private client: GoogleGenAI;

  constructor(apiKey: string, readonly chatModel: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  private buildRequest(params: GenerateParams) {
    const contents = toTurns(params.contents).map(t => ({
      role: t.role,
      parts: [{ text: t.text }],
    }));
    return {
      model: this.chatModel,
      contents: contents as any,
      config: {
        ...(params.system ? { systemInstruction: params.system } : {}),
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        ...(params.maxTokens ? { maxOutputTokens: params.maxTokens } : {}),
      },
    };
  }

  async generate(params: GenerateParams): Promise<AIResponse> {
    const response = await this.client.models.generateContent(this.buildRequest(params));
    return {
      text: response.text ?? '',
      usage: {
        inputTokens:  response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }

  async *generateStream(params: GenerateParams): AsyncGenerator<string, void, unknown> {
    const stream = await this.client.models.generateContentStream(this.buildRequest(params));
    for await (const chunk of stream) {
      const text = (chunk as any).text ?? '';
      if (text) yield text;
    }
  }
}

class GeminiEmbedding implements EmbeddingProvider {
  readonly name = 'gemini' as const;
  private client: GoogleGenAI;

  constructor(apiKey: string, readonly embedModel: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async embed(text: string, taskType: EmbedTaskType): Promise<number[] | null> {
    try {
      const result = await (this.client.models as any).embedContent({
        model: this.embedModel,
        content: text,
        config: { taskType: taskType === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT' },
      });
      return result.embedding?.values ?? null;
    } catch (e) {
      console.warn('[aiProvider] gemini embed failed:', (e as Error)?.message);
      return null;
    }
  }
}

// ── OpenAI-совместимый (OpenAI / OpenRouter / DeepSeek / локальные) ──────────

class OpenAICompatProvider implements AIProvider {
  readonly name = 'openai' as const;

  constructor(
    private apiKey: string,
    readonly chatModel: string,
    private baseUrl: string,
  ) {}

  private buildBody(params: GenerateParams, stream: boolean) {
    const messages: { role: string; content: string }[] = [];
    if (params.system) messages.push({ role: 'system', content: params.system });
    for (const t of toTurns(params.contents)) {
      messages.push({ role: t.role === 'model' ? 'assistant' : 'user', content: t.text });
    }
    return {
      model: this.chatModel,
      messages,
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
      stream,
    };
  }

  private headers() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };
  }

  async generate(params: GenerateParams): Promise<AIResponse> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(params, false)),
    });
    if (!res.ok) {
      throw new Error(`OpenAI-compatible API error ${res.status}: ${await readErrorBody(res)}`);
    }
    const data: any = await res.json();
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      usage: {
        inputTokens:  data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }

  async *generateStream(params: GenerateParams): AsyncGenerator<string, void, unknown> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(params, true)),
    });
    if (!res.ok || !res.body) {
      throw new Error(`OpenAI-compatible API error ${res.status}: ${await readErrorBody(res)}`);
    }
    for await (const data of sseLines(res.body)) {
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const text = parsed.choices?.[0]?.delta?.content ?? '';
        if (text) yield text;
      } catch { /* пропускаем не-JSON строки (комментарии SSE) */ }
    }
  }
}

class OpenAIEmbedding implements EmbeddingProvider {
  readonly name = 'openai' as const;

  constructor(
    private apiKey: string,
    readonly embedModel: string,
    private baseUrl: string,
  ) {}

  async embed(text: string, _taskType: EmbedTaskType): Promise<number[] | null> {
    try {
      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.embedModel,
          input: text,
          // text-embedding-3-* поддерживают усечение размерности — держим 768 под pgvector
          dimensions: EMBEDDING_DIM,
        }),
      });
      if (!res.ok) {
        console.warn(`[aiProvider] openai embed error ${res.status}: ${await readErrorBody(res)}`);
        return null;
      }
      const data: any = await res.json();
      const vec: number[] | undefined = data.data?.[0]?.embedding;
      if (!vec) return null;
      if (vec.length !== EMBEDDING_DIM) {
        console.warn(`[aiProvider] embedding dim ${vec.length} != ${EMBEDDING_DIM} — vector skipped (модель не поддерживает dimensions?)`);
        return null;
      }
      return vec;
    } catch (e) {
      console.warn('[aiProvider] openai embed failed:', (e as Error)?.message);
      return null;
    }
  }
}

// ── Anthropic (Claude) ────────────────────────────────────────────────────────

class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic' as const;
  private baseUrl = 'https://api.anthropic.com/v1';

  constructor(private apiKey: string, readonly chatModel: string) {}

  private buildBody(params: GenerateParams, stream: boolean) {
    const messages = toTurns(params.contents).map(t => ({
      role: t.role === 'model' ? 'assistant' : 'user',
      content: t.text,
    }));
    return {
      model: this.chatModel,
      messages,
      ...(params.system ? { system: params.system } : {}),
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
      stream,
    };
  }

  private headers() {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }

  async generate(params: GenerateParams): Promise<AIResponse> {
    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(params, false)),
    });
    if (!res.ok) {
      throw new Error(`Anthropic API error ${res.status}: ${await readErrorBody(res)}`);
    }
    const data: any = await res.json();
    const text = (data.content ?? [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');
    return {
      text,
      usage: {
        inputTokens:  data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      },
    };
  }

  async *generateStream(params: GenerateParams): AsyncGenerator<string, void, unknown> {
    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(params, true)),
    });
    if (!res.ok || !res.body) {
      throw new Error(`Anthropic API error ${res.status}: ${await readErrorBody(res)}`);
    }
    for await (const data of sseLines(res.body)) {
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
          const text = parsed.delta.text ?? '';
          if (text) yield text;
        }
        if (parsed.type === 'message_stop') return;
      } catch { /* пропускаем служебные строки */ }
    }
  }
}

// ── Factory / config ──────────────────────────────────────────────────────────

type ProviderName = 'gemini' | 'openai' | 'anthropic';

const DEFAULT_CHAT_MODELS: Record<ProviderName, string> = {
  gemini:    'gemini-2.5-flash',
  openai:    'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-5',
};

function resolveApiKey(provider: ProviderName): string | undefined {
  if (process.env.AI_API_KEY) return process.env.AI_API_KEY;
  switch (provider) {
    case 'gemini':    return process.env.GEMINI_API_KEY;
    case 'openai':    return process.env.OPENAI_API_KEY;
    case 'anthropic': return process.env.ANTHROPIC_API_KEY;
  }
}

let chatProvider: AIProvider | null | undefined;
let embeddingProvider: EmbeddingProvider | null | undefined;

/**
 * Возвращает сконфигурированный чат-провайдер (singleton) или null,
 * если ключ не задан. Вызывающий код должен отвечать 503 при null.
 */
export function getAIProvider(): AIProvider | null {
  if (chatProvider !== undefined) return chatProvider;

  const name = (process.env.AI_PROVIDER ?? 'gemini').toLowerCase() as ProviderName;
  if (!['gemini', 'openai', 'anthropic'].includes(name)) {
    console.error(`[aiProvider] Unknown AI_PROVIDER="${name}" — AI features disabled`);
    chatProvider = null;
    return chatProvider;
  }

  const apiKey = resolveApiKey(name);
  if (!apiKey) {
    console.warn(`[aiProvider] No API key for provider "${name}" (set AI_API_KEY or provider-specific key). AI features will not work.`);
    chatProvider = null;
    return chatProvider;
  }

  const model = process.env.AI_MODEL || DEFAULT_CHAT_MODELS[name];

  try {
    switch (name) {
      case 'gemini':
        chatProvider = new GeminiProvider(apiKey, model);
        break;
      case 'openai':
        chatProvider = new OpenAICompatProvider(
          apiKey, model,
          (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
        );
        break;
      case 'anthropic':
        chatProvider = new AnthropicProvider(apiKey, model);
        break;
    }
    console.log(`[aiProvider] chat: ${name} / ${model}`);
  } catch (e) {
    console.error('[aiProvider] Failed to initialize provider:', e);
    chatProvider = null;
  }
  return chatProvider ?? null;
}

/**
 * Возвращает провайдер эмбеддингов или null (семантический поиск
 * деградирует молча — вся существующая логика уже обрабатывает null).
 *
 * EMBEDDING_PROVIDER=auto: gemini если есть ключ Gemini, иначе openai, иначе none.
 * Anthropic эмбеддинги не предоставляет.
 */
export function getEmbeddingProvider(): EmbeddingProvider | null {
  if (embeddingProvider !== undefined) return embeddingProvider;

  const requested = (process.env.EMBEDDING_PROVIDER ?? 'auto').toLowerCase();
  const geminiKey = process.env.GEMINI_API_KEY
    ?? ((process.env.AI_PROVIDER ?? 'gemini') === 'gemini' ? process.env.AI_API_KEY : undefined);
  const openaiKey = process.env.OPENAI_API_KEY
    ?? (process.env.AI_PROVIDER === 'openai' ? process.env.AI_API_KEY : undefined);

  const make = (which: 'gemini' | 'openai'): EmbeddingProvider | null => {
    if (which === 'gemini') {
      if (!geminiKey) return null;
      return new GeminiEmbedding(geminiKey, process.env.EMBEDDING_MODEL || 'text-embedding-004');
    }
    if (!openaiKey) return null;
    return new OpenAIEmbedding(
      openaiKey,
      process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
      (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    );
  };

  if (requested === 'none') {
    embeddingProvider = null;
  } else if (requested === 'gemini' || requested === 'openai') {
    embeddingProvider = make(requested);
    if (!embeddingProvider) {
      console.warn(`[aiProvider] EMBEDDING_PROVIDER=${requested}, но ключ не задан — семантический поиск отключён`);
    }
  } else {
    // auto
    embeddingProvider = make('gemini') ?? make('openai');
  }

  if (embeddingProvider) {
    console.log(`[aiProvider] embeddings: ${embeddingProvider.name} / ${embeddingProvider.embedModel}`);
  } else {
    console.warn('[aiProvider] embeddings: отключены (нет подходящего провайдера)');
  }
  return embeddingProvider ?? null;
}

/** Сброс синглтонов — для тестов */
export function __resetProvidersForTests(): void {
  chatProvider = undefined;
  embeddingProvider = undefined;
}
