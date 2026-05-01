'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { api, type OverviewItem } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) {
    return <span className="text-xs text-gray-400">—</span>
  }
  if (delta === 0) {
    return <span className="text-xs text-gray-500">±0</span>
  }
  const positive = delta > 0
  return (
    <span
      className={`text-xs font-medium ${
        positive ? 'text-green-600' : 'text-red-600'
      }`}
    >
      {positive ? '+' : ''}
      {delta.toLocaleString('ja-JP')}
    </span>
  )
}

export default function OverviewPage() {
  const { accounts, setSelectedAccountId } = useAccount()
  const [items, setItems] = useState<OverviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await api.overview.list()
        if (res.success) {
          setItems(res.data)
        } else {
          setError('データの読み込みに失敗しました')
        }
      } catch {
        setError('データの読み込みに失敗しました')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const totalFriends = items.reduce((sum, i) => sum + i.friendCount, 0)
  const totalDelta = items.reduce((sum, i) => sum + (i.delta ?? 0), 0)
  const hasAnyDelta = items.some((i) => i.delta !== null)
  const totalUnread = items.reduce((sum, i) => sum + i.unreadCount, 0)

  const accountMeta = (accountId: string) =>
    accounts.find((a) => a.id === accountId)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
          ホーム（全アカウント）
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          運営中の LINE 公式アカウントの状況を一覧で確認できます
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}


      {/* Per-account list */}
      <div>
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400 bg-white rounded-lg border border-gray-200">
            読み込み中...
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400 bg-white rounded-lg border border-gray-200">
            LINEアカウントがまだ登録されていません。
            <Link
              href="/accounts"
              className="ml-2 text-green-600 hover:underline"
            >
              アカウント設定へ
            </Link>
          </div>
        ) : (
          <>
            {/* モバイル: リッチカード */}
            <div className="lg:hidden space-y-3">
              {items.map((item) => {
                const meta = accountMeta(item.accountId)
                const title = meta?.displayName || meta?.name || item.name
                const hasUnread = item.unreadCount > 0
                return (
                  <Link
                    key={item.accountId}
                    href="/dashboard"
                    onClick={() => setSelectedAccountId(item.accountId)}
                    className="block bg-white rounded-xl shadow-sm border border-gray-200 p-4 active:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      {meta?.pictureUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={meta.pictureUrl} alt="" className="w-12 h-12 rounded-full shrink-0" />
                      ) : (
                        <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-base font-bold shrink-0" style={{ backgroundColor: '#06C755' }}>
                          {title.slice(0, 1)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 truncate">{title}</p>
                        <span className={`inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full ${item.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {item.isActive ? '稼働中' : '停止中'}
                        </span>
                      </div>
                      <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-center p-2 bg-gray-50 rounded-lg">
                        <p className="text-[10px] text-gray-500 mb-0.5">友だち</p>
                        <p className="text-base font-bold text-gray-900">{item.friendCount.toLocaleString('ja-JP')}</p>
                      </div>
                      <div className="text-center p-2 bg-gray-50 rounded-lg">
                        <p className="text-[10px] text-gray-500 mb-0.5">前日比</p>
                        <p className="text-base font-bold">
                          <DeltaBadge delta={item.delta} />
                        </p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.preventDefault()
                          setSelectedAccountId(item.accountId)
                          window.location.href = '/chats'
                        }}
                        className={`text-center p-2 rounded-lg transition-colors ${
                          hasUnread ? 'bg-red-50 active:bg-red-100' : 'bg-gray-50'
                        }`}
                      >
                        <p className="text-[10px] text-gray-500 mb-0.5">未読</p>
                        <p className={`text-base font-bold ${hasUnread ? 'text-red-600' : 'text-gray-700'}`}>
                          {item.unreadCount}
                        </p>
                      </button>
                    </div>
                  </Link>
                )
              })}
            </div>

            {/* デスクトップ用ラッパー */}
            <div className="hidden lg:block bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-200">
                <h2 className="text-sm font-semibold text-gray-800">
                  アカウント別ステータス
                </h2>
              </div>

            {/* デスクトップ: テーブル表示 */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">
                      アカウント
                    </th>
                    <th className="px-5 py-3 text-right font-medium">
                      友だち数
                    </th>
                    <th className="px-5 py-3 text-right font-medium">前日比</th>
                    <th className="px-5 py-3 text-right font-medium">未読</th>
                    <th className="px-5 py-3 text-right font-medium">状態</th>
                    <th className="px-5 py-3 text-right font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((item) => {
                    const meta = accountMeta(item.accountId)
                    const title =
                      meta?.displayName || meta?.name || item.name
                    return (
                      <tr
                        key={item.accountId}
                        className="hover:bg-gray-50 transition-colors"
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            {meta?.pictureUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={meta.pictureUrl}
                                alt=""
                                className="w-8 h-8 rounded-full shrink-0"
                              />
                            ) : (
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                                style={{ backgroundColor: '#06C755' }}
                              >
                                {title.slice(0, 1)}
                              </div>
                            )}
                            <div>
                              <p className="font-medium text-gray-900">
                                {title}
                              </p>
                              <p className="text-xs text-gray-400">
                                {item.channelId}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-right font-semibold text-gray-900">
                          {item.friendCount.toLocaleString('ja-JP')}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <DeltaBadge delta={item.delta} />
                          {item.yesterdayCount === null && (
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              履歴なし
                            </p>
                          )}
                        </td>
                        <td className="px-5 py-4 text-right">
                          {item.unreadCount > 0 ? (
                            <Link
                              href="/chats"
                              onClick={() =>
                                setSelectedAccountId(item.accountId)
                              }
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium hover:bg-red-200 transition-colors"
                            >
                              {item.unreadCount}
                            </Link>
                          ) : (
                            <span className="text-gray-400">0</span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-right">
                          {item.isActive ? (
                            <span className="text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                              稼働中
                            </span>
                          ) : (
                            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                              停止中
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <Link
                            href="/dashboard"
                            onClick={() =>
                              setSelectedAccountId(item.accountId)
                            }
                            className="text-xs text-green-600 hover:text-green-700 hover:underline"
                          >
                            詳細 →
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            </div>
          </>
        )}
      </div>

      {!loading && items.some((i) => i.yesterdayCount === null) && (
        <p className="text-xs text-gray-400 mt-4">
          ※「履歴なし」のアカウントは、前日のスナップショットがまだ記録されていません。明日以降から前日比が表示されます。
        </p>
      )}
    </div>
  )
}
