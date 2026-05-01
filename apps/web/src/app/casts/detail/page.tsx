'use client'
import { useState, useEffect } from 'react'
import Header from '@/components/layout/header'
import { fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

interface Cast {
  id: string
  stripchatUsername: string
  channel: string
  contractVersion: string
  stage: string
  ratePercent: number
  introducerId: string | null
  introducerName: string | null
  status: string
  joinedAt: string | null
  lastMonthTokens: number
  lastMonthLabel: string | null
  workingDays: number
}

interface DailyEntry {
  date: string
  tokens: number
  fetchedAt: string
}

const ALLOWED_ACCOUNT_NAME = 'チャトナビ'
const JPY_PER_TOKEN = 8
const INTRODUCER_RATE = 0.10

function fmtJpy(tokens: number): string {
  return `¥${(tokens * JPY_PER_TOKEN).toLocaleString('ja-JP')}`
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function thisMonthLabel(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

export default function CastDetailPage() {
  const { selectedAccount } = useAccount()
  const [slug, setSlug] = useState<string>('')
  const [month, setMonth] = useState<string>(thisMonthLabel())
  const [cast, setCast] = useState<Cast | null>(null)
  const [daily, setDaily] = useState<DailyEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setSlug(params.get('slug') ?? '')
  }, [])

  const accountAllowed = selectedAccount?.name === ALLOWED_ACCOUNT_NAME

  useEffect(() => {
    if (!slug || !accountAllowed) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetchApi<{ success: boolean; data: Cast; error?: string }>(`/api/casts/${encodeURIComponent(slug)}`),
      fetchApi<{ success: boolean; data: DailyEntry[]; error?: string }>(
        `/api/casts/${encodeURIComponent(slug)}/daily-earnings?month=${encodeURIComponent(month)}`),
    ])
      .then(([castRes, dailyRes]) => {
        if (cancelled) return
        if (castRes.success) setCast(castRes.data)
        else setError(castRes.error ?? '読み込みに失敗しました')
        if (dailyRes.success) setDaily(dailyRes.data)
      })
      .catch(() => !cancelled && setError('読み込みに失敗しました'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [slug, month, accountAllowed])

  if (!accountAllowed) {
    return (
      <div>
        <Header title="キャスト詳細" />
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
          「{ALLOWED_ACCOUNT_NAME}」アカウントでのみ閲覧できます。
        </div>
      </div>
    )
  }

  if (loading) {
    return <div><Header title="キャスト詳細" /><p className="text-sm text-gray-400">読み込み中...</p></div>
  }
  if (error || !cast) {
    return <div><Header title="キャスト詳細" /><p className="text-sm text-red-600">{error || 'キャストが見つかりません'}</p></div>
  }

  const workingEntries = daily.filter((d) => d.tokens > 0)
  const monthTotal = daily.reduce((s, d) => s + d.tokens, 0)
  const castPay = Math.round(monthTotal * cast.ratePercent / 100)
  const introPay = cast.introducerId ? Math.round(monthTotal * INTRODUCER_RATE) : 0
  const officePay = monthTotal - castPay - introPay

  return (
    <div>
      <Header
        title={`キャスト詳細: ${cast.stripchatUsername}`}
        action={
          <a href="/casts" className="text-sm text-gray-600 hover:text-gray-900">← 一覧に戻る</a>
        }
      />

      {/* 基本情報 */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <Field label="slug" value={cast.stripchatUsername} mono />
          <Field label="配信形態" value={cast.channel} />
          <Field label="契約" value={`${cast.contractVersion} / ${cast.stage}`} />
          <Field label="レート" value={`${cast.ratePercent}%`} />
          <Field label="入店日" value={cast.joinedAt ?? '—'} />
          <Field label="状態" value={cast.status} />
          <Field label="紹介者" value={cast.introducerName ? `${cast.introducerName}（${cast.introducerId}）` : (cast.introducerId ?? '—')} />
          <Field label="基準月" value={cast.lastMonthLabel ?? '—'} />
        </div>
      </div>

      {/* 月選択 + サマリー */}
      <div className="flex items-center gap-3 mb-3">
        <label className="text-sm text-gray-600">表示月:</label>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        <SummaryCard label={`${month} 稼働日数`} value={`${workingEntries.length}日`} />
        <SummaryCard label={`${month} 売上`} value={`${monthTotal.toLocaleString()} tk`} sub={fmtJpy(monthTotal)} />
        <SummaryCard label="キャスト取り分" value={`${castPay.toLocaleString()} tk`} sub={fmtJpy(castPay)} />
        <SummaryCard label="紹介者報酬" value={`${introPay.toLocaleString()} tk`} sub={fmtJpy(introPay)} />
        <SummaryCard label="事務所利益" value={`${officePay.toLocaleString()} tk`} sub={fmtJpy(officePay)} highlight />
      </div>

      {/* 日別リスト */}
      <h2 className="text-sm font-semibold text-gray-700 mb-2">日別 報酬</h2>
      {daily.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-sm text-gray-400">
          この月の日別データがありません。stripchat-agency 側で <code className="bg-gray-100 px-1.5 py-0.5 rounded">sync_casts_to_lineharness.py --month {month}</code> を実行してください。
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500">
                <th className="px-3 py-2 text-left">日付</th>
                <th className="px-3 py-2 text-left">曜日</th>
                <th className="px-3 py-2 text-right">売上 (tk)</th>
                <th className="px-3 py-2 text-right">キャスト取り分 (tk)</th>
                <th className="px-3 py-2 text-right">紹介者報酬 (tk)</th>
                <th className="px-3 py-2 text-right">事務所利益 (tk)</th>
                <th className="px-3 py-2 text-right">円換算</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {daily.map((d) => {
                const dt = new Date(d.date + 'T00:00:00+09:00')
                const wd = ['日','月','火','水','木','金','土'][dt.getDay()]
                const cp = Math.round(d.tokens * cast.ratePercent / 100)
                const ip = cast.introducerId ? Math.round(d.tokens * INTRODUCER_RATE) : 0
                const op = d.tokens - cp - ip
                const isZero = d.tokens === 0
                return (
                  <tr key={d.date} className={isZero ? 'text-gray-400' : 'hover:bg-gray-50'}>
                    <td className="px-3 py-2 font-mono">{d.date}</td>
                    <td className={`px-3 py-2 ${wd === '日' ? 'text-red-500' : wd === '土' ? 'text-blue-500' : ''}`}>{wd}</td>
                    <td className="px-3 py-2 text-right">{d.tokens.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-medium">{cp.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{cast.introducerId ? ip.toLocaleString() : '—'}</td>
                    <td className={`px-3 py-2 text-right ${isZero ? '' : 'text-green-700'}`}>{op.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{fmtJpy(d.tokens)}</td>
                  </tr>
                )
              })}
              <tr className="bg-gray-50 font-semibold">
                <td colSpan={2} className="px-3 py-2 text-right">合計</td>
                <td className="px-3 py-2 text-right">{monthTotal.toLocaleString()}</td>
                <td className="px-3 py-2 text-right">{castPay.toLocaleString()}</td>
                <td className="px-3 py-2 text-right">{introPay.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-green-700">{officePay.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-gray-500">{fmtJpy(monthTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className={`text-sm ${mono ? 'font-mono' : ''} text-gray-900`}>{value}</p>
    </div>
  )
}

function SummaryCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`border rounded-lg p-4 ${highlight ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
      <p className={`text-xs mb-1 ${highlight ? 'text-green-700' : 'text-gray-500'}`}>{label}</p>
      <p className={`text-lg font-semibold ${highlight ? 'text-green-800' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className={`text-xs ${highlight ? 'text-green-600' : 'text-gray-400'}`}>{sub}</p>}
    </div>
  )
}
