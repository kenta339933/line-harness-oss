-- キャスト本人がLIFFで自分の予定を入力できるようにする紐付け
-- line_liff_user_id  : LIFFのlineUserId（LINE Login channel配下の本人ID）
-- invite_token       : 1回使い切りの紐付けトークン
-- invite_token_expires_at: トークン期限切れ判定用（24h想定）
-- 既存casts行は影響なし。

ALTER TABLE casts ADD COLUMN line_liff_user_id TEXT;
ALTER TABLE casts ADD COLUMN invite_token TEXT;
ALTER TABLE casts ADD COLUMN invite_token_expires_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_casts_line_liff_user_id
  ON casts(line_liff_user_id) WHERE line_liff_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_casts_invite_token
  ON casts(invite_token) WHERE invite_token IS NOT NULL;
