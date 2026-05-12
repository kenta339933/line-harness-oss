/**
 * 応募者ステータス自動管理 — チャトナビ専用機能
 *
 * 状態遷移:
 *   pre_application (応募前) → pre_interview (面談前) → cast (採用キャスト)
 *
 * 遷移トリガー:
 *   - 友だち追加 (follow)   → pre_application
 *   - 応募フォーム送信      → pre_interview
 *   - キャスト紐付け        → cast
 *
 * ルール:
 *   - 自動「ダウングレード」しない（cast → pre_interview への戻しは手動のみ）
 *   - チャトナビアカウント以外は更新しない
 */

const CHATONAVI_ACCOUNT_NAME = 'チャトナビ';

export type ApplicantStatus = 'pre_application' | 'pre_interview' | 'cast' | 'declined';

const STATUS_RANK: Record<ApplicantStatus, number> = {
  pre_application: 1,
  pre_interview: 2,
  cast: 3,
  declined: 0, // declined は手動のみ、自動更新では関与しない
};

/**
 * 指定アカウントがチャトナビかどうか判定
 */
export async function isChatonaviAccount(
  db: D1Database,
  lineAccountId: string | null,
): Promise<boolean> {
  if (!lineAccountId) return false;
  const row = await db
    .prepare(`SELECT name FROM line_accounts WHERE id = ? LIMIT 1`)
    .bind(lineAccountId)
    .first<{ name: string }>();
  return row?.name === CHATONAVI_ACCOUNT_NAME;
}

/**
 * friend の応募ステータスを上書き更新（必要な場合のみ）。
 *  - チャトナビアカウントでない場合は no-op
 *  - 既存ステータスが新ステータスより「上位」の場合は no-op（自動ダウングレード防止）
 *  - declined状態の場合は自動更新では上書きしない
 */
export async function upgradeApplicantStatus(
  db: D1Database,
  friendId: string,
  newStatus: ApplicantStatus,
): Promise<void> {
  const friend = await db
    .prepare(`SELECT line_account_id, applicant_status FROM friends WHERE id = ? LIMIT 1`)
    .bind(friendId)
    .first<{ line_account_id: string | null; applicant_status: string | null }>();
  if (!friend) return;

  if (!(await isChatonaviAccount(db, friend.line_account_id))) return;

  const current = (friend.applicant_status ?? null) as ApplicantStatus | null;

  // declined は自動更新でいじらない
  if (current === 'declined') return;

  // ランクが既存以上の場合のみ更新（ダウングレードしない）
  const currentRank = current ? STATUS_RANK[current] ?? 0 : 0;
  const newRank = STATUS_RANK[newStatus];
  if (newRank <= currentRank) return;

  await db
    .prepare(`UPDATE friends SET applicant_status = ? WHERE id = ?`)
    .bind(newStatus, friendId)
    .run();
}

/**
 * 強制的にステータスを設定（手動更新用 / cast紐付け解除など）。
 * チャトナビ判定だけ行う。
 */
export async function setApplicantStatus(
  db: D1Database,
  friendId: string,
  status: ApplicantStatus | null,
): Promise<void> {
  const friend = await db
    .prepare(`SELECT line_account_id FROM friends WHERE id = ? LIMIT 1`)
    .bind(friendId)
    .first<{ line_account_id: string | null }>();
  if (!friend) return;
  if (!(await isChatonaviAccount(db, friend.line_account_id))) return;
  await db
    .prepare(`UPDATE friends SET applicant_status = ? WHERE id = ?`)
    .bind(status, friendId)
    .run();
}
