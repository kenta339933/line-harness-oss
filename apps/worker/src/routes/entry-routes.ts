import { Hono } from 'hono';
import {
  getEntryRoutes,
  createEntryRoute,
  updateEntryRoute,
  deleteEntryRoute,
} from '@line-crm/db';
import type { Env } from '../index.js';

const entryRoutes = new Hono<Env>();

const VALID_CATEGORIES = ['広告', 'リファラル', 'SNS'] as const;
type Category = typeof VALID_CATEGORIES[number];

interface EntryRouteRow {
  id: string;
  ref_code: string;
  name: string;
  tag_id: string | null;
  scenario_id: string | null;
  redirect_url: string | null;
  is_active: number;
  category: string | null;
  line_account_id: string | null;
  created_at: string;
  updated_at: string;
}

function serialize(row: EntryRouteRow) {
  return {
    id: row.id,
    refCode: row.ref_code,
    name: row.name,
    tagId: row.tag_id,
    scenarioId: row.scenario_id,
    redirectUrl: row.redirect_url,
    isActive: Boolean(row.is_active),
    category: row.category,
    lineAccountId: row.line_account_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/entry-routes?lineAccountId=xxx
entryRoutes.get('/api/entry-routes', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId') ?? null;
    let sql = 'SELECT * FROM entry_routes';
    const bindings: unknown[] = [];
    if (lineAccountId) {
      sql += ' WHERE (line_account_id = ? OR line_account_id IS NULL)';
      bindings.push(lineAccountId);
    }
    sql += ' ORDER BY category ASC, name ASC';
    const stmt = bindings.length
      ? c.env.DB.prepare(sql).bind(...bindings)
      : c.env.DB.prepare(sql);
    const result = await stmt.all<EntryRouteRow>();
    // 各経路の登録友だち数も取得
    const rows = result.results ?? [];
    const data = await Promise.all(rows.map(async (row) => {
      const stats = await c.env.DB
        .prepare(`SELECT COUNT(DISTINCT friend_id) AS count FROM ref_tracking WHERE ref_code = ? AND friend_id IS NOT NULL`)
        .bind(row.ref_code)
        .first<{ count: number }>();
      return { ...serialize(row), friendCount: stats?.count ?? 0 };
    }));
    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/entry-routes error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/entry-routes
entryRoutes.post('/api/entry-routes', async (c) => {
  try {
    const body = await c.req.json<{
      refCode: string;
      name: string;
      category?: string | null;
      tagId?: string | null;
      scenarioId?: string | null;
      redirectUrl?: string | null;
      isActive?: boolean;
      lineAccountId?: string | null;
    }>();

    if (!body.refCode || !body.name) {
      return c.json({ success: false, error: 'refCode and name are required' }, 400);
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(body.refCode)) {
      return c.json({ success: false, error: 'refCode must be alphanumeric/-/_ only' }, 400);
    }
    if (body.category && !VALID_CATEGORIES.includes(body.category as Category)) {
      return c.json({ success: false, error: `invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` }, 400);
    }

    // 既存チェック (UNIQUE constraint on ref_code)
    const existing = await c.env.DB
      .prepare('SELECT id FROM entry_routes WHERE ref_code = ?')
      .bind(body.refCode)
      .first<{ id: string }>();
    if (existing) {
      return c.json({ success: false, error: `ref_code「${body.refCode}」は既に存在します` }, 409);
    }

    const created = await createEntryRoute(c.env.DB, {
      refCode: body.refCode,
      name: body.name,
      tagId: body.tagId ?? null,
      scenarioId: body.scenarioId ?? null,
      redirectUrl: body.redirectUrl ?? null,
      isActive: body.isActive,
    });

    // category と line_account_id を別途UPDATE
    if (body.category || body.lineAccountId) {
      await c.env.DB
        .prepare('UPDATE entry_routes SET category = ?, line_account_id = ? WHERE id = ?')
        .bind(body.category ?? null, body.lineAccountId ?? null, created.id)
        .run();
    }

    const row = await c.env.DB
      .prepare('SELECT * FROM entry_routes WHERE id = ?')
      .bind(created.id)
      .first<EntryRouteRow>();
    return c.json({ success: true, data: row ? serialize(row) : null }, 201);
  } catch (err) {
    console.error('POST /api/entry-routes error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/entry-routes/:id
entryRoutes.put('/api/entry-routes/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      refCode?: string;
      name?: string;
      category?: string | null;
      tagId?: string | null;
      scenarioId?: string | null;
      redirectUrl?: string | null;
      isActive?: boolean;
      lineAccountId?: string | null;
    }>();

    if (body.refCode && !/^[a-zA-Z0-9_-]+$/.test(body.refCode)) {
      return c.json({ success: false, error: 'refCode must be alphanumeric/-/_ only' }, 400);
    }
    if (body.category && !VALID_CATEGORIES.includes(body.category as Category)) {
      return c.json({ success: false, error: `invalid category` }, 400);
    }

    // ref_code 重複チェック
    if (body.refCode) {
      const existing = await c.env.DB
        .prepare('SELECT id FROM entry_routes WHERE ref_code = ? AND id != ?')
        .bind(body.refCode, id)
        .first<{ id: string }>();
      if (existing) {
        return c.json({ success: false, error: `ref_code「${body.refCode}」は他の経路で使用中` }, 409);
      }
    }

    await updateEntryRoute(c.env.DB, id, {
      refCode: body.refCode,
      name: body.name,
      tagId: body.tagId,
      scenarioId: body.scenarioId,
      redirectUrl: body.redirectUrl,
      isActive: body.isActive,
    });

    // category と line_account_id を別途更新
    if (body.category !== undefined || body.lineAccountId !== undefined) {
      const setClauses: string[] = [];
      const values: unknown[] = [];
      if (body.category !== undefined) { setClauses.push('category = ?'); values.push(body.category); }
      if (body.lineAccountId !== undefined) { setClauses.push('line_account_id = ?'); values.push(body.lineAccountId); }
      values.push(id);
      await c.env.DB
        .prepare(`UPDATE entry_routes SET ${setClauses.join(', ')} WHERE id = ?`)
        .bind(...values)
        .run();
    }

    const row = await c.env.DB
      .prepare('SELECT * FROM entry_routes WHERE id = ?')
      .bind(id)
      .first<EntryRouteRow>();
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: serialize(row) });
  } catch (err) {
    console.error('PUT /api/entry-routes/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/entry-routes/:id
entryRoutes.delete('/api/entry-routes/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await deleteEntryRoute(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/entry-routes/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { entryRoutes };
