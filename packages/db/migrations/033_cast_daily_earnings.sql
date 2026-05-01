-- 日別報酬の保存先
-- 月次sync時に Studio API を1日単位で叩いて upsert する。
-- working_days はこのテーブルから集計（tokens > 0 の日数）。

CREATE TABLE IF NOT EXISTS cast_daily_earnings (
  cast_id          TEXT NOT NULL,
  line_account_id  TEXT NOT NULL,
  date             TEXT NOT NULL,             -- YYYY-MM-DD (JST)
  tokens           INTEGER NOT NULL DEFAULT 0,
  fetched_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (cast_id, date),
  FOREIGN KEY (cast_id) REFERENCES casts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cast_daily_account ON cast_daily_earnings(line_account_id);
CREATE INDEX IF NOT EXISTS idx_cast_daily_date ON cast_daily_earnings(cast_id, date);

-- 稼働日数を冗長保存（一覧表示で都度集計しなくて済む）
ALTER TABLE casts ADD COLUMN working_days INTEGER NOT NULL DEFAULT 0;
