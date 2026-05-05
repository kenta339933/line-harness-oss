'use client'
import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { fetchApi } from '@/lib/api'
import BulkScheduleModal from './bulk-schedule-modal'

const JPY_PER_TOKEN = 8

type ScheduleStatus = 'planned' | 'off' | 'tentative'

export interface ScheduleEntry {
  castId: string
  date: string
  startTime: string
  endTime: string | null
  status: ScheduleStatus
  notes: string | null
  source: string
  updatedAt: string
}

export interface DailyEarning {
  castId: string
  date: string
  tokens: number
}

export interface CalendarCast {
  id: string
  stripchatUsername: string
  displayName: string | null
  status: string
}

interface Props {
  lineAccountId: string
  casts: CalendarCast[]
  month: string                        // YYYY-MM
  onMonthChange: (m: string) => void
}

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function dayOfWeekJa(month: string, day: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1, day)
  return ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
}

// Cell に表示する状態（4種類: 配信予定/実績/欠勤/休み + 空）
type CellKind = 'empty' | 'planned' | 'achieved' | 'absent' | 'off'

function classifyCell(schedules: ScheduleEntry[], tokens: number, isPast: boolean): CellKind {
  // 実績優先: 配信した日は「実績」扱い
  if (tokens > 0) return 'achieved'
  // tentative も planned と同じ扱い
  const hasPlanned = schedules.some((s) => s.status === 'planned' || s.status === 'tentative')
  if (hasPlanned) {
    // 過去日（厳密に昨日以前）かつ実績0 → 欠勤。今日と未来は配信予定のまま
    return isPast ? 'absent' : 'planned'
  }
  // 予定なし = デフォルト「休み」（明示的なoff・未入力どちらも同じ表示）
  return 'off'
}

function cellLabel(kind: CellKind): { emoji: string; bg: string; text: string } {
  switch (kind) {
    case 'planned':  return { emoji: '🔵', bg: 'bg-blue-100',  text: 'text-blue-800' }
    case 'achieved': return { emoji: '🟢', bg: 'bg-green-100', text: 'text-green-800' }
    case 'absent':   return { emoji: '🔴', bg: 'bg-red-100',   text: 'text-red-800' }
    case 'off':      return { emoji: '−',  bg: 'bg-white',     text: 'text-gray-300' }
    default:         return { emoji: '',   bg: 'bg-white',     text: 'text-gray-400' }
  }
}

interface EditState {
  castId: string
  castLabel: string
  date: string
}

