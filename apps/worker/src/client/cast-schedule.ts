/**
 * LIFF: キャスト本人の配信予定入力ページ
 *
 * Flow:
 * 1. liff.init() + login (main.ts で済み)
 * 2. ?invite=TOKEN がURLにあれば /api/liff/cast/bind を叩いて line_liff_user_id を保存
 * 3. /api/liff/cast/me で自分のキャスト情報を取得
 * 4. 月カレンダーを描画。タップで予定編集モーダル
 *
 * 対象API:
 * - POST /api/liff/cast/bind         body:{inviteToken, idToken}
 * - GET  /api/liff/cast/me           header:X-LINE-ID-Token
 * - GET  /api/liff/cast/schedules?month=YYYY-MM
 * - PUT  /api/liff/cast/schedules    body:{entries:[]}
 * - DELETE /api/liff/cast/schedules?date=...&startTime=...
 */

declare const liff: {
  isLoggedIn(): boolean;
  login(opts?: { redirectUri?: string }): void;
  getProfile(): Promise<{ userId: string; displayName: string; pictureUrl?: string }>;
  getIDToken(): string | null;
  closeWindow(): void;
};

const JPY_PER_TOKEN = 8;

interface ScheduleEntry {
  date: string;
  startTime: string;
  endTime: string | null;
  status: 'planned' | 'off' | 'tentative';
  notes: string | null;
  source: string;
  updatedAt: string;
}
interface DailyEarning { date: string; tokens: number }
interface CastInfo { castId: string; stripchatUsername: string; displayName: string | null; status: string }

const state: {
  cast: CastInfo | null;
  month: string;
  schedules: ScheduleEntry[];
  earnings: DailyEarning[];
  loading: boolean;
} = {
  cast: null,
  month: ymOf(new Date()),
  schedules: [],
  earnings: [],
  loading: true,
};

function ymOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return ymOf(d);
}
function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
function firstWeekdayOf(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).getDay();
}
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const idToken = liff.getIDToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { 'X-LINE-ID-Token': idToken } : {}),
      ...init?.headers,
    },
  });
  return res.json() as Promise<T>;
}

function readQueryParam(name: string): string | null {
  try {
    const search = new URLSearchParams(location.search);
    const direct = search.get(name);
    if (direct) return direct;
    const liffState = search.get('liff.state');
    if (liffState) {
      const inner = new URLSearchParams(liffState.startsWith('?') ? liffState.slice(1) : liffState);
      const v = inner.get(name);
      if (v) return v;
    }
  } catch {
    /* malformed URL — return null */
  }
  return null;
}

async function consumeInviteIfAny(): Promise<{ ok: boolean; error?: string }> {
  const inviteToken = readQueryParam('invite');
  if (!inviteToken) return { ok: true };
  const idToken = liff.getIDToken();
  if (!idToken) return { ok: false, error: 'IDトークン取得失敗' };
  const res = await fetch('/api/liff/cast/bind', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inviteToken, idToken }),
  });
  const json = await res.json() as { success: boolean; error?: string };
  if (!json.success) return { ok: false, error: json.error || '紐付けに失敗しました' };
  // 招待トークンをURLから消す（iOS SafariでreplaceStateが失敗することがあるのでベストエフォート）
  try {
    const url = new URL(location.href);
    url.searchParams.delete('invite');
    history.replaceState(null, '', url.toString());
  } catch {
    /* ignore — ブックマーク等を汚さないだけのcleanupなので失敗してもOK */
  }
  return { ok: true };
}

async function loadSelf(): Promise<CastInfo | null> {
  const res = await api<{ success: boolean; data?: CastInfo; error?: string }>('/api/liff/cast/me');
  if (!res.success || !res.data) return null;
  return res.data;
}

