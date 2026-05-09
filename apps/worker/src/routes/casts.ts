import { Hono } from 'hono';
import { requireRole } from '../middleware/role-guard.js';
import { upsertEvent as gcalUpsertEvent, deleteEvent as gcalDeleteEvent } from '../services/cast-schedule-gcal.js';
import type { Env } from '../index.js';

const casts = new Hono<Env>();

// Owner と admin（管理者）が閲覧・編集可。staff（一般）は不可。
// 報酬・契約情報・売上は機密だが、事務所運用上 admin もアクセス必要。
casts.use('/api/casts', requireRole('owner', 'admin'));
casts.use('/api/casts/*', requireRole('owner', 'admin'));

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
  line_liff_user_id: string | null;
  line_friend_id: string | null;
  reminder_offset_minutes: number;
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
    liffBound: !!row.line_liff_user_id,
    lineFriendId: row.line_friend_id ?? null,
    reminderOffsetMinutes: row.reminder_offset_minutes ?? 30,
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

// GET /api/casts/schedules?lineAccountId=xxx&month=YYYY-MM
// 全キャストの月次予定+実績を一括取得（カレンダー俯瞰用）
// ※ /api/casts/:id より先に登録すること（Honoのルーティング衝突回避）
casts.get('/api/casts/schedules', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    const month = c.req.query('month');
    if (!lineAccountId) {
      return c.json({ success: false, error: 'lineAccountId is required' }, 400);
    }
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return c.json({ success: false, error: 'month (YYYY-MM) required' }, 400);
    }
    const monthPrefix = `${month}-%`;

    const [schedRes, earnRes] = await Promise.all([
      c.env.DB
        .prepare(`SELECT cast_id, line_account_id, date, start_time, end_time, status, notes, source, created_at, updated_at
                  FROM cast_schedules
                  WHERE line_account_id = ? AND date LIKE ?
                  ORDER BY date ASC, cast_id ASC, start_time ASC`)
        .bind(lineAccountId, monthPrefix)
        .all<{
          cast_id: string; line_account_id: string; date: string; start_time: string;
          end_time: string | null; status: string; notes: string | null; source: string;
          created_at: string; updated_at: string;
        }>(),
      c.env.DB
        .prepare(`SELECT cast_id, date, tokens FROM cast_daily_earnings
                  WHERE line_account_id = ? AND date LIKE ?
                  ORDER BY date ASC, cast_id ASC`)
        .bind(lineAccountId, monthPrefix)
        .all<{ cast_id: string; date: string; tokens: number }>(),
    ]);

    return c.json({
      success: true,
      data: {
        schedules: (schedRes.results ?? []).map((r) => ({
          castId: r.cast_id, date: r.date, startTime: r.start_time, endTime: r.end_time,
          status: r.status, notes: r.notes, source: r.source, updatedAt: r.updated_at,
        })),
        dailyEarnings: (earnRes.results ?? []).map((r) => ({
          castId: r.cast_id, date: r.date, tokens: r.tokens,
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/casts/schedules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/casts/_introducers/:id?lineAccountId=xxx
// body: { name: string } — 該当 introducer_id を持つ全キャストの introducer_name を一括更新
casts.patch('/api/casts/_introducers/:id', async (c) => {
  const introducerId = c.req.param('id');
  const lineAccountId = c.req.query('lineAccountId');
  if (!lineAccountId) return c.json({ success: false, error: 'lineAccountId required' }, 400);
  const body = await c.req.json<{ name?: string | null }>();
  const newName = (body.name ?? '').trim() || null;
  const now = new Date().toISOString();
  const result = await c.env.DB
    .prepare(`UPDATE casts SET introducer_name = ?, updated_at = ? WHERE introducer_id = ? AND line_account_id = ?`)
    .bind(newName, now, introducerId, lineAccountId)
    .run();
  return c.json({
    success: true,
    data: { introducerId, name: newName, updated: result.meta?.changes ?? 0 },
  });
});

// GET /api/casts/_introducers?lineAccountId=xxx — 既存の紹介者リスト
casts.get('/api/casts/_introducers', async (c) => {
  const lineAccountId = c.req.query('lineAccountId');
  if (!lineAccountId) {
    return c.json({ success: false, error: 'lineAccountId required' }, 400);
  }
  const result = await c.env.DB
    .prepare(`SELECT introducer_id, introducer_name, COUNT(*) AS cast_count
              FROM casts
              WHERE line_account_id = ? AND introducer_id IS NOT NULL AND introducer_id != ''
              GROUP BY introducer_id
              ORDER BY introducer_id ASC`)
    .bind(lineAccountId)
    .all<{ introducer_id: string; introducer_name: string | null; cast_count: number }>();
  // 次の番号をサジェスト: INT-NNN 形式の最大値+1
  let nextSuggestion = 'INT-001';
  let maxNum = 0;
  for (const r of result.results ?? []) {
    const m = r.introducer_id.match(/^INT-(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  if (maxNum > 0) {
    nextSuggestion = `INT-${String(maxNum + 1).padStart(3, '0')}`;
  }
  return c.json({
    success: true,
    data: {
      introducers: (result.results ?? []).map((r) => ({
        id: r.introducer_id,
        name: r.introducer_name,
        castCount: r.cast_count,
      })),
      nextSuggestion,
    },
  });
});

// GET /api/casts/_verify-stripchat?username=xxx — Stripchatに該当ユーザーが存在するか検証
// （cast作成前に名前ミスを検出する用途）
casts.get('/api/casts/_verify-stripchat', async (c) => {
  if (!c.env.STRIPCHAT_STUDIO_API_KEY || !c.env.STRIPCHAT_STUDIO_USERNAME) {
    return c.json({ success: false, error: 'Studio API not configured' }, 500);
  }
  const username = (c.req.query('username') || '').trim();
  if (!username) {
    return c.json({ success: false, error: 'username required' }, 400);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return c.json({ success: false, error: 'invalid username format' }, 400);
  }

  const studioUser = encodeURIComponent(c.env.STRIPCHAT_STUDIO_USERNAME);
  const modelUser = encodeURIComponent(username);
  const today = new Date().toISOString().slice(0, 10);
  // periodStart/End を直近1日に絞る（軽い検証クエリ）
  const params = new URLSearchParams({
    periodType: 'currentPayment',
    periodStart: `${today} 00:00:00`,
    periodEnd: `${today} 23:59:59`,
  });
  const url = `https://stripchat.com/api/stats/v2/studios/username/${studioUser}/models/username/${modelUser}?${params.toString()}`;
  try {
    const res = await fetch(url, {
      headers: {
        'API-Key': c.env.STRIPCHAT_STUDIO_API_KEY,
        'User-Agent': 'line-crm-worker/1.0',
        'Accept': 'application/json',
      },
    });
    // 200 → 存在する。404 → 存在しない／そのスタジオに所属していない。
    if (res.status === 200) {
      const text = await res.text();
      let parsed: unknown = null;
      try { parsed = JSON.parse(text); } catch { /* keep null */ }
      return c.json({ success: true, data: { exists: true, status: 200, sample: parsed } });
    }
    if (res.status === 404) {
      return c.json({ success: true, data: { exists: false, status: 404 } });
    }
    return c.json({
      success: true,
      data: { exists: false, status: res.status, note: 'Studio APIから予期しない応答' },
    });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'fetch failed' }, 500);
  }
});

// GET /api/casts/_studio-list-debug — Stripchat Studio APIにモデル一覧APIがあるか探索
// ※ /api/casts/:id より先に登録してルート衝突回避
casts.get('/api/casts/_studio-list-debug', async (c) => {
  if (!c.env.STRIPCHAT_STUDIO_API_KEY || !c.env.STRIPCHAT_STUDIO_USERNAME) {
    return c.json({ success: false, error: 'Studio API not configured' }, 500);
  }
  const studio = encodeURIComponent(c.env.STRIPCHAT_STUDIO_USERNAME);
  const apiKey = c.env.STRIPCHAT_STUDIO_API_KEY;
  const candidates = [
    `https://stripchat.com/api/stats/v2/studios/username/${studio}/models`,
    `https://stripchat.com/api/stats/v2/studios/username/${studio}/models?limit=200`,
    `https://stripchat.com/api/stats/v2/studios/username/${studio}`,
    `https://stripchat.com/api/v2/studios/username/${studio}/models`,
    `https://stripchat.com/api/v2/studios/${studio}/models`,
    `https://stripchat.com/api/studios/username/${studio}/models`,
    `https://stripchat.com/api/stats/v1/studios/username/${studio}/models`,
  ];
  const headers = {
    'API-Key': apiKey,
    'User-Agent': 'line-crm-worker/1.0',
    'Accept': 'application/json',
  };
  const results = await Promise.all(candidates.map(async (url) => {
    try {
      const r = await fetch(url, { headers });
      const text = await r.text();
      let parsed: unknown = null;
      try { parsed = JSON.parse(text); } catch { /* keep text */ }
      return { url, status: r.status, body: parsed ?? text.slice(0, 500) };
    } catch (err) {
      return { url, status: 0, error: err instanceof Error ? err.message : 'fetch failed' };
    }
  }));
  return c.json({ success: true, data: results });
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
      lineFriendId?: string | null;
      reminderOffsetMinutes?: number | null;
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
          notes, working_days, line_friend_id, reminder_offset_minutes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          line_friend_id     = excluded.line_friend_id,
          reminder_offset_minutes = excluded.reminder_offset_minutes,
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
        body.lineFriendId ?? null,
        body.reminderOffsetMinutes ?? 30,
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

// GET /api/casts/:id/stripchat-debug?date=YYYY-MM-DD&periodType=...
// 一時デバッグ用: Stripchat Studio API の生レスポンスを確認
// startDate/endDateを別指定するとそのレンジで叩く
casts.get('/api/casts/:id/stripchat-debug', async (c) => {
  try {
    const castId = c.req.param('id');
    const date = c.req.query('date');
    const startDate = c.req.query('startDate');
    const endDate = c.req.query('endDate');
    const periodType = c.req.query('periodType') || 'currentPayment';
    if (!startDate && (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
      return c.json({ success: false, error: 'date (YYYY-MM-DD) or startDate/endDate required' }, 400);
    }
    if (!c.env.STRIPCHAT_STUDIO_API_KEY || !c.env.STRIPCHAT_STUDIO_USERNAME) {
      return c.json({ success: false, error: 'Studio API not configured' }, 500);
    }
    const cast = await c.env.DB.prepare('SELECT * FROM casts WHERE id = ?').bind(castId).first<CastRow>();
    if (!cast) return c.json({ success: false, error: 'Cast not found' }, 404);

    const studioUser = encodeURIComponent(c.env.STRIPCHAT_STUDIO_USERNAME);
    const modelUser = encodeURIComponent(cast.stripchat_username);
    const ps = startDate ? `${startDate} 00:00:00` : `${date} 00:00:00`;
    const pe = endDate ? `${endDate} 23:59:59` : `${date} 23:59:59`;
    const params = new URLSearchParams({
      periodType,
      periodStart: ps,
      periodEnd: pe,
    });
    const url = `https://stripchat.com/api/stats/v2/studios/username/${studioUser}/models/username/${modelUser}?${params.toString()}`;
    const resp = await fetch(url, {
      headers: {
        'API-Key': c.env.STRIPCHAT_STUDIO_API_KEY,
        'User-Agent': 'line-crm-worker/1.0',
        'Accept': 'application/json',
      },
    });
    const text = await resp.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { /* keep text */ }
    return c.json({
      success: true,
      data: {
        request: { url, periodType, date, modelUser: cast.stripchat_username },
        response: { status: resp.status, headers: Object.fromEntries(resp.headers.entries()), body: parsed ?? text },
      },
    });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'failed' }, 500);
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

// =====================================================================
// 配信予定表 (cast_schedules) — Phase 1
// =====================================================================

interface ScheduleRow {
  cast_id: string;
  line_account_id: string;
  date: string;
  start_time: string;
  end_time: string | null;
  status: string;
  notes: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

function serializeSchedule(row: ScheduleRow) {
  return {
    castId: row.cast_id,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    notes: row.notes,
    source: row.source,
    updatedAt: row.updated_at,
  };
}

// (GET /api/casts/schedules は :id ルートとの衝突を避けるため上部で先に登録済み)

// GET /api/casts/:id/schedules?month=YYYY-MM
// 単一キャストの月次予定（個別カレンダー用）
casts.get('/api/casts/:id/schedules', async (c) => {
  try {
    const id = c.req.param('id');
    const month = c.req.query('month');
    let query = 'SELECT * FROM cast_schedules WHERE cast_id = ?';
    const params: (string | number)[] = [id];
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      query += ' AND date LIKE ?';
      params.push(`${month}-%`);
    }
    query += ' ORDER BY date ASC, start_time ASC';
    const result = await c.env.DB.prepare(query).bind(...params).all<ScheduleRow>();
    return c.json({
      success: true,
      data: (result.results ?? []).map(serializeSchedule),
    });
  } catch (err) {
    console.error('GET /api/casts/:id/schedules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/casts/:id/schedules — 一括upsert
// body: { entries: [{ date, startTime?, endTime?, status, notes? }, ...] }
casts.put('/api/casts/:id/schedules', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      entries: {
        date: string;
        startTime?: string | null;
        endTime?: string | null;
        status: string;
        notes?: string | null;
      }[];
    }>();
    if (!Array.isArray(body.entries)) {
      return c.json({ success: false, error: 'entries[] required' }, 400);
    }

    const cast = await c.env.DB
      .prepare('SELECT id, line_account_id, stripchat_username, display_name FROM casts WHERE id = ?')
      .bind(id)
      .first<{ id: string; line_account_id: string; stripchat_username: string; display_name: string | null }>();
    if (!cast) return c.json({ success: false, error: 'Cast not found' }, 404);

    const validStatus = new Set(['planned', 'off', 'tentative']);
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;

    const now = new Date().toISOString();
    const stmts: D1PreparedStatement[] = [];
    const acceptedEntries: Array<{ date: string; startTime: string; endTime: string | null; status: string; notes: string | null }> = [];
    let skipped = 0;
    for (const e of body.entries) {
      if (!dateRe.test(e.date)) { skipped++; continue; }
      if (!validStatus.has(e.status)) { skipped++; continue; }
      const startTime = e.startTime && timeRe.test(e.startTime) ? e.startTime : '';
      const endTime = e.endTime && timeRe.test(e.endTime) ? e.endTime : null;
      const notes = e.notes ?? null;
      acceptedEntries.push({ date: e.date, startTime, endTime, status: e.status, notes });
      stmts.push(
        c.env.DB
          .prepare(`
            INSERT INTO cast_schedules (
              cast_id, line_account_id, date, start_time, end_time, status, notes, source, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)
            ON CONFLICT(cast_id, date, start_time) DO UPDATE SET
              end_time   = excluded.end_time,
              status     = excluded.status,
              notes      = excluded.notes,
              source     = excluded.source,
              updated_at = excluded.updated_at
          `)
          .bind(id, cast.line_account_id, e.date, startTime, endTime, e.status, notes, now, now)
      );
    }
    if (stmts.length > 0) {
      await c.env.DB.batch(stmts);
    }

    // Google Calendar 同期 (best-effort、失敗してもDB保存は成功扱い)
    const castLabel = cast.display_name || cast.stripchat_username;
    for (const e of acceptedEntries) {
      const existing = await c.env.DB
        .prepare('SELECT google_event_id FROM cast_schedules WHERE cast_id = ? AND date = ? AND start_time = ?')
        .bind(id, e.date, e.startTime)
        .first<{ google_event_id: string | null }>();
      const newEventId = await gcalUpsertEvent(c.env, {
        castId: cast.id, castLabel,
        date: e.date, startTime: e.startTime, endTime: e.endTime,
        status: e.status, notes: e.notes,
      }, existing?.google_event_id ?? null);
      if (newEventId !== existing?.google_event_id) {
        await c.env.DB
          .prepare('UPDATE cast_schedules SET google_event_id = ? WHERE cast_id = ? AND date = ? AND start_time = ?')
          .bind(newEventId, id, e.date, e.startTime)
          .run();
      }
    }

    return c.json({ success: true, data: { upserted: stmts.length, skipped } });
  } catch (err) {
    console.error('PUT /api/casts/:id/schedules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/casts/_sync-all-to-gcal — 既存の配信予定を一括でGoogleカレンダーに同期
// (google_event_id が NULL で status != 'off' なもの全件)
casts.post('/api/casts/_sync-all-to-gcal', async (c) => {
  try {
    const result = await c.env.DB
      .prepare(`SELECT cs.cast_id, cs.date, cs.start_time, cs.end_time, cs.status, cs.notes,
                       c.stripchat_username, c.display_name
                FROM cast_schedules cs
                INNER JOIN casts c ON c.id = cs.cast_id
                WHERE cs.google_event_id IS NULL
                  AND cs.status != 'off'
                  AND c.status = '在籍'
                ORDER BY cs.date ASC`)
      .all<{
        cast_id: string; date: string; start_time: string; end_time: string | null;
        status: string; notes: string | null;
        stripchat_username: string; display_name: string | null;
      }>();

    const rows = result.results ?? [];
    let succeeded = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const row of rows) {
      try {
        const castLabel = row.display_name || row.stripchat_username;
        const eventId = await gcalUpsertEvent(c.env, {
          castId: row.cast_id, castLabel,
          date: row.date,
          startTime: row.start_time,
          endTime: row.end_time,
          status: row.status,
          notes: row.notes,
        }, null);
        if (eventId) {
          await c.env.DB
            .prepare('UPDATE cast_schedules SET google_event_id = ? WHERE cast_id = ? AND date = ? AND start_time = ?')
            .bind(eventId, row.cast_id, row.date, row.start_time)
            .run();
          succeeded++;
        } else {
          failed++;
          errors.push(`${row.cast_id} ${row.date} ${row.start_time}: gcal returned null`);
        }
      } catch (err) {
        failed++;
        errors.push(`${row.cast_id} ${row.date}: ${err instanceof Error ? err.message : 'failed'}`);
      }
    }

    return c.json({
      success: true,
      data: { total: rows.length, succeeded, failed, errors: errors.slice(0, 10) },
    });
  } catch (err) {
    console.error('POST /api/casts/_sync-all-to-gcal error:', err);
    return c.json({ success: false, error: err instanceof Error ? err.message : 'failed' }, 500);
  }
});

// DELETE /api/casts/:id/schedules?date=YYYY-MM-DD&startTime=HH:MM
casts.delete('/api/casts/:id/schedules', async (c) => {
  try {
    const id = c.req.param('id');
    const date = c.req.query('date');
    const startTime = c.req.query('startTime') ?? '';
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return c.json({ success: false, error: 'date (YYYY-MM-DD) required' }, 400);
    }
    // Google Calendar イベントID取得 → DB削除前に取得
    const existing = await c.env.DB
      .prepare('SELECT google_event_id FROM cast_schedules WHERE cast_id = ? AND date = ? AND start_time = ?')
      .bind(id, date, startTime)
      .first<{ google_event_id: string | null }>();

    await c.env.DB
      .prepare('DELETE FROM cast_schedules WHERE cast_id = ? AND date = ? AND start_time = ?')
      .bind(id, date, startTime)
      .run();

    if (existing?.google_event_id) {
      await gcalDeleteEvent(c.env, existing.google_event_id);
    }

    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/casts/:id/schedules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// =====================================================================
// 招待トークン発行 (キャスト本人のLIFF紐付け用)
// =====================================================================

// POST /api/casts/:id/invite — 1回使い切りの招待トークンを発行する。
// 既存トークンは上書き。返り値: { token, expiresAt, url }
// 紐付け済み (line_liff_user_id != NULL) でも再発行可能（紐付け解除→再紐付け用）
casts.post('/api/casts/:id/invite', async (c) => {
  try {
    const id = c.req.param('id');
    const cast = await c.env.DB
      .prepare('SELECT id, line_account_id, stripchat_username, line_liff_user_id FROM casts WHERE id = ?')
      .bind(id)
      .first<{ id: string; line_account_id: string; stripchat_username: string; line_liff_user_id: string | null }>();
    if (!cast) return c.json({ success: false, error: 'Cast not found' }, 404);

    // LIFF ID 解決: ①キャスト所属アカウントのliff_id ②有効な他アカウントのliff_id ③env LIFF_URL
    const ownAccount = await c.env.DB
      .prepare('SELECT liff_id FROM line_accounts WHERE id = ?')
      .bind(cast.line_account_id)
      .first<{ liff_id: string | null }>();
    let liffId = ownAccount?.liff_id ?? null;
    if (!liffId) {
      const fallback = await c.env.DB
        .prepare(`SELECT liff_id FROM line_accounts WHERE liff_id IS NOT NULL AND is_active = 1 LIMIT 1`)
        .first<{ liff_id: string }>();
      liffId = fallback?.liff_id ?? null;
    }

    // 8-byte random hex (16文字, 64bit) — 短縮優先、1回使い切り24h期限なので十分
    const buf = new Uint8Array(8);
    crypto.getRandomValues(buf);
    const token = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');

    // 期限: 24時間後 ISO8601 (UTC)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    await c.env.DB
      .prepare(`UPDATE casts SET invite_token = ?, invite_token_expires_at = ?, updated_at = ? WHERE id = ?`)
      .bind(token, expiresAt, now, id)
      .run();

    // ?liffId= も付けないと main.ts が LIFF ID を取得できず liff.init() に失敗する
    if (!liffId && !c.env.LIFF_URL) {
      return c.json({
        success: false,
        error: 'LIFF設定が見つかりません。LINEアカウントのliff_idを設定するか、環境変数LIFF_URLを設定してください。',
      }, 500);
    }
    // 短縮URL: ワーカー側 /i/:token がLIFF URLに302リダイレクト
    const baseUrl = new URL(c.req.url).origin;
    const url = `${baseUrl}/i/${token}`;

    return c.json({
      success: true,
      data: {
        token,
        expiresAt,
        url,
        alreadyBound: !!cast.line_liff_user_id,
      },
    });
  } catch (err) {
    console.error('POST /api/casts/:id/invite error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/casts/:id/invite/binding — 紐付けを解除（owner/admin用、緊急時の復旧用）
casts.delete('/api/casts/:id/invite/binding', async (c) => {
  try {
    const id = c.req.param('id');
    const now = new Date().toISOString();
    await c.env.DB
      .prepare(`UPDATE casts SET line_liff_user_id = NULL, invite_token = NULL, invite_token_expires_at = NULL, updated_at = ? WHERE id = ?`)
      .bind(now, id)
      .run();
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE binding error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { casts };
