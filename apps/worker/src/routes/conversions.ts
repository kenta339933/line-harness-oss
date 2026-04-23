import { Hono } from 'hono';
import {
  getConversionPoints,
  getConversionPointById,
  createConversionPoint,
  deleteConversionPoint,
  trackConversion,
  getConversionEvents,
  getConversionReport,
} from '@line-crm/db';
import type { Env } from '../index.js';

const conversions = new Hono<Env>();

// ── Conversion Points ───────────────────────────────────────────────────────

// GET /api/conversions/points - list all
conversions.get('/api/conversions/points', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId') ?? undefined;
    let sql = 'SELECT * FROM conversion_points';
    const bindings: unknown[] = [];
    if (lineAccountId) {
      sql += ' WHERE (line_account_id = ? OR line_account_id IS NULL)';
      bindings.push(lineAccountId);
    }
    sql += ' ORDER BY created_at DESC';
    const stmt = bindings.length ? c.env.DB.prepare(sql).bind(...bindings) : c.env.DB.prepare(sql);
    const result = await stmt.all<{ id: string; name: string; event_type: string; value: number | null; created_at: string }>();
    return c.json({
      success: true,
      data: result.results.map((p) => ({
        id: p.id,
        name: p.name,
        eventType: p.event_type,
        value: p.value,
        createdAt: p.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/conversions/points error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/conversions/points - create
conversions.post('/api/conversions/points', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      eventType: string;
      value?: number | null;
    }>();

    if (!body.name || !body.eventType) {
      return c.json({ success: false, error: 'name and eventType are required' }, 400);
    }

    const point = await createConversionPoint(c.env.DB, body);
    return c.json({
      success: true,
      data: {
        id: point.id,
        name: point.name,
        eventType: point.event_type,
        value: point.value,
        createdAt: point.created_at,
      },
    }, 201);
  } catch (err) {
    console.error('POST /api/conversions/points error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/conversions/points/:id - delete
conversions.delete('/api/conversions/points/:id', async (c) => {
  try {
    await deleteConversionPoint(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/conversions/points/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ── Conversion Tracking ─────────────────────────────────────────────────────

// POST /api/conversions/track - record conversion
conversions.post('/api/conversions/track', async (c) => {
  try {
    const body = await c.req.json<{
      conversionPointId: string;
      friendId: string;
      userId?: string | null;
      affiliateCode?: string | null;
      metadata?: Record<string, unknown> | null;
    }>();

    if (!body.conversionPointId || !body.friendId) {
      return c.json(
        { success: false, error: 'conversionPointId and friendId are required' },
        400,
      );
    }

    const event = await trackConversion(c.env.DB, {
      conversionPointId: body.conversionPointId,
      friendId: body.friendId,
      userId: body.userId,
      affiliateCode: body.affiliateCode,
      metadata: body.metadata ? JSON.stringify(body.metadata) : null,
    });

    return c.json({
      success: true,
      data: {
        id: event.id,
        conversionPointId: event.conversion_point_id,
        friendId: event.friend_id,
        userId: event.user_id,
        affiliateCode: event.affiliate_code,
        metadata: event.metadata,
        createdAt: event.created_at,
      },
    }, 201);
  } catch (err) {
    console.error('POST /api/conversions/track error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/conversions/events - list events with filters
conversions.get('/api/conversions/events', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId') ?? undefined;
    const conversionPointId = c.req.query('conversionPointId');
    const friendId = c.req.query('friendId');
    const affiliateCode = c.req.query('affiliateCode');
    const startDate = c.req.query('startDate');
    const endDate = c.req.query('endDate');
    const limit = Number(c.req.query('limit') ?? '100');
    const offset = Number(c.req.query('offset') ?? '0');

    // アカウント別フィルタを追加した直接クエリ
    let sql = 'SELECT * FROM conversion_events';
    const conditions: string[] = [];
    const bindings: unknown[] = [];
    if (lineAccountId) {
      conditions.push('(line_account_id = ? OR line_account_id IS NULL)');
      bindings.push(lineAccountId);
    }
    if (conversionPointId) { conditions.push('conversion_point_id = ?'); bindings.push(conversionPointId); }
    if (friendId) { conditions.push('friend_id = ?'); bindings.push(friendId); }
    if (affiliateCode) { conditions.push('affiliate_code = ?'); bindings.push(affiliateCode); }
    if (startDate) { conditions.push('created_at >= ?'); bindings.push(startDate); }
    if (endDate) { conditions.push('created_at <= ?'); bindings.push(endDate); }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    bindings.push(limit, offset);
    const result = await c.env.DB.prepare(sql).bind(...bindings).all<{ id: string; conversion_point_id: string; friend_id: string; user_id: string | null; affiliate_code: string | null; metadata: string | null; created_at: string }>();

    return c.json({
      success: true,
      data: result.results.map((e) => ({
        id: e.id,
        conversionPointId: e.conversion_point_id,
        friendId: e.friend_id,
        userId: e.user_id,
        affiliateCode: e.affiliate_code,
        metadata: e.metadata,
        createdAt: e.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/conversions/events error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/conversions/report - aggregated report
conversions.get('/api/conversions/report', async (c) => {
  try {
    const report = await getConversionReport(c.env.DB, {
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
    });

    return c.json({ success: true, data: report });
  } catch (err) {
    console.error('GET /api/conversions/report error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { conversions };