export default function ScheduleCalendar({ lineAccountId, casts, month, onMonthChange }: Props) {
  const [schedules, setSchedules] = useState<ScheduleEntry[]>([])
  const [earnings, setEarnings] = useState<DailyEarning[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [edit, setEdit] = useState<EditState | null>(null)
  const [showBulk, setShowBulk] = useState(false)
  const [view, setView] = useState<'month' | 'today'>('month')

  const activeCasts = useMemo(() => casts.filter((c) => c.status === '在籍'), [casts])
  const days = daysInMonth(month)

  // (castId, date) → schedule[], earningTokens を引くMap
  const scheduleMap = useMemo(() => {
    const m = new Map<string, ScheduleEntry[]>()
    for (const s of schedules) {
      const key = `${s.castId}__${s.date}`
      const arr = m.get(key) ?? []
      arr.push(s)
      m.set(key, arr)
    }
    return m
  }, [schedules])

  const earningMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of earnings) m.set(`${e.castId}__${e.date}`, e.tokens)
    return m
  }, [earnings])

  const reload = useCallback(() => {
    if (!lineAccountId) return
    setLoading(true)
    setError('')
    fetchApi<{ success: boolean; data?: { schedules: ScheduleEntry[]; dailyEarnings: DailyEarning[] }; error?: string }>(
      `/api/casts/schedules?lineAccountId=${encodeURIComponent(lineAccountId)}&month=${encodeURIComponent(month)}`
    )
      .then((res) => {
        if (res.success && res.data) {
          setSchedules(res.data.schedules)
          setEarnings(res.data.dailyEarnings)
        } else {
          setError(res.error ?? '読み込みに失敗しました')
        }
      })
      .catch(() => setError('読み込みに失敗しました'))
      .finally(() => setLoading(false))
  }, [lineAccountId, month])

  useEffect(() => { reload() }, [reload])

  const todayStr = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [])

  const monthOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = []
    const now = new Date()
    // 過去5ヶ月 + 当月 + 翌月 = 7ヶ月
    for (let i = -1; i <= 5; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const lbl = i === -1 ? `${v}（翌月）` : i === 0 ? `${v}（今月）` : i === 1 ? `${v}（先月）` : v
      opts.push({ value: v, label: lbl })
    }
    return opts
  }, [])

  return (
    <div>
      {/* 表示切替 + 月セレクタ + 凡例 */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex border border-gray-300 rounded overflow-hidden">
            <button
              onClick={() => setView('month')}
              className={`px-3 py-1 text-xs font-medium ${view === 'month' ? 'bg-green-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >📅 月表示</button>
            <button
              onClick={() => setView('today')}
              className={`px-3 py-1 text-xs font-medium ${view === 'today' ? 'bg-green-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >🕐 当日タイムライン</button>
          </div>
          {view === 'month' && (
            <>
              <button
                onClick={() => onMonthChange(shiftMonth(month, -1))}
                className="px-2 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50"
              >‹</button>
              <select
                value={month}
                onChange={(e) => onMonthChange(e.target.value)}
                className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white"
              >
                {monthOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <button
                onClick={() => onMonthChange(shiftMonth(month, +1))}
                className="px-2 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50"
              >›</button>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
          <Legend emoji="🔵" label="配信予定" />
          <Legend emoji="🟢" label="実績" />
          <Legend emoji="🔴" label="欠勤" />
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-3 bg-white border border-gray-300 rounded-sm flex items-center justify-center text-gray-300 text-[8px] leading-none">−</span>
            <span>休み</span>
          </span>
          <button
            onClick={() => setShowBulk(true)}
            className="ml-auto px-3 py-1 text-xs font-medium text-green-700 bg-white border border-green-300 rounded hover:bg-green-50"
          >📅 一括入力</button>
        </div>
      </div>

      {error && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-400">
          読み込み中...
        </div>
      ) : activeCasts.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-400">
          在籍キャストがいません。
        </div>
      ) : view === 'today' ? (
        <TodayTimeline
          casts={activeCasts}
          schedules={schedules}
          earnings={earnings}
          todayStr={todayStr}
          onCellClick={(castId, castLabel, date) => setEdit({ castId, castLabel, date })}
        />
      ) : (
        <>
        <p className="text-[11px] text-gray-500 mb-1 lg:hidden">← 横スワイプで日付スクロール →</p>
        <ScheduleGrid
          activeCasts={activeCasts}
          month={month}
          days={days}
          todayStr={todayStr}
          scheduleMap={scheduleMap}
          earningMap={earningMap}
          onCellClick={(castId, castLabel, date) => setEdit({ castId, castLabel, date })}
        />
        </>
      )}

      {showBulk && (
        <BulkScheduleModal
          casts={activeCasts}
          defaultMonth={month}
          onClose={() => setShowBulk(false)}
          onApplied={reload}
        />
      )}

      {edit && (
        <ScheduleEditModal
          castId={edit.castId}
          castLabel={edit.castLabel}
          date={edit.date}
          existing={scheduleMap.get(`${edit.castId}__${edit.date}`) ?? []}
          tokens={earningMap.get(`${edit.castId}__${edit.date}`) ?? 0}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); reload() }}
        />
      )}
    </div>
  )
}

