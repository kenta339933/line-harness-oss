'use client'
import { useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'
import type { ApiResponse } from '@line-crm/shared'

interface AccountListItem {
  id: string
  name: string
  displayName?: string
  pictureUrl?: string | null
}

interface Props {
  staffId: string
  staffName: string
  staffRole: string
  onClose: () => void
  onSaved: () => void
}

export default function AccountAccessModal({ staffId, staffName, staffRole, onClose, onSaved }: Props) {
  const [allAccounts, setAllAccounts] = useState<AccountListItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetchApi<ApiResponse<AccountListItem[]>>('/api/line-accounts'),
      fetchApi<ApiResponse<string[]>>(`/api/staff/${encodeURIComponent(staffId)}/accounts`),
    ])
      .then(([accs, current]) => {
        if (cancelled) return
        if (accs.success) setAllAccounts(accs.data)
        else setError(accs.error ?? 'アカウントの取得に失敗しました')
        if (current.success) setSelected(new Set(current.data))
      })
      .catch(() => !cancelled && setError('読み込みに失敗しました'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [staffId])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === allAccounts.length) setSelected(new Set())
    else setSelected(new Set(allAccounts.map((a) => a.id)))
  }

  const save = async () => {
    setSaving(true); setError('')
    try {
      const res = await fetchApi<ApiResponse<{ count: number }>>(
        `/api/staff/${encodeURIComponent(staffId)}/accounts`,
        {
          method: 'PUT',
          body: JSON.stringify({ lineAccountIds: Array.from(selected) }),
        },
      )
      if (!res.success) {
        setError(res.error ?? '保存に失敗しました')
        return
      }
      onSaved()
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b border-gray-200">
          <div>
            <h3 className="text-base font-semibold text-gray-900">{staffName} の担当アカウント</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {staffRole === 'owner'
                ? 'オーナーは全アカウントへ自動アクセス可能です'
                : 'チェックを入れたアカウントだけアクセス可能になります'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>
          ) : staffRole === 'owner' ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
              オーナーロールはこの設定の対象外です。
            </div>
          ) : allAccounts.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">アカウントがありません。</p>
          ) : (
            <>
              <button
                onClick={toggleAll}
                className="mb-3 text-xs text-green-700 hover:text-green-800 font-medium"
              >
                {selected.size === allAccounts.length ? '全解除' : '全選択'}
              </button>
              <ul className="space-y-1.5">
                {allAccounts.map((a) => (
                  <li key={a.id}>
                    <label className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected.has(a.id)}
                        onChange={() => toggle(a.id)}
                        className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                      />
                      {a.pictureUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.pictureUrl} alt="" className="w-6 h-6 rounded-full" />
                      )}
                      <span className="text-sm text-gray-900">{a.displayName || a.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}

          {error && (
            <p className="mt-3 text-xs text-red-600">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
          >キャンセル</button>
          {staffRole !== 'owner' && (
            <button
              onClick={save}
              disabled={saving || loading}
              className="px-4 py-2 text-sm font-medium text-white rounded disabled:opacity-50"
              style={{ backgroundColor: '#06C755' }}
            >{saving ? '保存中...' : '保存'}</button>
          )}
        </div>
      </div>
    </div>
  )
}
