-- 配信予定表 (cast schedules)
-- 1日複数枠OK (start_time を主キーに含めて区別)
-- status: 'planned'  = 配信予定
--         'off'      = 休み宣言
--         'tentative' = 仮予定（キャストから未確定回答）
-- source: 'manual'       = 管理画面で事務所が入力
--         'line_message' = キャストのLINE自由文をLLM解析して取り込み（Phase 2）

CREATE TABLE IF NOT EXISTS cast_schedules (
  cast_id          TEXT NOT NULL,
  line_account_id  TEXT NOT NULL,
  date             TEXT NOT NULL,                    -- YYYY-MM-DD (JST)
  start_time       TEXT NOT NULL DEFAULT '',         -- HH:MM, '' = 終日/未指定
  end_time         TEXT,                             -- HH:MM, NULL可
  status           TEXT NOT NULL DEFAULT 'planned',  -- planned / off / tentative
  notes            TEXT,
  source           TEXT NOT NULL DEFAULT 'manual',   -- manual / line_message
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (cast_id, date, start_time),
  FOREIGN KEY (cast_id) REFERENCES casts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cast_schedules_account_date
  ON cast_schedules(line_account_id, date);
CREATE INDEX IF NOT EXISTS idx_cast_schedules_cast_date
  ON cast_schedules(cast_id, date);
