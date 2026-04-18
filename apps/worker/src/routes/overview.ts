import { Hono } from 'hono';
import { getLineAccounts } from '@line-crm/db';
import type { Env } from '../index.js';

const overview = new Hono<Env>();

function todayJst(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function yesterdayJst(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

// GET /api/overview — cross-account dashboard summary
overview.get('/api/overview', async (c) => {
  try {
    const db = c.env.DB;
    const accounts = await getLineAccounts(db);
    const today = todayJst();
    const yesterday = yesterdayJst();

    const items = await Promise.all(
      accounts.map(async (account) => {
        const [friendRow, yesterdayRow, todayRow, unreadRow] = await Promise.all([
          db
            .prepare('SELECT COUNT(*) as count FROM friends WHERE is_following = 1 AND line_account_id = ?')
            .bind(account.id)
            .first<{ count: number }>(),
          db
            .prepare('SELECT friend_count FROM friend_count_snapshots WHERE line_account_id = ? AND snapshot_date = ?')
            .bind(account.id, yesterday)
            .first<{ friend_count: number }>(),
          db
            .prepare('SELECT friend_count FROM friend_count_snapshots WHERE line_account_id = ? AND snapshot_date = ?')
            .bind(account.id, today)
            .first<{ friend_count: number }>(),
          db
            .prepare(
              `SELECT COUNT(*) as count FROM chats c
               INNER JOIN friends f ON f.id = c.friend_id
               WHERE f.line_account_id = ? AND c.status = 'unread'`,
            )
            .bind(account.id)
            .first<{ count: number }>(),
        ]);

        const friendCount = friendRow?.count ?? 0;
        const yesterdayCount = yesterdayRow?.friend_count ?? null;
        const todayCount = todayRow?.friend_count ?? null;
        const delta = yesterdayCount !== null ? friendCount - yesterdayCount : null;

        return {
          accountId: account.id,
          channelId: account.channel_id,
          name: account.name,
          isActive: Boolean(account.is_active),
          friendCount,
          yesterdayCount,
          todaySnapshotCount: todayCount,
          delta,
          unreadCount: unreadRow?.count ?? 0,
        };
      }),
    );

    return c.json({ success: true, data: items });
  } catch (err) {
    console.error('GET /api/overview error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { overview };
