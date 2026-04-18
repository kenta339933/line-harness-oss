-- Daily friend count snapshots per LINE account.
-- Enables day-over-day growth metrics on the cross-account overview dashboard.

CREATE TABLE IF NOT EXISTS friend_count_snapshots (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT REFERENCES line_accounts (id) ON DELETE CASCADE,
  snapshot_date   TEXT NOT NULL, -- YYYY-MM-DD in JST
  friend_count    INTEGER NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_snapshots_account_date
  ON friend_count_snapshots (line_account_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_friend_snapshots_date
  ON friend_count_snapshots (snapshot_date);
