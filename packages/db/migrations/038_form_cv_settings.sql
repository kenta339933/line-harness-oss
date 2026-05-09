-- forms に CV送信設定カラムを追加
-- on_submit_cv_event_name: フォーム送信時にad_platformsに送るイベント名（例: 'application_completed'）
-- on_submit_cv_value: 送信するCV値（円）
-- 両方ともNULL許容。設定がないフォームはCV送信されない（既存挙動を維持）。

ALTER TABLE forms ADD COLUMN on_submit_cv_event_name TEXT;
ALTER TABLE forms ADD COLUMN on_submit_cv_value INTEGER;
