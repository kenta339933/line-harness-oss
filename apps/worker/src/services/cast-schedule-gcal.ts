/**
 * 配信予定 (cast_schedules) を Google カレンダーへ同期するサービス。
 * 環境変数:
 *   GCAL_SA_KEY_JSON   — サービスアカウント JSON 一行
 *   GCAL_CALENDAR_ID   — 同期先カレンダー ID
 *
 * status='off' は Google にはイベント作らない (休みは予定として登録不要)
 * status='planned' / 'tentative' のみ書き込む。
 */
import { getServiceAccountAccessToken } from './google-sa-auth.js';

const GCAL_BASE = 'https://www.googleapis.com/calendar/v3';
const TIMEZONE = 'Asia/Tokyo';
const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

export interface ScheduleEntry {
  castId: string;
  castLabel: string; // stripchat_username などキャスト識別文字列
  date: string;      // YYYY-MM-DD
  startTime: string; // HH:MM ('' = 終日)
  endTime: string | null;
  status: string;    // planned / tentative / off
  notes: string | null;
}

interface CalendarConfig {
  saKeyJson: string;
  calendarId: string;
}

function isConfigured(env: { GCAL_SA_KEY_JSON?: string; GCAL_CALENDAR_ID?: string }): CalendarConfig | null {
  if (!env.GCAL_SA_KEY_JSON || !env.GCAL_CALENDAR_ID) return null;
  return { saKeyJson: env.GCAL_SA_KEY_JSON, calendarId: env.GCAL_CALENDAR_ID };
}

function buildEventBody(entry: ScheduleEntry) {
  const summary = entry.startTime
    ? `🎥 ${entry.castLabel} ${entry.startTime}${entry.endTime ? `-${entry.endTime}` : ''}`
    : `🎥 ${entry.castLabel}（終日）`;
  const description = [
    `キャスト: ${entry.castLabel}`,
    `状態: ${entry.status === 'tentative' ? '仮予定' : '配信予定'}`,
    entry.notes ? `メモ: ${entry.notes}` : null,
  ].filter(Boolean).join('\n');

  // 終日 or 時間指定
  if (!entry.startTime) {
    // 終日イベント（YYYY-MM-DD のみ）
    const endDate = new Date(entry.date);
    endDate.setDate(endDate.getDate() + 1);
    const endStr = endDate.toISOString().slice(0, 10);
    return {
      summary,
      description,
      start: { date: entry.date },
      end: { date: endStr },
    };
  }
  const start = `${entry.date}T${entry.startTime}:00`;
  const endTimeStr = entry.endTime || addHours(entry.startTime, 1);
  // 終了 < 開始 の場合は翌日扱い (例: 23:00-02:00)
  let endDate = entry.date;
  if (endTimeStr <= entry.startTime) {
    const d = new Date(entry.date);
    d.setDate(d.getDate() + 1);
    endDate = d.toISOString().slice(0, 10);
  }
  const end = `${endDate}T${endTimeStr}:00`;
  return {
    summary,
    description,
    start: { dateTime: start, timeZone: TIMEZONE },
    end: { dateTime: end, timeZone: TIMEZONE },
  };
}

function addHours(time: string, hours: number): string {
  const [h, m] = time.split(':').map(Number);
  const newH = (h + hours) % 24;
  return `${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * イベント新規作成 → eventId 返却。失敗時は null。
 */
export async function createEvent(
  env: { GCAL_SA_KEY_JSON?: string; GCAL_CALENDAR_ID?: string },
  entry: ScheduleEntry,
): Promise<string | null> {
  const cfg = isConfigured(env);
  if (!cfg) return null;
  if (entry.status === 'off') return null; // 休みは登録しない

  try {
    const accessToken = await getServiceAccountAccessToken(cfg.saKeyJson, SCOPES);
    const url = `${GCAL_BASE}/calendars/${encodeURIComponent(cfg.calendarId)}/events`;
    const body = buildEventBody(entry);
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[gcal createEvent] ${res.status}: ${text}`);
      return null;
    }
    const json = (await res.json()) as { id?: string };
    return json.id ?? null;
  } catch (err) {
    console.error('[gcal createEvent] error:', err);
    return null;
  }
}

/**
 * 既存イベント更新。eventId が無効/見つからない場合は新規作成して新IDを返す。
 */
export async function upsertEvent(
  env: { GCAL_SA_KEY_JSON?: string; GCAL_CALENDAR_ID?: string },
  entry: ScheduleEntry,
  existingEventId: string | null,
): Promise<string | null> {
  const cfg = isConfigured(env);
  if (!cfg) return null;
  if (entry.status === 'off') {
    // 状態が 'off' に変わった場合は既存イベント削除
    if (existingEventId) await deleteEvent(env, existingEventId);
    return null;
  }

  if (!existingEventId) return createEvent(env, entry);

  try {
    const accessToken = await getServiceAccountAccessToken(cfg.saKeyJson, SCOPES);
    const url = `${GCAL_BASE}/calendars/${encodeURIComponent(cfg.calendarId)}/events/${encodeURIComponent(existingEventId)}`;
    const body = buildEventBody(entry);
    const res = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 404 || res.status === 410) {
      // 元イベント削除済 → 新規作成
      return createEvent(env, entry);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[gcal upsertEvent] ${res.status}: ${text}`);
      return existingEventId;
    }
    return existingEventId;
  } catch (err) {
    console.error('[gcal upsertEvent] error:', err);
    return existingEventId;
  }
}

export async function deleteEvent(
  env: { GCAL_SA_KEY_JSON?: string; GCAL_CALENDAR_ID?: string },
  eventId: string,
): Promise<void> {
  const cfg = isConfigured(env);
  if (!cfg) return;
  try {
    const accessToken = await getServiceAccountAccessToken(cfg.saKeyJson, SCOPES);
    const url = `${GCAL_BASE}/calendars/${encodeURIComponent(cfg.calendarId)}/events/${encodeURIComponent(eventId)}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok && res.status !== 410 && res.status !== 404) {
      const text = await res.text().catch(() => '');
      console.error(`[gcal deleteEvent] ${res.status}: ${text}`);
    }
  } catch (err) {
    console.error('[gcal deleteEvent] error:', err);
  }
}