async function loadMonth(): Promise<void> {
  state.loading = true;
  render();
  try {
    const res = await api<{ success: boolean; data?: { schedules: ScheduleEntry[]; dailyEarnings: DailyEarning[] }; error?: string }>(
      `/api/liff/cast/schedules?month=${encodeURIComponent(state.month)}`,
    );
    if (res.success && res.data) {
      state.schedules = res.data.schedules;
      state.earnings = res.data.dailyEarnings;
    } else {
      alert(`予定取得エラー: ${res.error ?? '不明'}`);
    }
  } catch (err) {
    alert(`通信エラー: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    state.loading = false;
    render();
  }
}

function styles(): string {
  return `
    .cs-wrap { max-width: 480px; margin: 0 auto; padding: 12px; }
    .cs-header { background: #06C755; color: #fff; padding: 14px 16px; border-radius: 12px; margin-bottom: 12px; }
    .cs-header h2 { font-size: 16px; margin-bottom: 2px; }
    .cs-header p { font-size: 12px; opacity: 0.9; }
    .cs-monthbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .cs-monthbar button { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 6px 12px; font-size: 14px; }
    .cs-monthbar .mlabel { font-size: 14px; font-weight: 600; }
    .cs-legend { display: flex; flex-wrap: wrap; gap: 8px; font-size: 11px; color: #666; margin-bottom: 8px; }
    .cs-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
    .cs-cell, .cs-head, .cs-empty { background: #fff; border-radius: 6px; min-height: 48px; padding: 4px; text-align: center; font-size: 12px; }
    .cs-head { background: transparent; min-height: auto; padding: 4px 0; font-weight: 600; color: #666; }
    .cs-head.sat { color: #2563eb; }
    .cs-head.sun { color: #dc2626; }
    .cs-cell { cursor: pointer; border: 1px solid transparent; transition: border-color 0.15s; }
    .cs-cell:active { border-color: #06C755; }
    .cs-cell.past { opacity: 0.5; cursor: not-allowed; }
    .cs-cell.today { border-color: #06C755; }
    .cs-cell .day { font-weight: 600; color: #111; }
    .cs-cell .emoji { font-size: 14px; line-height: 1.1; }
    .cs-cell .tk { font-size: 9px; color: #888; }
    .cs-cell.planned { background: #dbeafe; }
    .cs-cell.achieved { background: #d1fae5; }
    .cs-cell.absent { background: #fecaca; }
    .cs-cell.off { background: #fff; color: #d1d5db; border-color: #e5e7eb; }
    .cs-empty { background: transparent; border: none; }
    /* modal */
    .cs-modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: flex-end; justify-content: center; z-index: 100; }
    .cs-modal { background: #fff; border-radius: 16px 16px 0 0; width: 100%; max-width: 480px; padding: 16px; max-height: 80vh; overflow-y: auto; }
    .cs-modal h3 { font-size: 16px; margin-bottom: 4px; }
    .cs-modal .sub { font-size: 12px; color: #666; margin-bottom: 12px; }
    .cs-modal .field { margin-bottom: 10px; }
    .cs-modal label { font-size: 11px; color: #666; display: block; margin-bottom: 4px; }
    .cs-modal select, .cs-modal input { width: 100%; font-size: 14px; padding: 8px 10px; border: 1px solid #ddd; border-radius: 8px; }
    .cs-modal .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .cs-modal .actions { display: flex; gap: 8px; margin-top: 12px; }
    .cs-modal .btn-primary { flex: 1; background: #06C755; color: #fff; border: none; padding: 12px; border-radius: 8px; font-weight: 600; font-size: 14px; }
    .cs-modal .btn-cancel { flex: 1; background: #fff; color: #555; border: 1px solid #ddd; padding: 12px; border-radius: 8px; font-size: 14px; }
    .cs-modal .existing { background: #f3f4f6; border-radius: 8px; padding: 8px; margin-bottom: 10px; font-size: 13px; }
    .cs-modal .existing .slot-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; }
    .cs-modal .existing .del { color: #dc2626; font-size: 12px; background: none; border: none; }
    .cs-error { color: #dc2626; font-size: 12px; margin-top: 6px; }
    .cs-loading { text-align: center; color: #999; padding: 24px; font-size: 14px; }
  `;
}

interface CellInfo { kind: string; emoji: string; tokens: number; slots: ScheduleEntry[] }
function classifyDay(date: string): CellInfo {
  const slots = state.schedules.filter((s) => s.date === date);
  const earn = state.earnings.find((e) => e.date === date);
  const tokens = earn?.tokens ?? 0;
  const isPast = date < todayStr();
  // 実績優先
  if (tokens > 0) return { kind: 'achieved', emoji: '🟢', tokens, slots };
  // tentative も planned と同じ扱い
  const hasPlanned = slots.some((s) => s.status === 'planned' || s.status === 'tentative');
  if (hasPlanned) {
    // 過去日のみ欠勤判定。今日・未来は配信予定のまま
    return isPast
      ? { kind: 'absent', emoji: '🔴', tokens, slots }
      : { kind: 'planned', emoji: '🔵', tokens, slots };
  }
  // 予定なし = デフォルト「休み」表示（薄いダッシュ）
  return { kind: 'off', emoji: '−', tokens, slots };
}

function render(): void {
  const container = document.getElementById('app')!;
  if (!state.cast) {
    container.innerHTML = `<div class="cs-loading">読み込み中...</div>`;
    return;
  }
  const cast = state.cast;
  const today = todayStr();
  const days = daysInMonth(state.month);
  const firstW = firstWeekdayOf(state.month);

  let cells = '';
  // weekday header
  const dows = ['日', '月', '火', '水', '木', '金', '土'];
  for (let i = 0; i < 7; i++) {
    const cls = i === 0 ? ' sun' : i === 6 ? ' sat' : '';
    cells += `<div class="cs-head${cls}">${dows[i]}</div>`;
  }
  // empty cells before day 1
  for (let i = 0; i < firstW; i++) cells += `<div class="cs-empty"></div>`;
  for (let d = 1; d <= days; d++) {
    const dateStr = `${state.month}-${String(d).padStart(2, '0')}`;
    const info = classifyDay(dateStr);
    const isPast = dateStr < today.slice(0, 10);
    const isToday = dateStr === today;
    const cls = ['cs-cell', info.kind, isPast ? 'past' : '', isToday ? 'today' : ''].filter(Boolean).join(' ');
    cells += `
      <div class="${cls}" data-date="${dateStr}">
        <div class="day">${d}</div>
        <div class="emoji">${info.emoji}</div>
        ${info.tokens > 0 ? `<div class="tk">${info.tokens.toLocaleString()}</div>` : ''}
      </div>
    `;
  }

  container.innerHTML = `
    <style>${styles()}</style>
    <div class="cs-wrap">
      <div class="cs-header">
        <h2>配信予定表</h2>
        <p>${escapeHtml(cast.displayName || cast.stripchatUsername)} さん</p>
      </div>
      <div class="cs-monthbar">
        <button id="prev">‹ 前月</button>
        <span class="mlabel">${state.month}</span>
        <button id="next">翌月 ›</button>
      </div>
      <div class="cs-legend">
        <span>🔵 配信予定</span>
        <span>🟢 実績</span>
        <span>🔴 欠勤</span>
        <span style="display:inline-flex;align-items:center;gap:4px;"><span style="display:inline-block;width:10px;height:10px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:2px;"></span>休み</span>
      </div>
      <button id="cs-bulk" style="width:100%;margin-bottom:8px;padding:10px;font-size:14px;font-weight:600;background:#06C755;color:#fff;border:none;border-radius:8px;">📅 まとめて入力</button>
      ${state.loading
        ? `<div class="cs-loading">読み込み中...</div>`
        : `<div class="cs-grid">${cells}</div>`
      }
      <p style="font-size:11px;color:#888;margin-top:10px;text-align:center;">日付をタップして予定を入力</p>
    </div>
  `;

  document.getElementById('prev')!.addEventListener('click', () => {
    state.month = shiftMonth(state.month, -1);
    loadMonth();
  });
  document.getElementById('next')!.addEventListener('click', () => {
    state.month = shiftMonth(state.month, +1);
    loadMonth();
  });
  document.getElementById('cs-bulk')!.addEventListener('click', () => openBulkModal());
  document.querySelectorAll<HTMLElement>('.cs-cell').forEach((el) => {
    if (el.classList.contains('past')) return;
    el.addEventListener('click', () => {
      const date = el.dataset.date!;
      openEditModal(date);
    });
  });
}

function openBulkModal(): void {
  const today = new Date();
  // デフォルト期間: 翌月初日から月末
  const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const nextEnd = new Date(today.getFullYear(), today.getMonth() + 2, 0);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayIso = fmt(today);
  const defaultStart = fmt(next);
  const defaultEnd = fmt(nextEnd);

  const modal = document.createElement('div');
  modal.className = 'cs-modal-bg';
  modal.innerHTML = `
    <div class="cs-modal" style="padding:16px;">
      <h3 style="font-size:16px;margin-bottom:4px;">📅 まとめて入力</h3>
      <p class="sub">期間と曜日でまとめて登録します</p>

      <div class="row2">
        <div class="field">
          <label>開始日</label>
          <input type="date" id="bk-start" value="${defaultStart}" min="${todayIso}" />
        </div>
        <div class="field">
          <label>終了日</label>
          <input type="date" id="bk-end" value="${defaultEnd}" min="${todayIso}" />
        </div>
      </div>

      <div class="field">
        <label>曜日</label>
        <div style="display:flex;gap:4px;margin-bottom:6px;">
          <button type="button" data-preset="all" style="flex:1;padding:6px;font-size:11px;background:#f3f4f6;border:none;border-radius:4px;">毎日</button>
          <button type="button" data-preset="weekday" style="flex:1;padding:6px;font-size:11px;background:#f3f4f6;border:none;border-radius:4px;">平日</button>
          <button type="button" data-preset="weekend" style="flex:1;padding:6px;font-size:11px;background:#f3f4f6;border:none;border-radius:4px;">週末</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;" id="bk-dows">
          ${['日', '月', '火', '水', '木', '金', '土'].map((d, i) => `
            <button type="button" data-dow="${i}" data-on="1" style="padding:8px 0;font-size:13px;font-weight:600;background:#d1fae5;color:#06A056;border:1px solid #06C755;border-radius:6px;">${d}</button>
          `).join('')}
        </div>
      </div>

      <div class="field">
        <label>状態</label>
        <select id="bk-status">
          <option value="planned">🔵 配信予定</option>
          <option value="off">⬛ 休み</option>
        </select>
      </div>

      <div class="row2" id="bk-time-row">
        <div class="field">
          <label>開始時刻 (任意)</label>
          <input type="time" id="bk-stime" />
        </div>
        <div class="field">
          <label>終了時刻 (任意)</label>
          <input type="time" id="bk-etime" />
        </div>
      </div>

      <div class="field">
        <label>メモ (任意)</label>
        <input type="text" id="bk-notes" placeholder="例: GW期間" />
      </div>

      <p id="bk-preview" style="font-size:12px;color:#1d4ed8;background:#dbeafe;padding:6px;border-radius:6px;margin-bottom:8px;"></p>
      <p id="bk-error" class="cs-error"></p>

      <div class="actions">
        <button class="btn-cancel" id="bk-cancel">キャンセル</button>
        <button class="btn-primary" id="bk-apply">適用</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) document.body.removeChild(modal); });

  const dowButtons = modal.querySelectorAll<HTMLButtonElement>('#bk-dows button[data-dow]');
  const setDowOn = (btn: HTMLButtonElement, on: boolean) => {
    btn.dataset.on = on ? '1' : '0';
    if (on) {
      btn.style.background = '#d1fae5';
      btn.style.color = '#06A056';
      btn.style.borderColor = '#06C755';
    } else {
      btn.style.background = '#fff';
      btn.style.color = '#9ca3af';
      btn.style.borderColor = '#e5e7eb';
    }
  };
  dowButtons.forEach((btn) => {
    btn.addEventListener('click', () => setDowOn(btn, btn.dataset.on !== '1'));
  });
  modal.querySelectorAll<HTMLButtonElement>('button[data-preset]').forEach((p) => {
    p.addEventListener('click', () => {
      const preset = p.dataset.preset!;
      dowButtons.forEach((btn) => {
        const dow = Number(btn.dataset.dow);
        if (preset === 'all') setDowOn(btn, true);
        else if (preset === 'weekday') setDowOn(btn, dow >= 1 && dow <= 5);
        else if (preset === 'weekend') setDowOn(btn, dow === 0 || dow === 6);
      });
      updatePreview();
    });
  });

  const statusSel = modal.querySelector<HTMLSelectElement>('#bk-status')!;
  const timeRow = modal.querySelector<HTMLElement>('#bk-time-row')!;
  statusSel.addEventListener('change', () => {
    timeRow.style.display = statusSel.value === 'off' ? 'none' : '';
  });

  const updatePreview = () => {
    const startInput = modal.querySelector<HTMLInputElement>('#bk-start')!;
    const endInput = modal.querySelector<HTMLInputElement>('#bk-end')!;
    const previewEl = modal.querySelector<HTMLElement>('#bk-preview')!;
    const onDows = new Set<number>();
    dowButtons.forEach((btn) => { if (btn.dataset.on === '1') onDows.add(Number(btn.dataset.dow)); });
    if (!startInput.value || !endInput.value || startInput.value > endInput.value) {
      previewEl.textContent = '期間を正しく指定してください';
      return [];
    }
    const dates: string[] = [];
    let d = new Date(startInput.value);
    const end = new Date(endInput.value);
    while (d <= end) {
      if (onDows.has(d.getDay())) dates.push(fmt(d));
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    }
    previewEl.textContent = `対象: ${dates.length}日`;
    return dates;
  };
  modal.querySelector<HTMLInputElement>('#bk-start')!.addEventListener('change', updatePreview);
  modal.querySelector<HTMLInputElement>('#bk-end')!.addEventListener('change', updatePreview);
  dowButtons.forEach((btn) => btn.addEventListener('click', updatePreview));
  updatePreview();

  modal.querySelector('#bk-cancel')!.addEventListener('click', () => document.body.removeChild(modal));
  modal.querySelector('#bk-apply')!.addEventListener('click', async () => {
    const dates = updatePreview();
    const errEl = modal.querySelector<HTMLElement>('#bk-error')!;
    errEl.textContent = '';
    if (!dates || dates.length === 0) { errEl.textContent = '対象日が0日です'; return; }
    if (!confirm(`${dates.length}日分を登録します。よろしいですか？`)) return;

    const status = statusSel.value as 'planned' | 'off';
    const stime = (modal.querySelector<HTMLInputElement>('#bk-stime')!).value;
    const etime = (modal.querySelector<HTMLInputElement>('#bk-etime')!).value;
    const notes = (modal.querySelector<HTMLInputElement>('#bk-notes')!).value;
    const entries = dates.map((date) => ({
      date,
      startTime: status === 'off' ? '' : (stime || ''),
      endTime: status === 'off' ? null : (etime || null),
      status,
      notes: notes || null,
    }));
    const res = await api<{ success: boolean; data?: { upserted: number }; error?: string }>(
      '/api/liff/cast/schedules',
      { method: 'PUT', body: JSON.stringify({ entries }) },
    );
    if (!res.success) { errEl.textContent = res.error || '保存に失敗しました'; return; }
    alert(`✅ ${res.data?.upserted ?? entries.length}件 登録完了`);
    document.body.removeChild(modal);
    loadMonth();
  });
}

function openEditModal(date: string): void {
  const slots = state.schedules.filter((s) => s.date === date);
  const earn = state.earnings.find((e) => e.date === date);
  const tokens = earn?.tokens ?? 0;

  const modal = document.createElement('div');
  modal.className = 'cs-modal-bg';
  modal.innerHTML = `
    <div class="cs-modal">
      <h3>${date}</h3>
      <p class="sub">配信予定を入力します</p>
      ${tokens > 0
        ? `<div class="existing" style="background:#fef3c7;color:#92400e;">実績: ${tokens.toLocaleString()} tk (¥${(tokens * JPY_PER_TOKEN).toLocaleString('ja-JP')})</div>`
        : ''}
      ${slots.length > 0
        ? `<div class="existing">
            <div style="font-weight:600;margin-bottom:4px;">既存の予定</div>
            ${slots.map((s) => `
              <div class="slot-row">
                <span>
                  ${s.status === 'off' ? '⬛ 休み' : '🟢 予定'}
                  ${s.startTime ? ` ${s.startTime}${s.endTime ? `-${s.endTime}` : ''}` : ''}
                  ${s.notes ? ` · ${escapeHtml(s.notes)}` : ''}
                </span>
                <button class="del" data-stime="${escapeHtml(s.startTime)}">削除</button>
              </div>
            `).join('')}
          </div>`
        : ''}
      <div class="field">
        <label>状態</label>
        <select id="m-status">
          <option value="off">⬛ 休み</option>
          <option value="planned">🔵 配信予定</option>
        </select>
      </div>
      <div class="row2" id="m-time-row">
        <div class="field">
          <label>開始 (任意)</label>
          <input type="time" id="m-start" />
        </div>
        <div class="field">
          <label>終了 (任意)</label>
          <input type="time" id="m-end" />
        </div>
      </div>
      <div class="field">
        <label>メモ (任意)</label>
        <input type="text" id="m-notes" placeholder="例: 通常配信" />
      </div>
      <div id="m-error" class="cs-error"></div>
      <div class="actions">
        <button class="btn-cancel" id="m-cancel">キャンセル</button>
        <button class="btn-primary" id="m-save">保存</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) document.body.removeChild(modal);
  });

  const statusSel = modal.querySelector<HTMLSelectElement>('#m-status')!;
  const timeRow = modal.querySelector<HTMLElement>('#m-time-row')!;
  // 初期表示: status='off' なので時間行を隠す
  timeRow.style.display = 'none';
  statusSel.addEventListener('change', () => {
    timeRow.style.display = statusSel.value === 'off' ? 'none' : '';
  });

  modal.querySelector('#m-cancel')!.addEventListener('click', () => document.body.removeChild(modal));
  modal.querySelector('#m-save')!.addEventListener('click', async () => {
    const status = statusSel.value as 'planned' | 'off' | 'tentative';
    const start = (modal.querySelector<HTMLInputElement>('#m-start')!).value;
    const end = (modal.querySelector<HTMLInputElement>('#m-end')!).value;
    const notes = (modal.querySelector<HTMLInputElement>('#m-notes')!).value;
    const errEl = modal.querySelector<HTMLElement>('#m-error')!;
    errEl.textContent = '';
    const res = await api<{ success: boolean; error?: string }>(`/api/liff/cast/schedules`, {
      method: 'PUT',
      body: JSON.stringify({
        entries: [{
          date,
          startTime: status === 'off' ? '' : (start || ''),
          endTime: status === 'off' ? null : (end || null),
          status,
          notes: notes || null,
        }],
      }),
    });
    if (!res.success) {
      errEl.textContent = res.error || '保存に失敗しました';
      return;
    }
    document.body.removeChild(modal);
    loadMonth();
  });

  modal.querySelectorAll<HTMLButtonElement>('.del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('この予定を削除しますか？')) return;
      const stime = btn.dataset.stime || '';
      const qs = new URLSearchParams({ date, startTime: stime });
      await api(`/api/liff/cast/schedules?${qs.toString()}`, { method: 'DELETE' });
      document.body.removeChild(modal);
      loadMonth();
    });
  });
}

function showStatus(message: string, color = '#06C755'): void {
  const el = document.getElementById('app');
  if (!el) return;
  el.innerHTML = `
    <div class="cs-wrap">
      <div class="cs-header" style="background:${color};"><h2>配信予定表</h2><p>${escapeHtml(message)}</p></div>
    </div>
  `;
}

async function safeStep<T>(label: string, fn: () => Promise<T> | T): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}${err.stack ? `\n${err.stack.split('\n').slice(0, 2).join('\n')}` : ''}` : String(err);
    return { ok: false, error: `[${label}] ${msg}` };
  }
}

export async function initCastSchedule(): Promise<void> {
  showStatus('初期化中...');
  // step1: invite消費（失敗してもloadSelfで紐付け済みかチェックする）
  showStatus('招待トークンを確認中...');
  const bindStep = await safeStep('bind', () => consumeInviteIfAny());
  const bindFailed = !bindStep.ok || !bindStep.value.ok;
  const bindError = !bindStep.ok ? bindStep.error : !bindStep.value.ok ? bindStep.value.error : null;

  // step2: 自分情報取得（紐付け済みならbind失敗を無視）
  showStatus('キャスト情報を取得中...');
  const meStep = await safeStep('loadSelf', () => loadSelf());
  if (!meStep.ok) { showStatus(meStep.error, '#dc2626'); return; }
  const me = meStep.value;
  if (!me) {
    // 未紐付け かつ bindも失敗していたら本当のエラー
    if (bindFailed && bindError) {
      showStatus(`紐付けエラー: ${bindError}`, '#dc2626');
    } else {
      showStatus('未紐付け — 事務所から届いた招待URLからアクセスしてください', '#f59e0b');
    }
    return;
  }
  state.cast = me;

  // step3: 月データ取得
  showStatus(`${me.displayName || me.stripchatUsername} さん 予定を読み込み中...`);
  const monthStep = await safeStep('loadMonth', () => loadMonth());
  if (!monthStep.ok) { showStatus(monthStep.error, '#dc2626'); return; }
}
