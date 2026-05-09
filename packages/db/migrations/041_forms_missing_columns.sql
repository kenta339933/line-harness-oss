-- forms テーブルに不足していた webhook + CV 関連カラムを追加
-- 過去マイグレ(038)が一部DBに未適用 or 後から追加が必要だったコードがマイグレに含まれていなかったため、
-- UPDATE forms 時に undefined バインドエラーが発生していた。

-- IF NOT EXISTS は SQLite では使えないので、すでに存在する場合は手動でスキップが必要。
-- D1で実行時にエラーになる場合は、当該カラムを除いて再実行してください。
ALTER TABLE forms ADD COLUMN on_submit_webhook_url TEXT;
ALTER TABLE forms ADD COLUMN on_submit_webhook_headers TEXT;
ALTER TABLE forms ADD COLUMN on_submit_webhook_fail_message TEXT;
ALTER TABLE forms ADD COLUMN on_submit_cv_event_name TEXT;
ALTER TABLE forms ADD COLUMN on_submit_cv_value INTEGER;