// 当日タイムライン（時間帯ガント風）
function TodayTimeline({
  casts,
  schedules,
  earnings,
  todayStr,
  onCellClick,
}: {
  casts: CalendarCast[]
  schedules: ScheduleEntry[]
  earnings: DailyEarning[]
  todayStr: string
  onCellClick: (castId: string, castLabel: string, date: string) => void
}) {
  const todaySchedules = schedules.filter((s) => s.date === todayStr)
  const todayEarnings = earnings.filter((e) => e.date === todayStr)

  // 時間範囲: 12:00 - 30:00 (翌朝6時) を基本範囲とする
  // データに早朝/深夜の予定があれば自動拡張
  const HOUR_START = 12
  const HOUR_END = 30  // 翌朝6:00 = 30:00表記
  const HOUR_SPAN = HOUR_END - HOUR_START

  // 時刻文字列 "HH:MM" を 0-30 範囲の小数（時間単位）に変換
  // ※ 12時より前の時刻は翌日扱いで +24
  const parseToHour = (time: string | null | undefined): number | null => {
    if (!time) return null
    const m = /^(\d{1,2}):(\d{2})$/.exec(time)
    if (!m) return null
    let h = parseInt(m[1], 10) + parseInt(m[2], 10) / 60
    if (h < HOUR_START) h += 24  // 0:00→24:00, 6:00→30:00
    return h
  }

  // 現在時刻
  const now = new Date()
  const nowHour = (now.getHours() + now.getMinutes() / 60) < HOUR_START
    ? (now.getHours() + now.getMinutes() / 60) + 24
    : (now.getHours() + now.getMinutes() / 60)
  const nowPos = ((nowHour - HOUR_START) / HOUR_SPAN) * 100  // %

  // 1時間あたりのpx幅（スマホで読みやすい最小幅を確保）
  const HOUR_PX = 36
  const TIMELINE_MIN_WIDTH = HOUR_SPAN * HOUR_PX

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
      <div className="mb-2 text-sm font-semibold text-gray-700">
        本日 {todayStr} のタイムライン
        <span className="ml-2 text-[10px] text-gray-400 font-normal sm:hidden">← 横スクロール →</span>
      </div>

      <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
      <div style={{ minWidth: `${TIMELINE_MIN_WIDTH + 96}px` }}>

      {/* 時刻ヘッダー */}
      <div className="flex items-stretch mb-1">
        <div className="w-[96px] sm:w-[120px] shrink-0" />
        <div className="flex-1 relative h-5">
          {Array.from({ length: HOUR_SPAN + 1 }, (_, i) => ({ h: HOUR_START + i, idx: i })).map(({ h, idx }) => (
            <span
              key={h}
              className="absolute top-0 text-[10px] text-gray-500 -translate-x-1/2"
              style={{ left: `${(idx / HOUR_SPAN) * 100}%` }}
            >
              {h % 24}
            </span>
          ))}
        </div>
      </div>

      {/* キャスト行 */}
      <div className="space-y-1">
        {casts.map((cast) => {
          const castSlots = todaySchedules.filter((s) => s.castId === cast.id)
          const castEarn = todayEarnings.find((e) => e.castId === cast.id)
          const tokens = castEarn?.tokens ?? 0
          return (
            <div key={cast.id} className="flex items-stretch">
              <div className="w-[96px] sm:w-[120px] shrink-0 pr-2 flex items-center">
                <div className="text-xs font-mono text-gray-900 truncate">{cast.stripchatUsername}</div>
                {tokens > 0 && (
                  <div className="ml-auto text-[10px] text-green-700 font-semibold whitespace-nowrap">
                    {tokens >= 1000 ? `${Math.round(tokens / 100) / 10}k` : tokens}
                  </div>
                )}
              </div>
              <div
                className="flex-1 relative h-9 bg-gray-50 border border-gray-200 rounded cursor-pointer hover:bg-gray-100"
                onClick={() => onCellClick(cast.id, cast.stripchatUsername, todayStr)}
              >
                {/* 時刻グリッド */}
                {Array.from({ length: HOUR_SPAN }, (_, i) => i).map((i) => (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 border-l border-gray-200"
                    style={{ left: `${(i / HOUR_SPAN) * 100}%` }}
                  />
                ))}

                {/* スケジュール枠 */}
                {castSlots.map((s, idx) => {
                  if (s.status === 'off') return null
                  const start = parseToHour(s.startTime)
                  const end = parseToHour(s.endTime)
                  // 開始時刻なし＝終日扱い（範囲全体を緑薄く）
                  const left = start !== null ? Math.max(0, ((start - HOUR_START) / HOUR_SPAN) * 100) : 0
                  const width = (start !== null && end !== null)
                    ? Math.max(2, ((end - start) / HOUR_SPAN) * 100)
                    : (start !== null ? 4 : 100)
                  const isAchieved = tokens > 0
                  const isAbsent = !isAchieved && start !== null && nowHour > (end ?? start + 0.5)
                  const cls = isAchieved
                    ? 'bg-green-300 text-green-900'
                    : isAbsent
                      ? 'bg-red-300 text-red-900'
                      : 'bg-blue-300 text-blue-900'
                  return (
                    <div
                      key={`${idx}-${s.startTime}`}
                      className={`absolute top-1 bottom-1 ${cls} rounded text-[10px] px-1 flex items-center overflow-hidden`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`${s.startTime || '終日'}${s.endTime ? `-${s.endTime}` : ''}${s.notes ? ` · ${s.notes}` : ''}`}
                    >
                      <span className="truncate">
                        {s.startTime || '終日'}{s.endTime ? `-${s.endTime}` : ''}
                      </span>
                    </div>
                  )
                })}

                {/* 現在時刻ライン */}
                {nowPos >= 0 && nowPos <= 100 && (
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
                    style={{ left: `${nowPos}%` }}
                    title={`現在 ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>

      </div>
      </div>

      <p className="mt-3 text-[10px] text-gray-400">
        12:00〜30:00（翌朝6時）の範囲表示。赤線=現在時刻。タップ→予定編集
      </p>
    </div>
  )
}

// CSS Grid ベースのカレンダー（HTMLテーブルだとiOS Safariでレイアウト崩壊するため）
function ScheduleGrid({
  activeCasts,
  month,
  days,
  todayStr,
  scheduleMap,
  earningMap,
  onCellClick,
}: {
  activeCasts: CalendarCast[]
  month: string
  days: number
  todayStr: string
  scheduleMap: Map<string, ScheduleEntry[]>
  earningMap: Map<string, number>
  onCellClick: (castId: string, castLabel: string, date: string) => void
}) {
  const NAME_COL = 100
  const CELL_W = 32
  const totalWidth = NAME_COL + days * CELL_W

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `${NAME_COL}px repeat(${days}, ${CELL_W}px)`,
    minWidth: `${totalWidth}px`,
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
      <div style={gridStyle}>
        {/* ヘッダー行: キャスト名カラム */}
        <div
          className="sticky left-0 z-10 bg-gray-50 border-r border-b border-gray-200 px-2 py-2 text-xs font-medium text-gray-600"
          style={{ position: 'sticky', left: 0 }}
        >
          キャスト
        </div>
        {/* ヘッダー行: 日付セル */}
        {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
          const dow = dayOfWeekJa(month, d)
          const isWeekend = dow === '土' || dow === '日'
          return (
            <div
              key={`h-${d}`}
              className={`border-r border-b border-gray-200 py-1 text-center text-[11px] font-medium ${
                isWeekend ? 'text-red-500 bg-red-50/30' : 'text-gray-600 bg-gray-50'
              }`}
            >
              <div>{d}</div>
              <div className="text-[9px] font-normal opacity-60">{dow}</div>
            </div>
          )
        })}

        {/* キャスト行 */}
        {activeCasts.map((cast) => (
          <React.Fragment key={cast.id}>
            <div
              className="sticky left-0 z-10 bg-white border-r border-b border-gray-200 px-2 py-1.5 text-xs font-mono text-gray-900 truncate flex items-center"
              style={{ position: 'sticky', left: 0 }}
            >
              {cast.stripchatUsername}
            </div>
            {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
              const dateStr = `${month}-${String(d).padStart(2, '0')}`
              const key = `${cast.id}__${dateStr}`
              const slots = scheduleMap.get(key) ?? []
              const tokens = earningMap.get(key) ?? 0
              const isPast = dateStr < todayStr
              const isToday = dateStr === todayStr
              const kind = classifyCell(slots, tokens, isPast)
              const cls = cellLabel(kind)
              const tip = buildTooltip(slots, tokens)
              return (
                <button
                  key={`c-${cast.id}-${d}`}
                  title={tip}
                  onClick={() => onCellClick(cast.id, cast.stripchatUsername, dateStr)}
                  className={`border-r border-b border-gray-200 text-center cursor-pointer ${cls.bg} ${cls.text} ${isToday ? 'ring-1 ring-green-500 ring-inset' : ''}`}
                  style={{ height: 36 }}
                >
                  <div className="text-sm leading-none pt-1">{cls.emoji}</div>
                  {tokens > 0 && (
                    <div className="text-[8px] mt-0.5 leading-none">
                      {tokens >= 1000 ? `${Math.round(tokens / 100) / 10}k` : tokens}
                    </div>
                  )}
                </button>
              )
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

function Legend({ emoji, label }: { emoji: string; label: string }) {
  return <span className="inline-flex items-center gap-1"><span>{emoji}</span><span>{label}</span></span>
}

function buildTooltip(slots: ScheduleEntry[], tokens: number): string {
  const lines: string[] = []
  for (const s of slots) {
    const t = s.startTime ? `${s.startTime}${s.endTime ? `-${s.endTime}` : ''}` : '終日'
    const label = s.status === 'off' ? '休み' : '予定'
    lines.push(`${label}: ${t}${s.notes ? ` (${s.notes})` : ''}`)
  }
  if (tokens > 0) lines.push(`実績: ${tokens.toLocaleString()}tk (¥${(tokens * JPY_PER_TOKEN).toLocaleString('ja-JP')})`)
  return lines.join('\n') || 'クリックして予定を入力'
}

// ─── Edit Modal ────────────────────────────────────────────────

interface ModalProps {
  castId: string
  castLabel: string
  date: string
  existing: ScheduleEntry[]
  tokens: number
  onClose: () => void
  onSaved: () => void
}

function ScheduleEditModal({ castId, castLabel, date, existing, tokens, onClose, onSaved }: ModalProps) {
  const [status, setStatus] = useState<ScheduleStatus>('off')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    setSaving(true); setErr('')
    try {
      const res = await fetchApi<{ success: boolean; error?: string }>(
        `/api/casts/${encodeURIComponent(castId)}/schedules`,
        {
          method: 'PUT',
          body: JSON.stringify({
            entries: [{
              date,
              startTime: status === 'off' ? '' : (startTime || ''),
              endTime: status === 'off' ? null : (endTime || null),
              status,
              notes: notes || null,
            }],
          }),
        }
      )
      if (!res.success) { setErr(res.error ?? '保存に失敗しました'); return }
      onSaved()
    } catch {
      setErr('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const removeSlot = async (slotStartTime: string) => {
    if (!confirm('この予定を削除しますか？')) return
    setSaving(true); setErr('')
    try {
      const qs = new URLSearchParams({ date, startTime: slotStartTime })
      const res = await fetchApi<{ success: boolean; error?: string }>(
        `/api/casts/${encodeURIComponent(castId)}/schedules?${qs.toString()}`,
        { method: 'DELETE' }
      )
      if (!res.success) { setErr(res.error ?? '削除に失敗しました'); return }
      onSaved()
    } catch {
      setErr('削除に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900">{castLabel}</h3>
            <p className="text-sm text-gray-500">{date}（{dayOfWeekJa(date.slice(0, 7), Number(date.slice(8, 10)))}）</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {tokens > 0 && (
          <div className="mb-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
            実績: <b>{tokens.toLocaleString()} tk</b> (¥{(tokens * JPY_PER_TOKEN).toLocaleString('ja-JP')})
          </div>
        )}

        {existing.length > 0 && (
          <div className="mb-3 space-y-1">
            <p className="text-xs font-medium text-gray-600">既存の予定</p>
            {existing.map((s) => (
              <div key={s.startTime} className="flex items-center justify-between text-xs bg-gray-50 rounded px-2 py-1.5">
                <span>
                  {s.status === 'off' ? '⬛ 休み' : '🟢 予定'}
                  {s.startTime && ` ${s.startTime}${s.endTime ? `-${s.endTime}` : ''}`}
                  {s.notes && <span className="text-gray-500"> · {s.notes}</span>}
                </span>
                <button
                  onClick={() => removeSlot(s.startTime)}
                  disabled={saving}
                  className="text-red-600 hover:text-red-800 text-[11px]"
                >削除</button>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">状態</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ScheduleStatus)}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
            >
              <option value="off">⬛ 休み</option>
              <option value="planned">🔵 配信予定</option>
            </select>
          </div>
          {status !== 'off' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">開始 (任意)</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">終了 (任意)</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                />
              </div>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">メモ (任意)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="例: 通常配信 / イベント参加"
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
            />
          </div>
        </div>

        {err && <p className="mt-2 text-xs text-red-600">{err}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
          >キャンセル</button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white rounded disabled:opacity-50"
            style={{ backgroundColor: '#06C755' }}
          >{saving ? '保存中...' : '保存'}</button>
        </div>

        <p className="mt-3 text-[10px] text-gray-400">
          ※同じ日に複数の時間枠を登録する場合、開始時刻を変えて保存してください（例: 12:00 と 19:00）。
          開始時刻なしで保存した場合は「終日」枠として扱われます。
        </p>
      </div>
    </div>
  )
}
