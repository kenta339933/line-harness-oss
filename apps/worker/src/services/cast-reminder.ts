/**
 * 配信予定リマインダー
 *
 * Cronで5分ごとに走る前提。
 * 各 cast_schedules で:
 *   - status = 'planned' / 'tentative'
 *   - start_time が設定されている (空文字でない)
 *   - reminder_sent_at がまだ NULL
 *   - キャストに line_friend_id が紐付いている
 * を対象に、開始時刻の `cast.reminder_offset_minutes` 分前 (デフォルト30分) を過ぎたら
 * LINE Messaging API push でリマインドを送信し、reminder_sent_at を埋める。
 *
 * 5分ごとなので「窓」を作らずに「now >= reminder_at AND now <= start_time」で判定 → 漏れ防止。
 */
import type { Env } from '../index.js';

interface ReminderRow {
  cast_id: string;
  cast_label: string;
  date: string;
  start_time: string;
  end_time: string | null;
  notes: string | null;
  reminder_offset: number;
  line_user_id: string;
  channel_access_token: string;
}

const JST_OFFSET_HOURS = 9;

function nowJstIso(): string {
  // 現在時刻を JST のISO8601文字列で返す (例: 2026-05-07T18:30:00)
  const d = new Date(Date.now() + JST_OFFSET_HOURS * 3600 * 1000);
  return d.toISOString().slice(0, 19);
}

async function pushLineMessage(
  channelAccessToken: string,
  toUserId: string,
  text: string,
): Promise<{ ok: boolean; status: number; body?: string }> {
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${channelAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: toUserId,
        messages: [{ type: 'text', text }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, status: res.status, body };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    console.error('[cast-reminder] push error:', err);
    return { ok: false, status: 0, body: String(err) };
  }
}

function buildReminderText(castLabel: string, startTime: string, endTime: string | null, offsetMin: number): string {
  const timeRange = endTime ? `${startTime}〜${endTime}` : `${startTime}〜`;
  return `🎥 配信開始 ${offsetMin}分前のお知らせ\n\n${castLabel} さん、本日 ${timeRange} の配信予定です。\n準備をお願いします！`;
}

export async function processCastReminders(env: Env['Bindings']): Promise<{ processed: number; sent: number; failed: number }> {
  const db = env.DB;

  // 候補抽出: 未送信 + 紐付け済み + 時間指定あり + 配信予定 (planned or tentative)
  // 過去24h以内に start_time があるもののみを対象 (古すぎる予定は無視)
  const result = await db
    .prepare(
      `SELECT cs.cast_id, cs.date, cs.start_time, cs.end_time, cs.notes,
              c.reminder_offset_minutes AS reminder_offset,
              c.stripchat_username, c.display_name,
              f.line_user_id, la.channel_access_token
       FROM cast_schedules cs
       INNER JOIN casts c ON c.id = cs.cast_id
       LEFT JOIN friends f ON f.id = c.line_friend_id
       LEFT JOIN line_accounts la ON la.id = c.line_account_id
       WHERE cs.reminder_sent_at IS NULL
         AND (cs.status = 'planned' OR cs.status = 'tentative')
         AND cs.start_time != ''
         AND c.line_friend_id IS NOT NULL
         AND c.status = '在籍'`,
    )
    .all<{
      cast_id: string;
      date: string;
      start_time: string;
      end_time: string | null;
      notes: string | null;
      reminder_offset: number;
      stripchat_username: string;
      display_name: string | null;
      line_user_id: string | null;
      channel_access_token: string | null;
    }>();

  const rows = result.results ?? [];
  const nowMs = Date.now();
  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.line_user_id || !row.channel_access_token) continue;

    // 開始時刻 (JST想定 → UTC換算)
    // cs.date = "2026-05-07", cs.start_time = "19:00"
    // → JSTの 2026-05-07T19:00 = UTCの 2026-05-07T10:00
    const [y, m, d] = row.date.split('-').map(Number);
    const [h, min] = row.start_time.split(':').map(Number);
    const startJstMs = Date.UTC(y, (m ?? 1) - 1, d ?? 1, h ?? 0, min ?? 0) - JST_OFFSET_HOURS * 3600 * 1000;

    const offsetMin = row.reminder_offset ?? 30;
    const triggerMs = startJstMs - offsetMin * 60 * 1000;

    // now が trigger 〜 start の間なら送信
    if (nowMs < triggerMs) continue;
    // 開始から 1時間以上経過してたら送信しない (古い未送信を救済しない)
    if (nowMs > startJstMs + 3600 * 1000) {
      // 古いものは既読扱いしてスキップ (再評価しないように)
      await db
        .prepare(`UPDATE cast_schedules SET reminder_sent_at = ? WHERE cast_id = ? AND date = ? AND start_time = ?`)
        .bind(new Date().toISOString(), row.cast_id, row.date, row.start_time)
        .run();
      continue;
    }

    const castLabel = row.display_name || row.stripchat_username;
    const text = buildReminderText(castLabel, row.start_time, row.end_time, offsetMin);

    const pushRes = await pushLineMessage(row.channel_access_token, row.line_user_id, text);
    if (pushRes.ok) {
      sent++;
    } else {
      failed++;
      console.error(`[cast-reminder] push failed for ${row.cast_id}:`, pushRes.status, pushRes.body);
    }

    // 失敗してもreminder_sent_atは埋める (5分ごとに再試行されると鬱陶しいので)
    await db
      .prepare(`UPDATE cast_schedules SET reminder_sent_at = ? WHERE cast_id = ? AND date = ? AND start_time = ?`)
      .bind(new Date().toISOString(), row.cast_id, row.date, row.start_time)
      .run();
  }

  return { processed: rows.length, sent, failed };
}

// 一時参照を消すための単純呼び出し (lint suppress)
export const _nowJstIso = nowJstIso;
