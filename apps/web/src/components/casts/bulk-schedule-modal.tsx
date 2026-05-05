'use client'
import { useMemo, useState } from 'react'
import { fetchApi } from '@/lib/api'

interface CastOption {
  id: string
  stripchatUsername: string
  status: string
}

interface Props {
  casts: CastOption[]
  defaultMonth: string  // YYYY-MM (期間のデフォルトに使う)
  onClose: () => void
  onApplied: () => void
}

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土']

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function BulkScheduleModal({ casts, defaultMonth, onClose, onApplied }: Props) {
  const activeCasts = useMemo(() => casts.filter((c) => c.status === '在籍'), [casts])
  const monthStart = `${defaultMonth}-01`
  const monthEndDate = (() => {
    const [y, m] = defaultMonth.split('-').map(Number)
    return toIsoDate(new Date(y, m, 0))
  })()

  const [castIds, setCastIds] = useState<Set<string>>(() => new Set(activeCasts.map((c) => c.id)))
  const [startDate, setStartDate] = useState(monthStart)
  const [endDate, setEndDate] = useState(monthEndDate)
  const [dow, setDow] = useState<Set<number>>(() => new Set([0, 1, 2, 3, 4, 5, 6]))
  const [status, setStatus] = useState<'planned' | 'off'>('planned')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [notes, setNotes] = useState('')
  const [overwrite, setOverwrite] = useState(true)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<string | null>(null)

  const toggleCast = (id: string) => {
    setCastIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleAllCasts = () => {
    if (castIds.size === activeCasts.length) setCastIds(new Set())
    else setCastIds(new Set(activeCasts.map((c) => c.id)))
  }

  const toggleDow = (n: number) => {
    setDow((prev) => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n); else next.add(n)
      return next
    })
  }

  const dowPreset = (preset: 'all' | 'weekday' | 'weekend' | 'none') => {
    if (preset === 'all') setDow(new Set([0, 1, 2, 3, 4, 5, 6]))
    if (preset === 'weekday') setDow(new Set([1, 2, 3, 4, 5]))
    if (preset === 'weekend') setDow(new Set([0, 6]))
    if (preset === 'none') setDow(new Set())
  }

  // 対象日数のプレビュー
  const preview = useMemo(() => {
    if (!startDate || !endDate) return { days: 0, dates: [] as string[] }
    if (startDate > endDate) return { days: 0, dates: [] }
    const dates: string[] = []
    let d = new Date(startDate)
    const end = new Date(endDate)
    while (d <= end) {
      if (dow.has(d.getDay())) dates.push(toIsoDate(d))
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
    }
    return { days: dates.length, dates }
  }, [startDate, endDate, dow])

  const apply = async () => {
    setError('')
    setResult(null)
    if (castIds.size === 0) { setError('キャストを1人以上選択してください'); return }
    if (preview.days === 0) { setError('対象日が0日です。期間と曜日を確認してください'); return }
    if (!confirm(`${castIds.size}名 × ${preview.days}日 = 計${castIds.size * preview.days}件を${overwrite ? '上書き' : '追加'}します。よろしいですか？`)) return

    setApplying(true)
    let totalUpserted = 0
    let totalFailed = 0
    try {
      for (const castId of castIds) {
        const entries = preview.dates.map((date) => ({
          date,
          startTime: status === 'off' ? '' : (startTime || ''),
          endTime: status === 'off' ? null : (endTime || null),
          status,
          notes: notes || null,
        }))
        try {
          const res = await fetchApi<{ success: boolean; data?: { upserted: number }; error?: string }>(
            `/api/casts/${encodeURIComponent(castId)}/schedules`,
            { method: 'PUT', body: JSON.stringify({ entries }) },
          )
          if (res.success && res.data) totalUpserted += res.data.upserted
          else totalFailed += entries.length
        } catch {
          totalFailed += entries.length
        }
      }
      setResult(`✅ ${totalUpserted}件 適用完了${totalFailed > 0 ? ` / ${totalFailed}件失敗` : ''}`)
      onApplied()
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b border-gray-200">
          <div>
            <h3 className="text-base font-semibold text-gray-900">📅 一括予定入力</h3>
            <p className="text-xs text-gray-500 mt-0.5">期間・曜日・状態でまとめて登録</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* キャスト選択 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600">適用先キャスト ({castIds.size}/{activeCasts.length})</label>
              <button onClick={toggleAllCasts} className="text-xs text-green-700 font-medium">
                {castIds.size === activeCasts.length ? '全解除' : '全選択'}
              </button>
            </div>
            <div className="border border-gray-200 rounded p-2 max-h-32 overflow-y-auto space-y-1">
              {activeCasts.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={castIds.has(c.id)}
                    onChange={() => toggleCast(c.id)}
                    className="w-4 h-4"
                  />
                  <span className="font-mono text-xs">{c.stripchatUsername}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 期間 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">開始日</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">終了日</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
              />
            </div>
          </div>

          {/* 曜日 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-gray-600">曜日</label>
              <div className="flex gap-1">
                <button onClick={() => dowPreset('all')} className="text-[10px] px-1.5 py-0.5 bg-gray-100 rounded">毎日</button>
                <button onClick={() => dowPreset('weekday')} className="text-[10px] px-1.5 py-0.5 bg-gray-100 rounded">平日</button>
                <button onClick={() => dowPreset('weekend')} className="text-[10px] px-1.5 py-0.5 bg-gray-100 rounded">週末</button>
                <button onClick={() => dowPreset('none')} className="text-[10px] px-1.5 py-0.5 bg-gray-100 rounded">クリア</button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {DOW_LABELS.map((label, i) => (
                <button
                  key={i}
                  onClick={() => toggleDow(i)}
                  className={`py-1.5 text-xs font-medium rounded ${
                    dow.has(i)
                      ? (i === 0 ? 'bg-red-100 text-red-700 border border-red-300'
                        : i === 6 ? 'bg-blue-100 text-blue-700 border border-blue-300'
                        : 'bg-green-100 text-green-700 border border-green-300')
                      : 'bg-white text-gray-400 border border-gray-200'
                  }`}
                >{label}</button>
              ))}
            </div>
          </div>

          {/* 状態 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">状態</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'planned' | 'off')}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
            >
              <option value="planned">🔵 配信予定</option>
              <option value="off">⬛ 休み</option>
            </select>
          </div>

          {/* 時間（配信予定のみ） */}
          {status === 'planned' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">開始時刻（任意）</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">終了時刻（任意）</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                />
              </div>
            </div>
          )}

          {/* メモ */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">メモ（任意）</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="例: GW期間"
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
            />
          </div>

          {/* 上書き挙動 */}
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              className="w-4 h-4"
            />
            <span>同じ日に既存予定があれば上書き（外すと既存はそのまま）</span>
          </label>

          {/* プレビュー */}
          <div className="bg-blue-50 border border-blue-200 rounded p-2 text-xs">
            <p className="font-medium text-blue-900 mb-1">
              プレビュー: <b>{castIds.size}名 × {preview.days}日 = {castIds.size * preview.days}件</b>
            </p>
            {preview.days > 0 && preview.days <= 31 && (
              <p className="text-blue-700 break-all">対象日: {preview.dates.join(', ')}</p>
            )}
            {preview.days > 31 && (
              <p className="text-blue-700">対象日: {preview.dates.slice(0, 5).join(', ')} … 他{preview.days - 5}日</p>
            )}
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
          {result && <p className="text-xs text-green-600 font-medium">{result}</p>}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            disabled={applying}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
          >閉じる</button>
          <button
            onClick={apply}
            disabled={applying || preview.days === 0 || castIds.size === 0}
            className="px-4 py-2 text-sm font-medium text-white rounded disabled:opacity-50"
            style={{ backgroundColor: '#06C755' }}
          >{applying ? '適用中...' : '適用'}</button>
        </div>
      </div>
    </div>
  )
}
