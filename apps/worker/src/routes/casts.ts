import { Hono } from 'hono';
import { requireRole } from '../middleware/role-guard.js';
import type { Env } from '../index.js';

const casts = new Hono<Env>();

// All cast endpoints are owner-only. キャスト報酬・契約情報・売上はHR/経理機密。
casts.use('/api/casts', requireRole('owner'));
casts.use('/api/casts/*', requireRole('owner'));

interface CastRow {
  id: string;
  line_account_id: string;
  stripchat_username: string;
  display_name: string | null;
  channel: string;
  contract_version: string;
  stage: string;
  rate_percent: number;
  introducer_id: string | null;
  introducer_name: string | null;
  status: string;
  joined_at: string | null;
  last_month_tokens: number;
  last_month_label: string | null;
  last_synced_at: string | null;
  notes: string | null;
  working_days: number;
  created_at: string;
  updated_at: string;
}

interface DailyRow {
  cast_id: string;
  line_account_id: string;
  date: string;
  tokens: number;
  fetched_at: string;
}

function serialize(row: CastRow) {
  return {
    id: row.id,
    lineAccountId: row.line_account_id,
    stripchatUsername: row.stripchat_username,
    displayName: row.display_name,
    channel: row.channel,
    contractVersion: row.contract_version,
    stage: row.stage,
    ratePercent: row.rate_percent,
    introducerId: row.introducer_id,
    introducerName: row.introducer_name,
    status: row.status,
    joinedAt: row.joined_at,
    lastMonthTokens: row.last_month_tokens,
    lastMonthLabel: row.last_month_label,
    lastSyncedAt: row.last_synced_at,
    notes: row.notes,
    workingDays: row.working_days,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function assertAccountExists(c: { env: Env['Bindings'] }, lineAccountId: string): Promise<boolean> {
  const row = await c.env.DB
    .prepare('SELECT id FROM line_accounts WHERE id = ?')
    .bind(lineAccountId)
    .first<{ id: string }>();
  return !!row;
}

// GET /api/casts?lineAccountId=xxx
casts.get('/api/casts', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    if (!lineAccountId) {
      return c.json({ success: false, error: 'lineAccountId is required' }, 400);
    }
    if (!(await assertAccountExists({ env: c.env }, lineAccountId))) {
      return c.json({ success: false, error: 'Account not found' }, 404);
    }
    const result = await c.env.DB
      .prepare(`SELECT * FROM casts WHERE line_account_id = ? ORDER BY status ASC, joined_at DESC, id ASC`)
      .bind(lineAccountId)
      .all<CastRow>();
    return c.json({ success: true, data: (result.results ?? []).map(serialize) });
  } catch (err) {
    console.error('GET /api/casts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/casts/:id — upsert (sync script からも使う)
casts.put('/api/casts/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      lineAccountId: string;
      stripchatUsername: string;
      displayName?: string | null;
      channel: string;
      contractVersion: string;
      stage?: string;
      ratePercent: number;
      introducerId?: string | null;
      introducerName?: string | null;
      status?: string;
      joinedAt?: string | null;
      lastMonthTokens?: number;
      lastMonthLabel?: string | null;
      workingDays?: number;
      notes?: string | null;
    }>();

    if (!body.lineAccountId || !body.stripchatUsername || !body.channel
        || !body.contractVersion || body.ratePercent == null) {
      return c.json({ success: false, error: 'Missing required fields' }, 400);
    }
    if (!['在宅', '通勤'].includes(body.channel)) {
      return c.json({ success: false, error: 'channel must be 在宅 or 通勤' }, 400);
    }
    if (!['19', '19b'].includes(body.contractVersion)) {
      return c.json({ success: false, error: 'contractVersion must be 19 or 19b' }, 400);
    }
    if (body.ratePercent < 0 || body.ratePercent > 100) {
      return c.json({ success: false, error: 'ratePercent must be 0–100' }, 400);
    }
    if (!(await assertAccountExists({ env: c.env }, body.lineAccountId))) {
      return c.json({ success: false, error: 'Account not found' }, 404);
    }

    const now = new Date().toISOString();
    await c.env.DB
      .prepare(`
        INSERT INTO casts (
          id, line_account_id, stripchat_username, display_name, channel,
          contract_version, stage, rate_percent, introducer_id, introducer_name, status,
          joined_at, last_month_tokens, last_month_label, last_synced_at,
          notes, working_days, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          line_account_id    = excluded.line_account_id,
          stripchat_username = excluded.stripchat_username,
          display_name       = excluded.display_name,
          channel            = excluded.channel,
          contract_version   = excluded.contract_version,
          stage              = excluded.stage,
          rate_percent       = excluded.rate_percent,
          introducer_id      = excluded.introducer_id,
          introducer_name    = excluded.introducer_name,
          status             = excluded.status,
          joined_at          = excluded.joined_at,
          last_month_tokens  = excluded.last_month_tokens,
          last_month_label   = excluded.last_month_label,
          last_synced_at     = excluded.last_synced_at,
          notes              = excluded.notes,
          working_days       = excluded.working_days,
          updated_at         = excluded.updated_at
      `)
      .bind(
        id,
        body.lineAccountId,
        body.stripchatUsername,
        body.displayName ?? null,
        body.channel,
        body.contractVersion,
        body.stage ?? '基本',
        body.ratePercent,
        body.introducerId ?? null,
        body.introducerName ?? null,
        body.status ?? '在籍',
        body.joinedAt ?? null,
        body.lastMonthTokens ?? 0,
        body.lastMonthLabel ?? null,
        now,
        body.notes ?? null,
        body.workingDays ?? 0,
        now,
        now,
      )
      .run();

    const row = await c.env.DB
      .prepare(`SELECT * FROM casts WHERE id = ?`)
      .bind(id)
      .first<CastRow>();
    return c.json({ success: true, data: row ? serialize(row) : null });
  } catch (err) {
    console.error('PUT /api/casts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/casts/:id — 単体取得
casts.get('/api/casts/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const row = await c.env.DB
      .prepare('SELECT * FROM casts WHERE id = ?')
      .bind(id)
      .first<CastRow>();
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: serialize(row) });
  } catch (err) {
    console.error('GET /api/casts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/casts/:id/daily-earnings?month=YYYY-MM
casts.get('/api/casts/:id/daily-earnings', async (c) => {
  try {
    const id = c.req.param('id');
    const month = c.req.query('month'); // optional YYYY-MM
    let query = 'SELECT * FROM cast_daily_earnings WHERE cast_id = ?';
    const params: (string | number)[] = [id];
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      query += ' AND date LIKE ?';
      params.push(`${month}-%`);
    }
    query += ' ORDER BY date ASC';
    const result = await c.env.DB.prepare(query).bind(...params).all<DailyRow>();
    return c.json({
      success: true,
      data: (result.results ?? []).map((r) => ({
        date: r.date, tokens: r.tokens, fetchedAt: r.fetched_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/casts/:id/daily-earnings error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/casts/:id/daily-earnings — 一括upsert
casts.put('/api/casts/:id/daily-earnings', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{ entries: { date: string; tokens: number }[] }>();
    if (!Array.isArray(body.entries)) {
      return c.json({ success: false, error: 'entries[] required' }, 400);
    }

    const cast = await c.env.DB
      .prepare('SELECT line_account_id FROM casts WHERE id = ?')
      .bind(id)
      .first<{ line_account_id: string }>();
    if (!cast) return c.json({ success: false, error: 'Cast not found' }, 404);

    const now = new Date().toISOString();
    const stmts: D1PreparedStatement[] = [];
    for (const e of body.entries) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) continue;
      const tokens = Math.max(0, Math.floor(Number(e.tokens) || 0));
      stmts.push(
        c.env.DB
          .prepare(`
            INSERT INTO cast_daily_earnings (cast_id, line_account_id, date, tokens, fetched_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(cast_id, date) DO UPDATE SET
              tokens = excluded.tokens,
              fetched_at = excluded.fetched_at
          `)
          .bind(id, cast.line_account_id, e.date, tokens, now)
      );
    }
    if (stmts.length > 0) {
      await c.env.DB.batch(stmts);
    }
    return c.json({ success: true, data: { upserted: stmts.length } });
  } catch (err) {
    console.error('PUT /api/casts/:id/daily-earnings error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/casts/:id/sync?month=YYYY-MM
// 1キャストの月次データを Studio API から取得して D1 更新。
// CFサブリクエスト制限(50)に収めるため per-cast に分割。
casts.post('/api/casts/:id/sync', async (c) => {
  try {
    const castId = c.req.param('id');
    const month = c.req.query('month');
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return c.json({ success: false, error: 'month (YYYY-MM) required' }, 400);
    }
    if (!c.env.STRIPCHAT_STUDIO_API_KEY || !c.env.STRIPCHAT_STUDIO_USERNAME) {
      return c.json({ success: false, error: 'Studio API not configured' }, 500);
    }

    const cast = await c.env.DB
      .prepare('SELECT * FROM casts WHERE id = ?')
      .bind(castId)
      .first<CastRow>();
    if (!cast) return c.json({ success: false, error: 'Cast not found' }, 404);

    const [yStr, mStr] = month.split('-');
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    const lastDay = new Date(y, m, 0).getDate();

    const studioBase = 'https://stripchat.com/api/stats/v2/studios/username';
    const studioUser = encodeURIComponent(c.env.STRIPCHAT_STUDIO_USERNAME);
    const modelUser = encodeURIComponent(cast.stripchat_username);
    const apiKey = c.env.STRIPCHAT_STUDIO_API_KEY;

    let monthlyTokens = 0;
    let workingDays = 0;
    const stmts: D1PreparedStatement[] = [];
    const nowIso = new Date().toISOString();
    let dayError: string | undefined;

    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${yStr}-${mStr}-${String(d).padStart(2, '0')}`;
      const params = new URLSearchParams({
        periodType: 'currentPayment',
        periodStart: `${dateStr} 00:00:00`,
        periodEnd: `${dateStr} 23:59:59`,
      });
      const url = `${studioBase}/${studioUser}/models/username/${modelUser}?${params.toString()}`;

      let tokens = 0;
      try {
        const resp = await fetch(url, {
          headers: {
            'API-Key': apiKey,
            'User-Agent': 'line-crm-worker/1.0',
            'Accept': 'application/json',
          },
        });
        if (resp.ok) {
          const j = await resp.json() as { totalEarnings?: number };
          tokens = Math.max(0, Math.floor(j.totalEarnings ?? 0));
        } else if (resp.status >= 500) {
          dayError = `Studio API ${resp.status} on ${dateStr}`;
        }
      } catch (err) {
        dayError = err instanceof Error ? err.message : 'fetch failed';
      }
      if (tokens > 0) workingDays++;
      monthlyTokens += tokens;
      stmts.push(
        c.env.DB
          .prepare(`
            INSERT INTO cast_daily_earnings (cast_id, line_account_id, date, tokens, fetched_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(cast_id, date) DO UPDATE SET
              tokens = excluded.tokens,
              fetched_at = excluded.fetched_at
          `)
          .bind(cast.id, cast.line_account_id, dateStr, tokens, nowIso)
      );
    }

    if (stmts.length > 0) {
      await c.env.DB.batch(stmts);
    }

    await c.env.DB
      .prepare(`
        UPDATE casts SET
          last_month_tokens = ?,
          last_month_label = ?,
          working_days = ?,
          last_synced_at = ?,
          updated_at = ?
        WHERE id = ?
      `)
      .bind(monthlyTokens, month, workingDays, nowIso, nowIso, cast.id)
      .run();

    return c.json({
      success: true,
      data: { castId: cast.id, tokens: monthlyTokens, workingDays, ...(dayError ? { error: dayError } : {}) },
    });
  } catch (err) {
    console.error('POST /api/casts/:id/sync error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/casts/:id
casts.delete('/api/casts/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await c.env.DB.prepare(`DELETE FROM casts WHERE id = ?`).bind(id).run();
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/casts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { casts };
