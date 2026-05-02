-- 034_payslip_tokens.sql
-- キャスト報酬明細書のダウンロードトークン管理
--
-- 保存ポリシー:
--   expires_at       : URL アクセス期限 (発行から60日)
--   retention_until  : R2 ファイル保持期限 (発行から3年・税務/監査用途)
--
-- 60日経過後は URL 無効化されるが管理画面から再発行可能。
-- 3年経過後は Cron で R2 ファイルと本レコードを削除する。
CREATE TABLE IF NOT EXISTS payslip_tokens (
  token TEXT PRIMARY KEY,
  cast_id TEXT NOT NULL,
  month TEXT NOT NULL,             -- YYYY-MM
  r2_key TEXT NOT NULL,            -- R2 オブジェクトキー
  expires_at INTEGER NOT NULL,     -- URL アクセス期限 (unix epoch 秒)
  retention_until INTEGER NOT NULL,-- R2 ファイル保持期限 (unix epoch 秒)
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,              -- 再発行/失効時にセット
  download_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at INTEGER,
  FOREIGN KEY (cast_id) REFERENCES casts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_payslip_tokens_cast_month ON payslip_tokens(cast_id, month);
CREATE INDEX IF NOT EXISTS idx_payslip_tokens_expires ON payslip_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_payslip_tokens_retention ON payslip_tokens(retention_until);
