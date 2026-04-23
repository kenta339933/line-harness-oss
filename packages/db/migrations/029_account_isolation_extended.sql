-- Migration 029: アカウント分離の残り3テーブル対応
-- 調査で判明: templates / conversion_points / scoring_rules / incoming_webhooks / outgoing_webhooks は line_account_id あり
-- 以下3テーブルのみ追加:
--   - conversion_events
--   - friend_scores
--   - form_submissions
--
-- バックフィル方針: friends.line_account_id を参照して埋める（best-effort）
-- Run: wrangler d1 execute line-crm --file=packages/db/migrations/029_account_isolation_extended.sql --remote

-- Step 1: conversion_events に line_account_id を追加
ALTER TABLE conversion_events ADD COLUMN line_account_id TEXT;

-- Step 2: friend_scores に line_account_id を追加
ALTER TABLE friend_scores ADD COLUMN line_account_id TEXT;

-- Step 3: form_submissions に line_account_id を追加
ALTER TABLE form_submissions ADD COLUMN line_account_id TEXT;

-- Step 4: conversion_events を friends.line_account_id から backfill
UPDATE conversion_events
SET line_account_id = (
  SELECT f.line_account_id FROM friends f WHERE f.id = conversion_events.friend_id
)
WHERE line_account_id IS NULL;

-- Step 5: friend_scores を friends.line_account_id から backfill
UPDATE friend_scores
SET line_account_id = (
  SELECT f.line_account_id FROM friends f WHERE f.id = friend_scores.friend_id
)
WHERE line_account_id IS NULL;

-- Step 6: form_submissions を friends.line_account_id から backfill（匿名回答=NULL のまま）
UPDATE form_submissions
SET line_account_id = (
  SELECT f.line_account_id FROM friends f WHERE f.id = form_submissions.friend_id
)
WHERE line_account_id IS NULL AND friend_id IS NOT NULL;

-- Step 7: インデックス追加（アカウント別検索の高速化）
CREATE INDEX IF NOT EXISTS idx_conversion_events_account ON conversion_events (line_account_id);
CREATE INDEX IF NOT EXISTS idx_friend_scores_account ON friend_scores (line_account_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_account ON form_submissions (line_account_id);
