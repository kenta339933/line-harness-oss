-- 配信予定リマインド機能用
-- casts.line_friend_id: キャストに対応するfriendのID（LINE公式アカウントの友だち）。
--   line_liff_user_id (LIFF channelのID) とは別物。Messaging APIでpushするにはこちらが必要。
-- casts.reminder_offset_minutes: 配信開始の何分前にリマインドするか（デフォルト30分）。
-- cast_schedules.reminder_sent_at: 既にリマインド送信した予定を記録。重複送信防止。
ALTER TABLE casts ADD COLUMN line_friend_id TEXT REFERENCES friends(id) ON DELETE SET NULL;
ALTER TABLE casts ADD COLUMN reminder_offset_minutes INTEGER NOT NULL DEFAULT 30;
ALTER TABLE cast_schedules ADD COLUMN reminder_sent_at TEXT;

CREATE INDEX IF NOT EXISTS idx_casts_line_friend ON casts(line_friend_id);
CREATE INDEX IF NOT EXISTS idx_cast_schedules_reminder ON cast_schedules(reminder_sent_at) WHERE reminder_sent_at IS NULL;
