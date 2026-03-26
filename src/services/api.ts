const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/api';

/** Returns the base API URL. Use this instead of hardcoding localhost in components. */
export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function getToken(): string | null {
  return localStorage.getItem('pero_token');
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();

  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };

  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

  if (!res.ok) {
    // 401 = token expired/invalid → clear session and redirect to login
    if (res.status === 401) {
      localStorage.removeItem('pero_token');
      window.location.href = '/login';
    }
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error || `HTTP ${res.status}`, res.status);
  }

  return res.json() as Promise<T>;
}

// ─── Typed helpers ────────────────────────────────────────────────────────────

export type SearchResultType = 'chapter' | 'text_match' | 'character' | 'location' | 'item' | 'rule';

export interface SearchResult {
  id:           string;
  type:         SearchResultType;
  title:        string;
  snippet:      string;
  /** Clean-text fingerprint (±15 chars around the match) for precise jump-to-match. */
  matchText?:   string;
  chapterId:    string | null;
  chapterTitle: string | null;
  entityId?:    string;
}

/**
 * Search a project for chapters, text fragments, and Story Bible entities.
 * Returns an empty array for queries shorter than 2 characters (no API call made).
 */
export async function searchProject(
  projectId: string,
  query: string
): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const data = await request<{ results: SearchResult[] }>(
    `/search?projectId=${encodeURIComponent(projectId)}&q=${encodeURIComponent(q)}`
  );
  return data.results ?? [];
}

export const api = {
  get: <T>(path: string) =>
    request<T>(path),

  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),

  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),

  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),

  delete: <T>(path: string) =>
    request<T>(path, { method: 'DELETE' }),
};
