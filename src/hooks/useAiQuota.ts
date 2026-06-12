import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

export interface AiQuota {
  plan: 'free' | 'pro';
  used: number;
  limit: number;
  remaining: number;
  /** ISO-время сброса квоты (полночь UTC) */
  resetsAt: string;
}

/**
 * Остаток дневной квоты AI-действий.
 * Передай refreshKey (например, isAiLoading) — квота перезапросится
 * при каждом его изменении, т.е. после каждого AI-вызова.
 */
export function useAiQuota(refreshKey?: unknown) {
  const [quota, setQuota] = useState<AiQuota | null>(null);

  const refresh = useCallback(() => {
    api.get<AiQuota>('/ai/quota')
      .then(setQuota)
      .catch(() => { /* квота — некритичная информация */ });
  }, []);

  useEffect(() => { refresh(); }, [refresh, refreshKey]);

  return { quota, refresh };
}
