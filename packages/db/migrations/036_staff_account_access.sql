-- スタッフごとのアカウントアクセス権
-- owner ロールはこのテーブルを参照せず全アカウントアクセス可能（アプリロジック側で bypass）。
-- admin / staff ロールはここに行があるアカウントだけアクセス可能。

CREATE TABLE IF NOT EXISTS staff_account_access (
  staff_id        TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (staff_id, line_account_id),
  FOREIGN KEY (staff_id) REFERENCES staff_members(id) ON DELETE CASCADE,
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_staff_account_access_account
  ON staff_account_access(line_account_id);

-- 既存 admin / staff を「チャトナビ」アカウントに初期バインド。
-- name='チャトナビ' という運用前提（line_accounts.name は表示名）。
-- 該当アカウントが存在しなければ何もしないので冪等。
INSERT OR IGNORE INTO staff_account_access (staff_id, line_account_id)
SELECT s.id, la.id
FROM staff_members s
CROSS JOIN line_accounts la
WHERE s.role IN ('admin', 'staff')
  AND la.name = 'チャトナビ';
