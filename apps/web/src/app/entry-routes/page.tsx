'use client'
import { useEffect, useState, useCallback } from 'react'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'

const CATEGORIES = ['広告', 'リファラル', 'SNS'] as const
type Category = typeof CATEGORIES[number]

interface EntryRoute {
  id: string
  refCode: string
  name: string
  category: string | null
  tagId: string | null
  scenarioId: string | null
  redirectUrl: string | null
  isActive: boolean
  lineAccountId: string | null
  friendCount: number
  createdAt: string
}

interface Tag { id: string; name: string }
interface Scenario { id: string; name: string }

const WORKER_BASE = process.env.NEXT_PUBLIC_API_URL || ''

export default function EntryRoutesPage() {
  const { selectedAccountId } = useAccount()
  const [routes, setRoutes] = useState<EntryRoute[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<EntryRoute | null>(null)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const handleCopy = async (url: string, refCode: string) => {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = url
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(refCode)
    setTimeout(() => setCopied(null), 1500)
  }

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const q = selectedAccountId ? `?lineAccountId=${selectedAccountId}` : ''
      const [routesRes, tagsRes, scenariosRes] = await Promise.all([
        fetchApi<{ success: boolean; data: EntryRoute[]; error?: string }>(`/api/entry-routes${q}`),
        fetchApi<{ success: boolean; data: Tag[] }>(`/api/tags${q}`),
        fetchApi<{ success: boolean; data: Scenario[] }>(`/api/scenarios${q}`),
      ])
      if (routesRes.success) setRoutes(routesRes.data)
      else setError(routesRes.error ?? '読み込み失敗')
      if (tagsRes.success) setTags(tagsRes.data)
      if (scenariosRes.success) setScenarios(scenariosRes.data)
    } catch {
      setError('読み込み失敗')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { load() }, [load])

  const handleDelete = async (route: EntryRoute) => {
    if (!confirm(`登録経路「${route.name}」(${route.refCode}) を削除しますか？\n友だち${route.friendCount}人の経路情報は残ります（経路定義のみ削除）`)) return
    try {
      const res = await fetchApi<{ success: boolean; error?: string }>(`/api/entry-routes/${route.id}`, { method: 'DELETE' })
      if (!res.success) { setError(res.error ?? '削除失敗'); return }
      load()
    } catch {
      setError('削除失敗')
    }
  }

  const grouped: Record<string, EntryRoute[]> = {}
  for (const cat of CATEGORIES) grouped[cat] = []
  grouped['未分類'] = []
  for (const r of routes) {
    const cat = r.category && CATEGORIES.includes(r.category as Category) ? r.category : '未分類'
    grouped[cat].push(r)
  }

  return (
    <div>
      <Header
        title="登録経路"
        description="広告・SNS・紹介などの友だち獲得経路を管理"
        action={
          <button
            onClick={() => setCreating(true)}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg"
            style={{ backgroundColor: '#06C755' }}
          >+ 経路追加</button>
        }
      />

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-400">読み込み中...</div>
      ) : routes.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <p className="text-gray-500 text-sm mb-2">登録経路がまだありません</p>
          <p className="text-gray-400 text-xs">「+ 経路追加」から作成してください</p>
        </div>
      ) : (
        <div className="space-y-6">
          {[...CATEGORIES, '未分類'].map((cat) => {
            const list = grouped[cat]
            if (list.length === 0 && cat === '未分類') return null
            return (
              <section key={cat}>
                <h2 className="text-sm font-bold text-gray-700 mb-2">
                  {cat === '広告' ? '📢 広告' : cat === 'リファラル' ? '👥 リファラル' : cat === 'SNS' ? '🌐 SNS' : '❓ 未分類'}
                  <span className="ml-2 text-xs font-normal text-gray-400">({list.length})</span>
                </h2>
                {list.length === 0 ? (
                  <p className="text-xs text-gray-400 pl-4">なし</p>
                ) : (
                  <ul className="space-y-2">
                    {list.map((r) => (
                      <li key={r.id} className={`bg-white rounded-lg border border-gray-200 p-3 ${!r.isActive ? 'opacity-60' : ''}`}>
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="text-sm font-semibold text-gray-900">{r.name}</h3>
                              <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono">{r.refCode}</code>
                              {!r.isActive && (
                                <span className="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">無効</span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                              <span>👥 {r.friendCount}人 獲得</span>
                              {r.tagId && <span>🏷 タグ自動付与</span>}
                              {r.scenarioId && <span>📜 シナリオ自動投入</span>}
                            </div>
                            <div className="text-[10px] text-gray-400 mt-1 break-all font-mono">
                              {WORKER_BASE}/r/{r.refCode}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => handleCopy(`${WORKER_BASE}/r/${r.refCode}`, r.refCode)}
                              className={`px-2 py-1 text-xs font-medium border rounded transition-colors ${
                                copied === r.refCode
                                  ? 'text-green-700 bg-green-50 border-green-300'
                                  : 'text-gray-600 bg-white border-gray-200 hover:bg-gray-50'
                              }`}
                              title="共有URLをコピー"
                            >{copied === r.refCode ? '✓' : '🔗'}</button>
                            <button
                              onClick={() => setEditing(r)}
                              className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-white border border-blue-200 rounded hover:bg-blue-50"
                            >✎ 編集</button>
                            <button
                              onClick={() => handleDelete(r)}
                              className="px-3 py-1.5 text-xs font-medium text-red-600 bg-white border border-red-200 rounded hover:bg-red-50"
                            >削除</button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}

      {(editing || creating) && (
        <RouteEditor
          existing={editing}
          tags={tags}
          scenarios={scenarios}
          lineAccountId={selectedAccountId}
          onClose={() => { setEditing(null); setCreating(false) }}
          onSaved={() => { setEditing(null); setCreating(false); load() }}
        />
      )}
    </div>
  )
}

interface EditorProps {
  existing: EntryRoute | null
  tags: Tag[]
  scenarios: Scenario[]
  lineAccountId: string | null
  onClose: () => void
  onSaved: () => void
}

function RouteEditor({ existing, tags, scenarios, lineAccountId, onClose, onSaved }: EditorProps) {
  const [name, setName] = useState(existing?.name ?? '')
  const [refCode, setRefCode] = useState(existing?.refCode ?? '')
  const [category, setCategory] = useState<string>(existing?.category ?? '広告')
  const [tagId, setTagId] = useState(existing?.tagId ?? '')
  const [scenarioId, setScenarioId] = useState(existing?.scenarioId ?? '')
  const [redirectUrl, setRedirectUrl] = useState(existing?.redirectUrl ?? '')
  const [isActive, setIsActive] = useState(existing?.isActive ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // refCode自動サジェスト（新規作成時のみ・名前から英数字変換）
  const suggestRefCode = () => {
    if (existing) return  // 編集時はサジェストしない
    const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    if (base) setRefCode(base + '_' + Math.random().toString(36).slice(2, 6))
  }

  const save = async () => {
    setError('')
    if (!name.trim()) { setError('経路名は必須です'); return }
    if (!refCode.trim()) { setError('refCodeは必須です'); return }
    if (!/^[a-zA-Z0-9_-]+$/.test(refCode)) { setError('refCodeは半角英数・ハイフン・アンダースコアのみ'); return }

    setSaving(true)
    try {
      const body = {
        refCode: refCode.trim(),
        name: name.trim(),
        category,
        tagId: tagId || null,
        scenarioId: scenarioId || null,
        redirectUrl: redirectUrl.trim() || null,
        isActive,
        ...(existing ? {} : { lineAccountId }),
      }
      const url = existing ? `/api/entry-routes/${existing.id}` : '/api/entry-routes'
      const method = existing ? 'PUT' : 'POST'
      const res = await fetchApi<{ success: boolean; error?: string }>(url, {
        method, body: JSON.stringify(body),
      })
      if (!res.success) { setError(res.error ?? '保存失敗'); return }
      onSaved()
    } catch {
      setError('保存失敗')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b border-gray-200">
          <div>
            <h3 className="text-base font-semibold text-gray-900">{existing ? '登録経路 編集' : '登録経路 追加'}</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">経路名 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={suggestRefCode}
              placeholder="例: メタ広告 5月キャンペーン"
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">カテゴリ</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === '広告' ? '📢 広告' : cat === 'リファラル' ? '👥 リファラル' : '🌐 SNS'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">refCode（共有URL用） *</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={refCode}
                onChange={(e) => setRefCode(e.target.value)}
                placeholder="meta_may_001"
                className="flex-1 text-sm font-mono border border-gray-300 rounded px-2 py-1.5"
              />
              {!existing && (
                <button
                  type="button"
                  onClick={suggestRefCode}
                  className="px-2 py-1 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded hover:bg-gray-50"
                >自動生成</button>
              )}
            </div>
            <p className="text-[10px] text-gray-400 mt-1">
              共有URL: <code className="font-mono">{WORKER_BASE}/r/{refCode || '...'}</code>
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">タグ（自動付与・任意）</label>
            <select
              value={tagId}
              onChange={(e) => setTagId(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
            >
              <option value="">なし</option>
              {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">シナリオ（自動投入・任意）</label>
            <select
              value={scenarioId}
              onChange={(e) => setScenarioId(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
            >
              <option value="">なし</option>
              {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">リダイレクトURL（任意）</label>
            <input
              type="url"
              value={redirectUrl}
              onChange={(e) => setRedirectUrl(e.target.value)}
              placeholder="https://..."
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              友だち追加完了後にここで指定したURLへ自動遷移
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-4 h-4"
            />
            <span>有効（無効化すると新規追加できなくなる）</span>
          </label>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-gray-200 bg-gray-50">
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
          >{saving ? '保存中...' : (existing ? '保存' : '作成')}</button>
        </div>
      </div>
    </div>
  )
}
