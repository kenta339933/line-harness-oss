-- Migration 028: アカウント別チャット分離
-- 目的:
--   - messages_log に line_account_id を追加
--   - 既存の chats / messages_log を friends.line_account_id で backfill
--   - これ以降は webhook が作成するチャット / メッセージは明示的に line_account_id を保存する
--
-- 注意:
--   - chats.line_account_id は既に migration 008 で追加済み (NULL許容)
--   - 既存データは backfill で埋める（friend の現在の line_account_id を採用する best-effort）
--   - 1人の LINE ユーザーが複数アカウントをフォロー済みの場合、過去データは完全には正確に分離できない
--     （friends テーブルが line_user_id UNIQUE で 1 レコード / LINE user しか持てない既存制約のため）
--   - 今後の新規データは webhook が正確に line_account_id をセットするため、正しく分離される
-- Run: wrangler d1 execute line-crm --file=packages/db/migrations/028_chat_account_isolation.sql --remote

-- Step 1: messages_log に line_account_id カラム追加
ALTER TABLE messages_log ADD COLUMN line_account_id TEXT;

-- Step 2: 既存 chats.line_account_id を friends.line_account_id から backfill
UPDATE chats
SET line_account_id = (
  SELECT f.line_account_id
  FROM friends f
  WHERE f.id = chats.friend_id
)
WHERE line_account_id IS NULL;

-- Step 3: 既存 messages_log.line_account_id を friends.line_account_id から backfill
UPDATE messages_log
SET line_account_id = (
  SELECT f.line_account_id
  FROM friends f
  WHERE f.id = messages_log.friend_id
)
WHERE line_account_id IS NULL;

-- Step 4: アカウント別検索を高速化するインデックス
CREATE INDEX IF NOT EXISTS idx_chats_line_account ON chats (line_account_id);
CREATE INDEX IF NOT EXISTS idx_messages_log_line_account ON messages_log (line_account_id);
CREATE INDEX IF NOT EXISTS idx_chats_friend_account ON chats (friend_id, line_account_id);
