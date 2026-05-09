import { Hono } from 'hono';
import { upsertEvent as gcalUpsertEvent, deleteEvent as gcalDeleteEvent } from '../services/cast-schedule-gcal.js';
import type { Env } from '../index.js';

const castLiff = new Hono<Env>();

interface IdTokenPayload {
  sub: string;       // LINE userId
  name?: string;
  picture?: string;
}

/**
 * 単一 channel_id で ID Token を検証
 */
async function verifyLineIdTokenSingle(idToken: string, channelId: string): Promise<IdTokenPayload | null> {
  try {
    const params = new URLSearchParams({ id_token: idToken, client_id: channelId });
    const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!res.ok) return null;
    const json = await res.json() as { sub?: string; name?: string; picture?: string; error?: string };
    if (!json.sub) return null;
    return { sub: json.sub, name: json.name, picture: json.picture };
  } catch {
    return null;
  }
}

/**
 * 既知の全 channel_id を順番に試して ID Token を検証する。
 * 既知 = env LINE_LOGIN_CHANNEL_ID + line_accounts.login_channel_id すべて。
 */
async function verifyLineIdToken(idToken: string, env: Env['Bindings']): Promise<IdTokenPayload | null> {
  const candidates = new Set<string>();
  if (env.LINE_LOGIN_CHANNEL_ID) candidates.add(env.LINE_LOGIN_CHANNEL_ID);
  const accounts = await env.DB
    .prepare(`SELECT login_channel_id FROM line_accounts WHERE login_channel_id IS NOT NULL AND is_active = 1`)
    .all<{ login_channel_id: string }>();
  for (const a of accounts.results ?? []) {
    if (a.login_channel_id) candidates.add(a.login_channel_id);
  }
  for (const cid of candidates) {
    const result = await verifyLineIdTokenSingle(idToken, cid);
    if (result) return result;
  }
  return null;
}

/**
 * リクエストヘッダー X-LINE-ID-Token から ID Token を検証してキャストを引く。
 */
async function authenticateCast(c: { env: Env['Bindings']; req: { header(k: string): string | undefined }; json: (body: unknown, status?: number) => Response }) {
  const idToken = c.req.header('X-LINE-ID-Token') || c.req.header('x-line-id-token');
  if (!idToken) return { error: c.json({ success: false, error: 'X-LINE-ID-Token required' }, 401) as Response, cast: null };
  const payload = await verifyLineIdToken(idToken, c.env);
  if (!payload) return { error: c.json({ success: false, error: 'Invalid ID token' }, 401) as Response, cast: null };

  const cast = await c.env.DB
    .prepare(`SELECT id, line_account_id, stripchat_username, display_name, status, rate_percent
              FROM casts WHERE line_liff_user_id = ?`)
    .bind(payload.sub)
    .first<{
      id: string; line_account_id: string; stripchat_username: string;
      display_name: string | null; status: string; rate_percent: number;
    }>();
  if (!cast) {
    return { error: c.json({ success: false, error: 'Not bound. Please use the invite URL first.' }, 403) as Response, cast: null };
  }
  return { error: null, cast, lineUserId: payload.sub };
}

