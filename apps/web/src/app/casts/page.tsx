'use client'
import { useState, useEffect } from 'react'
import Header from '@/components/layout/header'
import { fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import ScheduleCalendar from '@/components/casts/schedule-calendar'
import InviteModal from '@/components/casts/invite-modal'
import AddCastModal from '@/components/casts/add-cast-modal'

interface Cast {
  id: string
  lineAccountId: string
  stripchatUsername: string
  displayName: string | null
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
  lastSyncedAt: string | null
  workingDays: number
  notes: string | null
  liffBound?: boolean
}

const ALLOWED_ACCOUNT_NAME = 'チャトナビ'
const JPY_PER_TOKEN = 8
const INTRODUCER_RATE = 0.10

function fmtJpy(tokens: number): string {
  return `¥${(tokens * JPY_PER_TOKEN).toLocaleString('ja-JP')}`
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === '在籍'
    ? 'bg-green-100 text-green-800'
    : status === '退所'
      ? 'bg-red-50 text-red-700 line-through'
      : 'bg-gray-100 text-gray-500'
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  )
}

export default function CastsPage() {
  const { selectedAccount } = useAccount()
  const [casts, setCasts] = useState<Cast[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const accountAllowed = selectedAccount?.name === ALLOWED_ACCOUNT_NAME || selectedAccount?.displayName === ALLOWED_ACCOUNT_NAME
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string>('')
  const [selectedMonth, setSelectedMonth] = useState<string>(() => new Date().toISOString().slice(0, 7))

  const [issuingCastId, setIssuingCastId] = useState<string | null>(null)
  const [issueResult, setIssueResult] = useState<{ castId: string; url: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [tab, setTab] = useState<'list' | 'schedule'>('list')
  const [invitingCast, setInvitingCast] = useState<Cast | null>(null)
  const [showAddCast, setShowAddCast] = useState(false)
  const [editingCast, setEditingCast] = useState<Cast | null>(null)
  const [statusFilter, setStatusFilter] = useState<'active' | 'retired' | 'all'>('active')

  const handleIssuePayslip = async (castId: string) => {
    if (issuingCastId) return
    setIssuingCastId(castId)
    setIssueResult(null)
    try {
      const res = await fetchApi<{ success: boolean; data?: { url: string }; error?: string }>(
        `/api/casts/${encodeURIComponent(castId)}/payslips?month=${selectedMonth}`,
        { method: 'POST' }
      )
      if (res.success && res.data) {
        setIssueResult({ castId, url: res.data.url })
      } else {
        setError(res.error ?? '明細書の発行に失敗しました')
      }
    } catch {
      setError('明細書の発行に失敗しました')
    } finally {
      setIssuingCastId(null)
    }
  }

  const handleQuickRetire = async (cast: Cast) => {
    const isRetired = cast.status === '退所'
    const action = isRetired ? '復帰' : '退所'
    if (!confirm(`${cast.stripchatUsername} を${action}にしますか？`)) return
    try {
      const res = await fetchApi<{ success: boolean; error?: string }>(
        `/api/casts/${encodeURIComponent(cast.id)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            lineAccountId: cast.lineAccountId,
            stripchatUsername: cast.stripchatUsername,
            displayName: cast.displayName,
            channel: cast.channel,
            contractVersion: cast.contractVersion,
            stage: cast.stage,
            ratePercent: cast.ratePercent,
            introducerId: cast.introducerId,
            introducerName: cast.introducerName,
            status: isRetired ? '在籍' : '退所',
            joinedAt: cast.joinedAt,
            workingDays: cast.workingDays,
            lastMonthTokens: cast.lastMonthTokens,
            lastMonthLabel: cast.lastMonthLabel,
            notes: cast.notes,
          }),
        },
      )
      if (!res.success) {
        setError(res.error ?? `${action}に失敗しました`)
        return
      }
      reloadCasts()
    } catch {
      setError(`${action}に失敗しました`)
    }
  }

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
      window.prompt('URL（コピーしてください）', url)
    }
  }

  const monthOptions = (() => {
    const opts: { value: string; label: string }[] = []
    const now = new Date()
    for (let i = -1; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = i === -1 ? `${value}（翌月）` : i === 0 ? `${value}（今月）` : i === 1 ? `${value}（先月）` : value
      opts.push({ value, label })
    }
    return opts
  })()

  const reloadCasts = () => {
    if (!selectedAccount || !accountAllowed) return
    setLoading(true)
    fetchApi<{ success: boolean; data: Cast[]; error?: string }>(
      `/api/casts?lineAccountId=${encodeURIComponent(selectedAccount.id)}`
    )
      .then((res) => {
        if (res.success) setCasts(res.data)
        else setError(res.error ?? '読み込みに失敗しました')
      })
      .catch(() => setError('読み込みに失敗しました'))
      .finally(() => setLoading(false))
  }

  const handleSync = async () => {
    if (!selectedAccount || syncing) return
    const month = selectedMonth
    const active = casts.filter((c) => c.status === '在籍')
    if (active.length === 0) {
      setSyncMsg('在籍キャストがいません')
      return
    }
    if (!confirm(`Stripchat Studio API から ${month} の最新データを取得します。\n（${active.length}名 × 30日 = 約${active.length * 30}回のAPIコール、最大${active.length * 30}秒かかります）`)) return
    setSyncing(true)
    const results: string[] = []
    for (let i = 0; i < active.length; i++) {
      const c = active[i]
      setSyncMsg(`同期中 (${i + 1}/${active.length}): ${c.id}...`)
      try {
        const res = await fetchApi<{ success: boolean; data?: { castId: string; tokens: number; workingDays: number; error?: string }; error?: string }>(
          `/api/casts/${encodeURIComponent(c.id)}/sync?month=${month}`,
          { method: 'POST' }
        )
        if (res.success && res.data) {
          results.push(`${res.data.castId}: ${res.data.tokens.toLocaleString()}tk (${res.data.workingDays}日)`)
        } else {
          results.push(`${c.id}: ❌ ${res.error ?? '失敗'}`)
        }
      } catch {
        results.push(`${c.id}: ❌ 通信失敗`)
      }
    }
    setSyncMsg(`✅ 同期完了 — ${results.join(' / ')}`)
    setSyncing(false)
    reloadCasts()
    setTimeout(() => setSyncMsg(''), 12000)
  }

  useEffect(() => {
    if (!selectedAccount) return
    if (!accountAllowed) {
      setLoading(false)
      setCasts([])
      return
    }
    let cancelled = false
    setLoading(true)
    fetchApi<{ success: boolean; data: Cast[]; error?: string }>(
      `/api/casts?lineAccountId=${encodeURIComponent(selectedAccount.id)}`
    )
      .then((res) => {
        if (cancelled) return
        if (res.success) setCasts(res.data)
        else if (res.error?.includes('権限')) setError('このページの閲覧にはオーナー権限が必要です')
        else setError(res.error ?? '読み込みに失敗しました')
      })
      .catch(() => !cancelled && setError('読み込みに失敗しました'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [selectedAccount, accountAllowed])

  if (!selectedAccount) {
    return (
      <div>
        <Header title="キャスト管理" />
        <p className="text-sm text-gray-500">アカウントを選択してください。</p>
      </div>
    )
  }

  if (!accountAllowed) {
    return (
      <div>
        <Header title="キャスト管理" />
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
          このページは「{ALLOWED_ACCOUNT_NAME}」アカウントでのみ閲覧できます。<br />
          現在のアカウント: <b>{selectedAccount.name}</b>
        </div>
      </div>
    )
  }

  const active = casts.filter((c) => c.status === '在籍')
  const totalTokens = active.reduce((s, c) => s + c.lastMonthTokens, 0)
  const totalCastPay = active.reduce((s, c) => s + Math.round(c.lastMonthTokens * c.ratePercent / 100), 0)
  const totalIntroducerPay = active.reduce(
    (s, c) => s + (c.introducerId ? Math.round(c.lastMonthTokens * INTRODUCER_RATE) : 0), 0)
  const totalOfficePay = totalTokens - totalCastPay - totalIntroducerPay

  return (
    <div>
      <Header
        title="キャスト管理"
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowAddCast(true)}
              className="px-3 py-2 min-h-[44px] text-sm font-medium text-green-700 bg-white border border-green-300 rounded-lg hover:bg-green-50"
            >
              + キャスト追加
            </button>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              disabled={syncing}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white min-h-[44px] disabled:opacity-50"
            >
              {monthOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#06C755' }}
            >
              {syncing ? '同期中...' : '🔄 同期'}
            </button>
          </div>
        }
      />

      {syncMsg && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
          {syncMsg}
        </div>
      )}

      {/* タブ */}
      <div className="flex border-b border-gray-200 mb-4">
        <button
          onClick={() => setTab('list')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === 'list'
              ? 'border-green-500 text-green-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >📋 一覧・売上</button>
        <button
          onClick={() => setTab('schedule')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === 'schedule'
              ? 'border-green-500 text-green-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >📅 配信予定表</button>
      </div>

      {tab === 'schedule' ? (
        <ScheduleCalendar
          lineAccountId={selectedAccount.id}
          casts={casts.map((c) => ({
            id: c.id,
            stripchatUsername: c.stripchatUsername,
            displayName: c.displayName,
            status: c.status,
          }))}
          month={selectedMonth}
          onMonthChange={setSelectedMonth}
        />
      ) : (
      <>
      {/* サマリー */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3">
        <SummaryCard label="在籍キャスト" value={`${active.length}名`} />
        <SummaryCard label={`${selectedMonth} 売上合計`} value={`${totalTokens.toLocaleString()} tk`} sub={fmtJpy(totalTokens)} />
        <SummaryCard label={`${selectedMonth} キャスト報酬`} value={`${totalCastPay.toLocaleString()} tk`} sub={fmtJpy(totalCastPay)} />
        <SummaryCard label={`${selectedMonth} 紹介者報酬`} value={`${totalIntroducerPay.toLocaleString()} tk`} sub={fmtJpy(totalIntroducerPay)} />
        <SummaryCard label={`${selectedMonth} 事務所利益`} value={`${totalOfficePay.toLocaleString()} tk`} sub={fmtJpy(totalOfficePay)} highlight />
      </div>

      {/* データ月の不一致警告 */}
      {casts.length > 0 && casts[0]?.lastMonthLabel && casts[0].lastMonthLabel !== selectedMonth && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
          ⚠️ 表示中のデータは <b>{casts[0].lastMonthLabel}</b> 月のものです。<b>{selectedMonth}</b> の最新データを取得するには「🔄 同期」をタップしてください。
        </div>
      )}

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center text-sm text-gray-400">
          読み込み中...
        </div>
      ) : casts.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-500 text-sm mb-2">キャストが登録されていません。</p>
          <p className="text-gray-400 text-xs">
            stripchat-agency 側で <code className="bg-gray-100 px-1.5 py-0.5 rounded">tools/sync_casts_to_lineharness.py</code> を実行してください。
          </p>
        </div>
      ) : (
        <>
        {/* ステータスフィルター */}
        <div className="flex items-center gap-2 mb-3 text-xs">
          <span className="text-gray-600">表示:</span>
          {(['active', 'retired', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1 rounded-full font-medium ${
                statusFilter === f
                  ? 'bg-green-600 text-white'
                  : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              {f === 'active' ? `在籍 (${casts.filter((c) => c.status === '在籍').length})`
                : f === 'retired' ? `退所 (${casts.filter((c) => c.status === '退所').length})`
                : `全て (${casts.length})`}
            </button>
          ))}
        </div>

        {(() => {
          const filteredCasts = casts.filter((c) => {
            if (statusFilter === 'active') return c.status === '在籍'
            if (statusFilter === 'retired') return c.status === '退所'
            return true
          })
          return (
        <>
        {/* モバイル: カード表示 */}
        <ul className="lg:hidden space-y-2">
          {filteredCasts.map((c) => {
            const cast = Math.round(c.lastMonthTokens * c.ratePercent / 100)
            const introPay = c.introducerId ? Math.round(c.lastMonthTokens * INTRODUCER_RATE) : 0
            const officePay = c.lastMonthTokens - cast - introPay
            return (
              <li key={c.id} className={`bg-white rounded-lg shadow-sm border border-gray-200 p-3 ${c.status === '退所' ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-mono font-semibold text-gray-900 truncate">{c.stripchatUsername}</p>
                      <StatusBadge status={c.status} />
                    </div>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {c.channel} · {c.contractVersion} · {c.stage} · {c.ratePercent}%
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <button
                      onClick={() => handleQuickRetire(c)}
                      className={`text-xs font-medium px-2 py-1 ${c.status === '退所' ? 'text-green-600' : 'text-red-600'}`}
                    >
                      {c.status === '退所' ? '↻ 復帰' : '✕ 退所'}
                    </button>
                    <button
                      onClick={() => setEditingCast(c)}
                      className="text-xs text-blue-600 font-medium px-2 py-1"
                    >
                      ✎ 編集
                    </button>
                    <a
                      href={`/casts/detail?slug=${encodeURIComponent(c.id)}`}
                      className="text-xs text-green-600 font-medium px-2 py-1"
                    >
                      詳細→
                    </a>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-1.5 bg-gray-50 rounded">
                    <p className="text-[10px] text-gray-500">売上</p>
                    <p className="text-sm font-bold text-gray-900">{c.lastMonthTokens.toLocaleString()}<span className="text-[10px] font-normal"> tk</span></p>
                    <p className="text-[10px] text-gray-400">{fmtJpy(c.lastMonthTokens)}</p>
                  </div>
                  <div className="p-1.5 bg-gray-50 rounded">
                    <p className="text-[10px] text-gray-500">取り分</p>
                    <p className="text-sm font-bold text-gray-900">{cast.toLocaleString()}<span className="text-[10px] font-normal"> tk</span></p>
                    <p className="text-[10px] text-gray-400">{fmtJpy(cast)}</p>
                  </div>
                  <div className="p-1.5 bg-green-50 rounded">
                    <p className="text-[10px] text-green-700">事務所利益</p>
                    <p className="text-sm font-bold text-green-800">{officePay.toLocaleString()}<span className="text-[10px] font-normal"> tk</span></p>
                    <p className="text-[10px] text-green-600">{fmtJpy(officePay)}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2 text-[11px] text-gray-500">
                  <span>稼働 {c.workingDays}日</span>
                  <span className="truncate">紹介者: {c.introducerName ? `${c.introducerName}` : (c.introducerId ?? '—')}{c.introducerId ? ` (${introPay.toLocaleString()} tk)` : ''}</span>
                  <span className="shrink-0">{c.joinedAt ?? '—'}</span>
                </div>

                {/* 招待URL */}
                <div className="mt-2">
                  <button
                    onClick={() => setInvitingCast(c)}
                    className="w-full px-3 py-1.5 text-xs font-medium text-green-700 bg-white border border-green-200 rounded hover:bg-green-50"
                  >
                    {c.liffBound ? '✅ 紐付け済み（再発行）' : '📨 招待URLを発行'}
                  </button>
                </div>

                {/* 明細書発行 */}
                <div className="mt-3 pt-3 border-t border-gray-100">
                  {issueResult?.castId === c.id ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1 text-xs text-green-700">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/></svg>
                        発行成功（60日有効・3年間R2保管）
                      </div>
                      <div className="flex items-center gap-1.5">
                        <a
                          href={issueResult.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 text-center px-3 py-1.5 text-xs font-medium text-white rounded"
                          style={{ backgroundColor: '#06C755' }}
                        >
                          👁 閲覧
                        </a>
                        <a
                          href={`${issueResult.url}?dl=1`}
                          className="flex-1 text-center px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
                        >
                          ⬇ DL
                        </a>
                        <button
                          onClick={() => handleCopyUrl(issueResult.url)}
                          className="flex-1 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
                        >
                          {copied ? '✓' : '🔗 URL'}
                        </button>
                      </div>
                      <p className="text-[10px] text-gray-400">URLコピーでLINE送信→キャストが1タップでPDF閲覧</p>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleIssuePayslip(c.id)}
                      disabled={!!issuingCastId}
                      className="w-full px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                    >
                      {issuingCastId === c.id ? '発行中...' : `📄 ${selectedMonth} の明細書を発行`}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        {/* デスクトップ: テーブル */}
        <div className="hidden lg:block bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500">
                <th className="px-3 py-3 text-left">slug</th>
                <th className="px-3 py-3 text-left">配信形態</th>
                <th className="px-3 py-3 text-left">契約</th>
                <th className="px-3 py-3 text-left">ステージ</th>
                <th className="px-3 py-3 text-right">レート</th>
                <th className="px-3 py-3 text-right">稼働日</th>
                <th className="px-3 py-3 text-right">今月 売上 (tk)</th>
                <th className="px-3 py-3 text-right">取り分 (tk)</th>
                <th className="px-3 py-3 text-left">紹介者</th>
                <th className="px-3 py-3 text-right">紹介者報酬 (tk)</th>
                <th className="px-3 py-3 text-right">事務所利益 (tk)</th>
                <th className="px-3 py-3 text-left">状態</th>
                <th className="px-3 py-3 text-left">入店日</th>
                <th className="px-3 py-3 text-center">明細書</th>
                <th className="px-3 py-3 text-center">招待</th>
                <th className="px-3 py-3 text-right">詳細</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredCasts.map((c) => {
                const cast = Math.round(c.lastMonthTokens * c.ratePercent / 100)
                const introPay = c.introducerId ? Math.round(c.lastMonthTokens * INTRODUCER_RATE) : 0
                const officePay = c.lastMonthTokens - cast - introPay
                const introLabel = c.introducerName
                  ? `${c.introducerName}（${c.introducerId}）`
                  : (c.introducerId ?? '—')
                return (
                  <tr key={c.id} className={`hover:bg-gray-50 transition-colors ${c.status === '退所' ? 'opacity-60' : ''}`}>
                    <td className="px-3 py-3 font-mono">{c.stripchatUsername}</td>
                    <td className="px-3 py-3">{c.channel}</td>
                    <td className="px-3 py-3">{c.contractVersion}</td>
                    <td className="px-3 py-3">{c.stage}</td>
                    <td className="px-3 py-3 text-right">{c.ratePercent}%</td>
                    <td className="px-3 py-3 text-right">{c.workingDays}日</td>
                    <td className="px-3 py-3 text-right">
                      {c.lastMonthTokens.toLocaleString()}
                      <div className="text-xs text-gray-400">{fmtJpy(c.lastMonthTokens)}</div>
                    </td>
                    <td className="px-3 py-3 text-right font-medium text-gray-900">
                      {cast.toLocaleString()}
                      <div className="text-xs text-gray-400">{fmtJpy(cast)}</div>
                    </td>
                    <td className="px-3 py-3 text-gray-500">{introLabel}</td>
                    <td className="px-3 py-3 text-right text-gray-700">
                      {c.introducerId ? (
                        <>
                          {introPay.toLocaleString()}
                          <div className="text-xs text-gray-400">{fmtJpy(introPay)}</div>
                        </>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right text-green-700 font-medium">
                      {officePay.toLocaleString()}
                      <div className="text-xs text-green-600">{fmtJpy(officePay)}</div>
                    </td>
                    <td className="px-3 py-3"><StatusBadge status={c.status} /></td>
                    <td className="px-3 py-3 text-gray-500">{c.joinedAt ?? '—'}</td>
                    <td className="px-3 py-3 text-center">
                      {issueResult?.castId === c.id ? (
                        <div className="flex items-center justify-center gap-1">
                          <a
                            href={issueResult.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="新規タブで閲覧"
                            className="px-2 py-1 text-[11px] font-medium text-white rounded"
                            style={{ backgroundColor: '#06C755' }}
                          >
                            👁
                          </a>
                          <a
                            href={`${issueResult.url}?dl=1`}
                            title="ダウンロード"
                            className="px-2 py-1 text-[11px] font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
                          >
                            ⬇
                          </a>
                          <button
                            onClick={() => handleCopyUrl(issueResult.url)}
                            title="URLをコピー"
                            className="px-2 py-1 text-[11px] font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
                          >
                            {copied ? '✓' : '🔗'}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleIssuePayslip(c.id)}
                          disabled={!!issuingCastId}
                          className="px-2 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                        >
                          {issuingCastId === c.id ? '...' : '📄 発行'}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <button
                        onClick={() => setInvitingCast(c)}
                        title={c.liffBound ? '紐付け済み（再発行・解除）' : '招待URLを発行'}
                        className="px-2 py-1 text-xs font-medium text-green-700 bg-white border border-green-200 rounded hover:bg-green-50"
                      >
                        {c.liffBound ? '✅' : '📨'}
                      </button>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleQuickRetire(c)}
                          className={`text-xs font-medium ${c.status === '退所' ? 'text-green-600 hover:text-green-800' : 'text-red-600 hover:text-red-800'}`}
                        >
                          {c.status === '退所' ? '↻ 復帰' : '✕ 退所'}
                        </button>
                        <button
                          onClick={() => setEditingCast(c)}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                        >
                          ✎ 編集
                        </button>
                        <a href={`/casts/detail?slug=${encodeURIComponent(c.id)}`}
                           className="text-green-600 hover:text-green-700 text-xs font-medium">
                          詳細 →
                        </a>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        </>
          )
        })()}
        </>
      )}

      <p className="mt-4 text-xs text-gray-400">
        最終同期: {casts[0]?.lastSyncedAt ? new Date(casts[0].lastSyncedAt).toLocaleString('ja-JP') : '—'}
        ／ 売上は今月（{casts[0]?.lastMonthLabel ?? '—'}）の Stripchat Studio API <code>totalEarnings</code> を1tk≒¥{JPY_PER_TOKEN}換算
        ／ 紹介者報酬 = 売上 × {Math.round(INTRODUCER_RATE * 100)}%
      </p>
      </>
      )}

      {invitingCast && (
        <InviteModal
          castId={invitingCast.id}
          castLabel={invitingCast.stripchatUsername}
          alreadyBound={!!invitingCast.liffBound}
          onClose={() => setInvitingCast(null)}
          onUnbind={reloadCasts}
        />
      )}

      {showAddCast && selectedAccount && (
        <AddCastModal
          lineAccountId={selectedAccount.id}
          onClose={() => setShowAddCast(false)}
          onCreated={reloadCasts}
        />
      )}

      {editingCast && selectedAccount && (
        <AddCastModal
          lineAccountId={selectedAccount.id}
          onClose={() => setEditingCast(null)}
          onCreated={reloadCasts}
          existingCast={{
            id: editingCast.id,
            stripchatUsername: editingCast.stripchatUsername,
            displayName: editingCast.displayName,
            channel: editingCast.channel,
            contractVersion: editingCast.contractVersion,
            stage: editingCast.stage,
            ratePercent: editingCast.ratePercent,
            introducerId: editingCast.introducerId,
            introducerName: editingCast.introducerName,
            status: editingCast.status,
            joinedAt: editingCast.joinedAt,
            notes: editingCast.notes ?? null,
          }}
        />
      )}
    </div>
  )
}

function SummaryCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`border rounded-lg p-2.5 sm:p-4 ${highlight ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
      <p className={`text-[10px] sm:text-xs mb-0.5 sm:mb-1 ${highlight ? 'text-green-700' : 'text-gray-500'}`}>{label}</p>
      <p className={`text-sm sm:text-lg font-semibold ${highlight ? 'text-green-800' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className={`text-[10px] sm:text-xs ${highlight ? 'text-green-600' : 'text-gray-400'}`}>{sub}</p>}
    </div>
  )
}
