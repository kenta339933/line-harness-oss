import type { Context, Next } from 'hono';
import type { Env } from '../index.js';

/**
 * 指定 lineAccountId に対して現在のスタッフがアクセス権を持つか確認する。
 * - role='owner' は常に true (staff_account_access を見ない)
 * - admin/staff は staff_account_access テーブルに行があれば true
 *
 * 権限が無ければ 403 Response を返す（呼び出し側はそのまま return すればよい）。
 * 権限があれば null を返す。
 */
export async function assertAccountAccess(
  c: Context<Env>,
  lineAccountId: string,
): Promise<Response | null> {
  const staff = c.get('staff');
  if (!staff) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  if (staff.role === 'owner') return null;

  const row = await c.env.DB
    .prepare('SELECT 1 AS ok FROM staff_account_access WHERE staff_id = ? AND line_account_id = ?')
    .bind(staff.id, lineAccountId)
    .first<{ ok: number }>();
  if (row) return null;

  return c.json(
    { success: false, error: 'このアカウントへのアクセス権がありません' },
    403,
  );
}

/**
 * 現在のスタッフがアクセス可能な line_account_id の配列を返す。
 * owner は null を返す（=フィルタ不要・全アクセス）。
 */
export async function getAccessibleAccountIds(
  c: Context<Env>,
): Promise<string[] | null> {
  const staff = c.get('staff');
  if (!staff) return [];
  if (staff.role === 'owner') return null;

  const result = await c.env.DB
    .prepare('SELECT line_account_id FROM staff_account_access WHERE staff_id = ?')
    .bind(staff.id)
    .all<{ line_account_id: string }>();
  return (result.results ?? []).map((r) => r.line_account_id);
}

/**
 * クエリパラメータ `lineAccountId` を見て、スタッフがそのアカウントにアクセス権を
 * 持つか自動でチェックするグローバルミドルウェア。
 * - 値が存在しない場合は素通し（lineAccountId 不要のエンドポイント）
 * - owner は素通し
 * - admin/staff は staff_account_access を見て不一致なら 403
 *
 * POST/PUT/DELETE のボディに lineAccountId が含まれるケースは対象外（個別ルートで
 * assertAccountAccess を呼ぶこと）。
 */
export async function accountAccessQueryMiddleware(
  c: Context<Env>,
  next: Next,
): Promise<Response | void> {
  const lineAccountId = c.req.query('lineAccountId');
  if (!lineAccountId) return next();
  // staff が未設定 (公開エンドポイント等) は素通し — auth middleware の管轄
  const staff = c.get('staff');
  if (!staff) return next();
  const denied = await assertAccountAccess(c, lineAccountId);
  if (denied) return denied;
  return next();
}
