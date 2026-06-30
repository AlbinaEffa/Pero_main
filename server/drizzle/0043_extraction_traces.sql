-- Телеметрия прогонов извлечения (НЕ подаётся в промпт). Снимок ответа модели + решений
-- промоут-гейта для отладки качества ИИ и метрики здоровья извлечения. Replay-safe.
CREATE TABLE IF NOT EXISTS extraction_traces (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id    uuid REFERENCES chapters(id) ON DELETE SET NULL,
  job_id        uuid,
  route         text NOT NULL,
  model         text,
  pov_used      text,
  raw_response  text,
  outcome       jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_tokens  integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trace_chapter ON extraction_traces (chapter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trace_project ON extraction_traces (project_id, created_at DESC);
