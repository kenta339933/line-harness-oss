import { Hono } from 'hono';
import { jstNow } from '@line-crm/db';
import type { Env } from '../index.js';

export const adminSeed = new Hono<{ Bindings: Env['Bindings'] }>();

interface SeedFormDef {
  name: string;
  description: string;
  fields: unknown[];
  onSubmitMessageContent: string;
}

/**
 * POST /admin/seed-forms
 * 1回限りのフォーム一括 upsert 用エンドポイント。
 * 既存フォームは name + account でマッチして UPDATE（フォームID/送信履歴/submit_count はそのまま）。
 * 認証: X-Seed-Token ヘッダーが env.SEED_TOKEN と一致する場合のみ実行。
 */
adminSeed.post('/admin/seed-forms', async (c) => {
  const provided = c.req.header('X-Seed-Token') || '';
  const expected = (c.env as unknown as { SEED_TOKEN?: string }).SEED_TOKEN;
  if (!expected || provided !== expected) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const body = await c.req.json<{
    accountName: string;
    forms: SeedFormDef[];
  }>();

  const db = c.env.DB;
  const account = await db
    .prepare(`SELECT id FROM line_accounts WHERE name = ? LIMIT 1`)
    .bind(body.accountName)
    .first<{ id: string }>();
  if (!account) {
    return c.json({ error: `account not found: ${body.accountName}` }, 404);
  }

  const results: Array<{ name: string; action: 'updated' | 'created'; id: string }> = [];

  for (const formDef of body.forms) {
    const existing = await db
      .prepare(
        `SELECT id FROM forms WHERE name = ? AND (line_account_id = ? OR line_account_id IS NULL) LIMIT 1`,
      )
      .bind(formDef.name, account.id)
      .first<{ id: string }>();

    const fieldsJson = JSON.stringify(formDef.fields);
    const now = jstNow();

    if (existing) {
      await db
        .prepare(
          `UPDATE forms
           SET description = ?,
               fields = ?,
               on_submit_message_type = 'text',
               on_submit_message_content = ?,
               is_active = 1,
               line_account_id = COALESCE(line_account_id, ?),
               updated_at = ?
           WHERE id = ?`,
        )
        .bind(formDef.description, fieldsJson, formDef.onSubmitMessageContent, account.id, now, existing.id)
        .run();
      results.push({ name: formDef.name, action: 'updated', id: existing.id });
    } else {
      const id = crypto.randomUUID();
      await db
        .prepare(
          `INSERT INTO forms (id, line_account_id, name, description, fields,
             on_submit_message_type, on_submit_message_content,
             save_to_metadata, is_active, submit_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'text', ?, 1, 1, 0, ?, ?)`,
        )
        .bind(id, account.id, formDef.name, formDef.description, fieldsJson, formDef.onSubmitMessageContent, now, now)
        .run();
      results.push({ name: formDef.name, action: 'created', id });
    }
  }

  return c.json({ success: true, accountId: account.id, results });
});

/**
 * POST /admin/migrate
 * 1回限りの DDL 実行用。X-Seed-Token で認証。
 * body: { statements: string[] }
 * 既に存在するカラムを ADD しようとした場合は "duplicate column" エラーをスキップする。
 */
adminSeed.post('/admin/migrate', async (c) => {
  const provided = c.req.header('X-Seed-Token') || '';
  const expected = (c.env as unknown as { SEED_TOKEN?: string }).SEED_TOKEN;
  if (!expected || provided !== expected) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const body = await c.req.json<{ statements: string[] }>();
  const results: Array<{ sql: string; status: 'ok' | 'skipped' | 'error'; error?: string }> = [];
  for (const sql of body.statements) {
    try {
      await c.env.DB.prepare(sql).run();
      results.push({ sql, status: 'ok' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/duplicate column|already exists/i.test(msg)) {
        results.push({ sql, status: 'skipped', error: msg });
      } else {
        results.push({ sql, status: 'error', error: msg });
      }
    }
  }
  return c.json({ success: true, results });
});
