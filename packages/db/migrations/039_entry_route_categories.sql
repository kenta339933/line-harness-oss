-- 登録経路（entry_routes）にカテゴリとLINEアカウント所属を追加
-- カテゴリ: '広告' | 'リファラル' | 'SNS' | NULL（旧データ用）
-- line_account_id: アカウント分離。NULLは全アカウント共通の旧データ。

ALTER TABLE entry_routes ADD COLUMN category TEXT;
-- line_account_id は既に過去のマイグレで追加済み（このDBでは存在）。OSSでは存在しない可能性あるので注意。
-- ALTER TABLE entry_routes ADD COLUMN line_account_id TEXT;

CREATE INDEX IF NOT EXISTS idx_entry_routes_category ON entry_routes(category);
CREATE INDEX IF NOT EXISTS idx_entry_routes_account ON entry_routes(line_account_id);
