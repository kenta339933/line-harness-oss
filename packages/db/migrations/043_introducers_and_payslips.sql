-- 043_introducers_and_payslips.sql
-- 紹介者マスター + 紹介者報酬明細書トークン管理

-- 紹介者マスター
-- 表示用の基本情報のみ。連絡先・口座等の機微情報はDBに入れず、
-- data/credentials/introducer_accounts.yaml で別管理。
CREATE TABLE IF NOT EXISTS introducers (
  id                TEXT PRIMARY KEY,            -- INT-001 等
  line_account_id   TEXT NOT NULL,                -- 紐付くLINEアカウント (チャトナビ等)
  name              TEXT NOT NULL,                -- 表示名
  status            TEXT NOT NULL DEFAULT '在籍', -- 在籍 / 解除済
  joined_at         TEXT,                         -- 契約締結日 (YYYY-MM-DD)
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_introducers_account ON introducers(line_account_id);
CREATE INDEX IF NOT EXISTS idx_introducers_status ON introducers(status);

-- 紹介者報酬明細書トークン
-- キャスト明細書（payslip_tokens）と同じポリシー:
--   expires_at      : URL アクセス期限 (発行から60日)
--   retention_until : R2 ファイル保持期限 (発行から3年・税務/監査用途)
CREATE TABLE IF NOT EXISTS introducer_payslip_tokens (
  token             TEXT PRIMARY KEY,
  introducer_id     TEXT NOT NULL,
  month             TEXT NOT NULL,                 -- YYYY-MM
  r2_key            TEXT NOT NULL,                 -- R2 オブジェクトキー
  expires_at        INTEGER NOT NULL,              -- URL アクセス期限 (unix epoch 秒)
  retention_until   INTEGER NOT NULL,              -- R2 ファイル保持期限 (unix epoch 秒)
  created_at        INTEGER NOT NULL,
  revoked_at        INTEGER,                       -- 再発行/失効時にセット
  download_count    INTEGER NOT NULL DEFAULT 0,
  last_accessed_at  INTEGER,
  FOREIGN KEY (introducer_id) REFERENCES introducers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_intro_payslip_intro_month ON introducer_payslip_tokens(introducer_id, month);
CREATE INDEX IF NOT EXISTS idx_intro_payslip_expires ON introducer_payslip_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_intro_payslip_retention ON introducer_payslip_tokens(retention_until);
