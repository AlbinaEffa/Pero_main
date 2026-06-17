-- POV-персонаж главы: от чьего лица ведётся повествование.
-- null — третье лицо / не определён. Первое лицо «я» относится к этому персонажу.
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS pov_character text;
