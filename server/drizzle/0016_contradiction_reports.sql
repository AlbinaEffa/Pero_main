-- 0016_contradiction_reports.sql
-- Отчёт противоречий по всей книге (PRD P1.2).
--   contradiction_reports — агрегат одного прогона сканирования (статус, прогресс)
--   contradiction_issues  — найденные противоречия отдельными строками
--                           (автор может отклонить ложное срабатывание — статус 'open'|'dismissed')
-- Сканирование идёт фоновой джобой scan_contradictions (см. server/src/jobs/worker.ts).

CREATE TABLE IF NOT EXISTS contradiction_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- 'running' | 'done' | 'failed'
  status          text NOT NULL DEFAULT 'running',
  total_chapters  integer NOT NULL DEFAULT 0,
  scanned_chapters integer NOT NULL DEFAULT 0,
  error           text,
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contradiction_issues (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     uuid NOT NULL REFERENCES contradiction_reports(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id    uuid REFERENCES chapters(id) ON DELETE SET NULL,
  chapter_title text,
  entity_name   text,
  issue         text NOT NULL,
  -- 'low' | 'medium' | 'high'
  severity      text NOT NULL DEFAULT 'medium',
  -- 'open' | 'dismissed'
  status        text NOT NULL DEFAULT 'open',
  created_at    timestamp NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_contradiction_reports_project ON contradiction_reports (project_id, created_at DESC);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_contradiction_issues_report ON contradiction_issues (report_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_contradiction_issues_project_status ON contradiction_issues (project_id, status);
EXCEPTION WHEN undefined_table THEN NULL; END $$;
