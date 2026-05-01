-- Cast (Stripchat performer) information per LINE account.
-- Visibility is controlled by line_account_id (e.g. only the チャトナビ account sees these rows).

CREATE TABLE IF NOT EXISTS casts (
  id                  TEXT PRIMARY KEY,             -- slug (rin2432 等)
  line_account_id     TEXT NOT NULL,                -- 紐付くLINEアカウント (チャトナビ等)
  stripchat_username  TEXT NOT NULL,
  display_name        TEXT,                         -- 表示名 (任意・本名は入れない)
  channel             TEXT NOT NULL,                -- 在宅 / 通勤
  contract_version    TEXT NOT NULL,                -- 19 / 19b
  stage               TEXT NOT NULL DEFAULT '基本', -- 基本 / 中位 / 最上位
  rate_percent        INTEGER NOT NULL,             -- 解決済みのキャスト取り分%
  introducer_id       TEXT,                         -- INT-001 / INT-002 / NULL
  status              TEXT NOT NULL DEFAULT '在籍', -- 在籍 / 退所
  joined_at           TEXT,                         -- 入店日 (YYYY-MM-DD)
  last_month_tokens   INTEGER NOT NULL DEFAULT 0,   -- 直近月の totalEarnings
  last_month_label    TEXT,                         -- 例: 2026-04
  last_synced_at      TEXT,                         -- 最終同期時刻 (ISO8601)
  notes               TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_casts_account ON casts(line_account_id);
CREATE INDEX IF NOT EXISTS idx_casts_status ON casts(status);
