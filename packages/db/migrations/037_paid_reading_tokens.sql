-- 037_paid_reading_tokens.sql
-- 有料鑑定書PDFのダウンロードトークン管理
--
-- 用途: sori 等の有料鑑定書をクライアントに届けるための署名URL管理。
--       LINE Messaging API はPDF直接添付に対応しないため、URLをテキストで送る。
--
-- 保存ポリシー:
--   expires_at      : URL アクセス期限 (発行から365日)
--   retention_until : R2 ファイル保持期限 (発行から5年)
--
-- 365日経過後は URL 無効化される。管理画面/CLIから再発行すれば旧URLは revoke される。
-- 5年経過後は Cron で R2 ファイルと本レコードを削除する（payslip_tokens の cron 流用予定）。
CREATE TABLE IF NOT EXISTS paid_reading_tokens (
  token TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,           -- 鑑定アカウント (sori = '7b0515df-...')
  client_username TEXT NOT NULL,      -- LINE名 or 内部識別 (例: 'yoko0518')
  client_real_name TEXT,              -- 表示用 (任意, 例: '富山容子')
  r2_key TEXT NOT NULL,               -- R2 オブジェクトキー
  filename TEXT NOT NULL,             -- ブラウザ表示時のファイル名
  expires_at INTEGER NOT NULL,        -- URL アクセス期限 (unix epoch 秒)
  retention_until INTEGER NOT NULL,   -- R2 ファイル保持期限 (unix epoch 秒)
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,                 -- 再発行/失効時にセット
  download_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_pr_tokens_account_client ON paid_reading_tokens(account_id, client_username);
CREATE INDEX IF NOT EXISTS idx_pr_tokens_expires ON paid_reading_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_pr_tokens_retention ON paid_reading_tokens(retention_until);
