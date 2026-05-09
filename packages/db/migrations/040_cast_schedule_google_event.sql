-- Google Calendar 連携用: 配信予定とGoogleイベントを紐付ける
-- google_event_id があれば既存イベント更新、無ければ新規作成
ALTER TABLE cast_schedules ADD COLUMN google_event_id TEXT;
CREATE INDEX IF NOT EXISTS idx_cast_schedules_gevent ON cast_schedules(google_event_id);
