import { getLineAccounts } from '@line-crm/db';

function todayJst(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

export async function recordFriendCountSnapshots(db: D1Database): Promise<void> {
  const date = todayJst();
  const accounts = await getLineAccounts(db);
  if (accounts.length === 0) return;

  const existing = await db
    .prepare('SELECT COUNT(*) as count FROM friend_count_snapshots WHERE snapshot_date = ?')
    .bind(date)
    .first<{ count: number }>();
  if (existing && existing.count >= accounts.length) return;

  const stmts: D1PreparedStatement[] = [];
  for (const account of accounts) {
    const row = await db
      .prepare('SELECT COUNT(*) as count FROM friends WHERE is_following = 1 AND line_account_id = ?')
      .bind(account.id)
      .first<{ count: number }>();
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO friend_count_snapshots (id, line_account_id, snapshot_date, friend_count)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), account.id, date, row?.count ?? 0),
    );
  }

  if (stmts.length > 0) await db.batch(stmts);
}