// =====================================================================
// POST /api/liff/cast/bind
// body: { inviteToken: string, idToken: string }
// 招待トークンを消費して line_liff_user_id を設定する。
// =====================================================================
castLiff.post('/api/liff/cast/bind', async (c) => {
  try {
    const body = await c.req.json<{ inviteToken?: string; idToken?: string }>();
    if (!body.inviteToken || !body.idToken) {
      return c.json({ success: false, error: 'inviteToken and idToken required' }, 400);
    }

    const payload = await verifyLineIdToken(body.idToken, c.env);
    if (!payload) {
      return c.json({ success: false, error: 'Invalid ID token' }, 401);
    }

    // 招待トークン照合
    const cast = await c.env.DB
      .prepare(`SELECT id, stripchat_username, display_name, line_liff_user_id, invite_token_expires_at
                FROM casts WHERE invite_token = ?`)
      .bind(body.inviteToken)
      .first<{
        id: string; stripchat_username: string; display_name: string | null;
        line_liff_user_id: string | null; invite_token_expires_at: string | null;
      }>();
    if (!cast) {
      return c.json({ success: false, error: 'Invalid or expired invite' }, 404);
    }
    if (cast.invite_token_expires_at && new Date(cast.invite_token_expires_at) < new Date()) {
      return c.json({ success: false, error: 'Invite token has expired' }, 410);
    }

    // 既に別のキャストが同じ LINE userId に紐付いてないか
    const existing = await c.env.DB
      .prepare(`SELECT id FROM casts WHERE line_liff_user_id = ? AND id != ?`)
      .bind(payload.sub, cast.id)
      .first<{ id: string }>();
    if (existing) {
      return c.json({
        success: false,
        error: 'このLINEアカウントは別のキャストに紐付け済みです。事務所にお問い合わせください。',
      }, 409);
    }

    const now = new Date().toISOString();
    await c.env.DB
      .prepare(`UPDATE casts SET line_liff_user_id = ?, invite_token = NULL, invite_token_expires_at = NULL, updated_at = ? WHERE id = ?`)
      .bind(payload.sub, now, cast.id)
      .run();

    return c.json({
      success: true,
      data: {
        castId: cast.id,
        stripchatUsername: cast.stripchat_username,
        displayName: cast.display_name,
      },
    });
  } catch (err) {
    console.error('POST /api/liff/cast/bind error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// =====================================================================
// GET /api/liff/cast/me
// header: X-LINE-ID-Token
// =====================================================================
castLiff.get('/api/liff/cast/me', async (c) => {
  const auth = await authenticateCast(c);
  if (auth.error) return auth.error;
  const cast = auth.cast!;
  return c.json({
    success: true,
    data: {
      castId: cast.id,
      stripchatUsername: cast.stripchat_username,
      displayName: cast.display_name,
      status: cast.status,
    },
  });
});

// =====================================================================
// GET /api/liff/cast/schedules?month=YYYY-MM
// 自分の予定 + 自分の日次実績を返す
// =====================================================================
castLiff.get('/api/liff/cast/schedules', async (c) => {
  const auth = await authenticateCast(c);
  if (auth.error) return auth.error;
  const cast = auth.cast!;

  const month = c.req.query('month');
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return c.json({ success: false, error: 'month (YYYY-MM) required' }, 400);
  }
  const monthPrefix = `${month}-%`;

  const [schedRes, earnRes] = await Promise.all([
    c.env.DB
      .prepare(`SELECT date, start_time, end_time, status, notes, source, updated_at
                FROM cast_schedules WHERE cast_id = ? AND date LIKE ?
                ORDER BY date ASC, start_time ASC`)
      .bind(cast.id, monthPrefix)
      .all<{
        date: string; start_time: string; end_time: string | null;
        status: string; notes: string | null; source: string; updated_at: string;
      }>(),
    c.env.DB
      .prepare(`SELECT date, tokens FROM cast_daily_earnings WHERE cast_id = ? AND date LIKE ?
                ORDER BY date ASC`)
      .bind(cast.id, monthPrefix)
      .all<{ date: string; tokens: number }>(),
  ]);

  return c.json({
    success: true,
    data: {
      schedules: (schedRes.results ?? []).map((r) => ({
        date: r.date,
        startTime: r.start_time,
        endTime: r.end_time,
        status: r.status,
        notes: r.notes,
        source: r.source,
        updatedAt: r.updated_at,
      })),
      dailyEarnings: (earnRes.results ?? []).map((r) => ({ date: r.date, tokens: r.tokens })),
    },
  });
});

// =====================================================================
// PUT /api/liff/cast/schedules
// body: { entries: [{date, startTime?, endTime?, status, notes?}, ...] }
// =====================================================================
castLiff.put('/api/liff/cast/schedules', async (c) => {
  const auth = await authenticateCast(c);
  if (auth.error) return auth.error;
  const cast = auth.cast!;

  const body = await c.req.json<{
    entries: { date: string; startTime?: string | null; endTime?: string | null; status: string; notes?: string | null }[];
  }>();
  if (!Array.isArray(body.entries)) {
    return c.json({ success: false, error: 'entries[] required' }, 400);
  }

  const validStatus = new Set(['planned', 'off', 'tentative']);
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;

  // 過去日の編集禁止 (今月初日より前)
  const today = new Date();
  const monthFirst = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);

  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  const acceptedEntries: Array<{ date: string; startTime: string; endTime: string | null; status: string; notes: string | null }> = [];
  let skipped = 0;
  for (const e of body.entries) {
    if (!dateRe.test(e.date)) { skipped++; continue; }
    if (e.date < monthFirst) { skipped++; continue; }
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
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'liff_cast', ?, ?)
          ON CONFLICT(cast_id, date, start_time) DO UPDATE SET
            end_time   = excluded.end_time,
            status     = excluded.status,
            notes      = excluded.notes,
            source     = excluded.source,
            updated_at = excluded.updated_at
        `)
        .bind(cast.id, cast.line_account_id, e.date, startTime, endTime, e.status, notes, now, now),
    );
  }
  if (stmts.length > 0) {
    await c.env.DB.batch(stmts);
  }

  // Google Calendar 同期 (best-effort)
  const castLabel = cast.display_name || cast.stripchat_username;
  for (const e of acceptedEntries) {
    const existing = await c.env.DB
      .prepare('SELECT google_event_id FROM cast_schedules WHERE cast_id = ? AND date = ? AND start_time = ?')
      .bind(cast.id, e.date, e.startTime)
      .first<{ google_event_id: string | null }>();
    const newEventId = await gcalUpsertEvent(c.env, {
      castId: cast.id, castLabel,
      date: e.date, startTime: e.startTime, endTime: e.endTime,
      status: e.status, notes: e.notes,
    }, existing?.google_event_id ?? null);
    if (newEventId !== existing?.google_event_id) {
      await c.env.DB
        .prepare('UPDATE cast_schedules SET google_event_id = ? WHERE cast_id = ? AND date = ? AND start_time = ?')
        .bind(newEventId, cast.id, e.date, e.startTime)
        .run();
    }
  }

  return c.json({ success: true, data: { upserted: stmts.length, skipped } });
});

// =====================================================================
// DELETE /api/liff/cast/schedules?date=YYYY-MM-DD&startTime=HH:MM
// =====================================================================
castLiff.delete('/api/liff/cast/schedules', async (c) => {
  const auth = await authenticateCast(c);
  if (auth.error) return auth.error;
  const cast = auth.cast!;

  const date = c.req.query('date');
  const startTime = c.req.query('startTime') ?? '';
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ success: false, error: 'date (YYYY-MM-DD) required' }, 400);
  }
  // 過去日は削除禁止
  const today = new Date();
  const monthFirst = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  if (date < monthFirst) {
    return c.json({ success: false, error: '過去の予定は変更できません' }, 403);
  }

  // Google Calendar イベントID取得 → DB削除前に取得
  const existing = await c.env.DB
    .prepare('SELECT google_event_id FROM cast_schedules WHERE cast_id = ? AND date = ? AND start_time = ?')
    .bind(cast.id, date, startTime)
    .first<{ google_event_id: string | null }>();

  await c.env.DB
    .prepare('DELETE FROM cast_schedules WHERE cast_id = ? AND date = ? AND start_time = ?')
    .bind(cast.id, date, startTime)
    .run();

  if (existing?.google_event_id) {
    await gcalDeleteEvent(c.env, existing.google_event_id);
  }

  return c.json({ success: true, data: null });
});

export { castLiff };
