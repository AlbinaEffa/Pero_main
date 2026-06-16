export type ChapterType = 'chapter' | 'prologue' | 'epilogue' | 'interlude';

export type Chapter = {
  id: string;
  projectId: string;
  title: string;
  content: string | null;
  order: number;
  status: 'draft' | 'done';
  chapterType?: ChapterType;
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp of the last successful Story Bible extraction for this chapter. Null if never extracted. */
  lastExtractedAt?: string | null;
};

export type EntitySignificance = 'major' | 'moderate' | 'minor';

/** Per-type structured attributes populated by AI. */
export type EntityAttributes =
  | {
      // character
      aliases?: string[];
      appearance?: string;
      personality?: string;
      role?: string;
      /** Предыстория: ключевые факты биографии до текущих событий. */
      background?: string;
      /** Что движет персонажем — цели, желания, страхи. */
      motivations?: string;
      /** Манера речи и характерный голос (для консистентности диалогов). */
      speech?: string;
      /** Что персонаж скрывает от других. */
      secrets?: string;
      /** Одно предложение: зачем персонаж сюжету. */
      plotRelevance?: string;
    }
  | { region?: string; physicalDetails?: string; mood?: string }                       // location
  | { properties?: string; origin?: string; owner?: string }                           // item
  | { scope?: string; exceptions?: string };                                            // rule

export type Entity = {
  id: string;
  type: string;
  name: string;
  description: string;
  status?: string;
  chapterId?: string | null;
  significance?: EntitySignificance | null;
  attributes?: EntityAttributes | null;
};

/** Связь между двумя сущностями. relation читается от source → target («мать», «соперник»). */
export type EntityLink = {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relation: string;
  chapterId?: string | null;
};

export type EntityEventType = 'conflict' | 'relationship' | 'status' | 'revelation' | 'other';

/** Событие арки сущности, извлечённое из конкретной главы (таймлайн персонажа). */
export type EntityEvent = {
  id: string;
  entityId: string;
  chapterId?: string | null;
  chapterTitle?: string | null;
  title: string;
  description?: string | null;
  eventType?: EntityEventType | string | null;
  /** Сюжетная хронология (извлекается AI): текстовый маркер времени из текста. */
  timeLabel?: string | null;
  /** Когда событие происходит в истории относительно повествования. */
  timeHint?: 'past' | 'present' | 'future' | 'flashback' | string | null;
};

export type ChatMessage = {
  role: 'user' | 'ai';
  text: string;
};

export type BibleUpdateSuggestion = {
  id: string;
  entityId: string;
  entityType: string;
  entityName: string;
  chapterId: string | null;
  chapterTitle: string | null;
  previousDescription: string | null;
  proposedDescription: string;
  /** Plain-text snippet from the chapter text surrounding the entity name. Used as jump-to-match fingerprint. */
  sourceExcerpt: string | null;
  reason: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'dismissed';
  createdAt: string;
};
