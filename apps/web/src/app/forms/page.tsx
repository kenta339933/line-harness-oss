'use client'
import { useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'

type FieldType = 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'date'

interface FormField {
  name: string
  label: string
  type: FieldType
  required?: boolean
  options?: string[]
  placeholder?: string
  columns?: number
}

interface Form {
  id: string
  name: string
  description: string | null
  fields: FormField[]
  isActive: boolean
  submitCount: number
  createdAt: string
  updatedAt: string
}

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'テキスト（1行）',
  textarea: 'テキスト（複数行）',
  email: 'メール',
  tel: '電話番号',
  number: '数字',
  select: 'プルダウン',
  radio: 'ラジオボタン',
  checkbox: 'チェックボックス',
  date: '日付',
}

const HAS_OPTIONS: FieldType[] = ['select', 'radio', 'checkbox']

export default function FormsPage() {
  const { selectedAccountId } = useAccount()
  const [forms, setForms] = useState<Form[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Form | null>(null)
  const [creating, setCreating] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const q = selectedAccountId ? `?lineAccountId=${selectedAccountId}` : ''
      const res = await fetchApi<{ success: boolean; data: Form[]; error?: string }>(`/api/forms${q}`)
      if (res.success) setForms(res.data)
      else setError(res.error ?? '読み込み失敗')
    } catch {
      setError('読み込み失敗')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId])

  const handleDelete = async (form: Form) => {
    if (!confirm(`フォーム「${form.name}」を削除しますか？\n回答データは残ります（フォーム定義のみ削除）`)) return
    try {
      const res = await fetchApi<{ success: boolean; error?: string }>(`/api/forms/${form.id}`, { method: 'DELETE' })
      if (!res.success) { setError(res.error ?? '削除失敗'); return }
      load()
    } catch {
      setError('削除失敗')
    }
  }

  return (
    <div>
      <Header
        title="フォーム"
        description="アンケート・申込フォームの定義を管理"
        action={
          <button
            onClick={() => setCreating(true)}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg"
            style={{ backgroundColor: '#06C755' }}
          >+ フォーム作成</button>
        }
      />

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-400">読み込み中...</div>
      ) : forms.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <p className="text-gray-500 text-sm mb-2">フォームがありません</p>
          <p className="text-gray-400 text-xs">「+ フォーム作成」から新規フォームを作成してください</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {forms.map((form) => (
            <li key={form.id} className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-gray-900">{form.name}</h3>
                    {form.isActive ? (
                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-800">有効</span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">無効</span>
                    )}
                  </div>
                  {form.description && <p className="text-xs text-gray-500 mt-1">{form.description}</p>}
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                    <span>📝 {form.fields.length} 項目</span>
                    <span>📊 {form.submitCount} 件回答</span>
                    <code className="text-[10px] bg-gray-100 px-1 rounded">{form.id.slice(0, 8)}</code>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setEditing(form)}
                    className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-white border border-blue-200 rounded hover:bg-blue-50"
                  >✎ 編集</button>
                  <button
                    onClick={() => handleDelete(form)}
                    className="px-3 py-1.5 text-xs font-medium text-red-600 bg-white border border-red-200 rounded hover:bg-red-50"
                  >削除</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(editing || creating) && (
        <FormEditor
          existing={editing}
          lineAccountId={selectedAccountId}
          onClose={() => { setEditing(null); setCreating(false) }}
          onSaved={() => { setEditing(null); setCreating(false); load() }}
        />
      )}
    </div>
  )
}

// ───── Form Editor ─────

interface EditorProps {
  existing: Form | null
  lineAccountId: string | null
  onClose: () => void
  onSaved: () => void
}

function FormEditor({ existing, lineAccountId, onClose, onSaved }: EditorProps) {
  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [fields, setFields] = useState<FormField[]>(existing?.fields ?? [])
  const [isActive, setIsActive] = useState(existing?.isActive ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')

  const addField = () => {
    setFields([...fields, {
      name: `field_${Date.now()}`,
      label: '新しい項目',
      type: 'text',
      required: false,
    }])
  }

  const updateField = (idx: number, patch: Partial<FormField>) => {
    setFields(fields.map((f, i) => i === idx ? { ...f, ...patch } : f))
  }

  const removeField = (idx: number) => {
    if (!confirm('この項目を削除しますか？')) return
    setFields(fields.filter((_, i) => i !== idx))
  }

  const moveField = (idx: number, delta: number) => {
    const newIdx = idx + delta
    if (newIdx < 0 || newIdx >= fields.length) return
    const next = [...fields]
    ;[next[idx], next[newIdx]] = [next[newIdx], next[idx]]
    setFields(next)
  }

  const save = async () => {
    setError('')
    if (!name.trim()) { setError('フォーム名は必須です'); return }
    if (fields.length === 0) { setError('項目を1つ以上追加してください'); return }

    // 名前の重複チェック
    const names = new Set<string>()
    for (const f of fields) {
      if (!f.name.trim()) { setError('項目のキー名が空です'); return }
      if (names.has(f.name)) { setError(`項目キー「${f.name}」が重複してます`); return }
      names.add(f.name)
      if (HAS_OPTIONS.includes(f.type) && (!f.options || f.options.length === 0)) {
        setError(`項目「${f.label}」に選択肢を追加してください`); return
      }
    }

    setSaving(true)
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        fields,
        isActive,
        ...(existing ? {} : { lineAccountId }),
      }
      const url = existing ? `/api/forms/${existing.id}` : '/api/forms'
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
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b border-gray-200">
          <div>
            <h3 className="text-base font-semibold text-gray-900">{existing ? 'フォーム編集' : 'フォーム作成'}</h3>
            <p className="text-xs text-gray-500 mt-0.5">{existing ? `ID: ${existing.id}` : '新しいフォームを作成します'}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* タブ */}
        <div className="flex border-b border-gray-200 px-5 bg-gray-50">
          <button
            onClick={() => setTab('edit')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === 'edit' ? 'border-green-500 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >✎ 編集</button>
          <button
            onClick={() => setTab('preview')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === 'preview' ? 'border-green-500 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >👁 プレビュー</button>
        </div>

        {tab === 'preview' ? (
          <div className="flex-1 overflow-y-auto p-5 bg-gray-50">
            <FormPreview name={name} description={description} fields={fields} />
          </div>
        ) : (
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">フォーム名 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: お問い合わせフォーム"
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">説明（任意）</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-4 h-4"
            />
            <span>有効（公開状態）</span>
          </label>

          <div className="border-t border-gray-200 pt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">項目 ({fields.length})</label>
              <button
                onClick={addField}
                className="px-3 py-1 text-xs font-medium text-green-700 bg-white border border-green-300 rounded hover:bg-green-50"
              >+ 項目追加</button>
            </div>

            <ul className="space-y-2">
              {fields.map((f, idx) => (
                <li key={idx} className="border border-gray-200 rounded p-3 bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] text-gray-400 font-mono">#{idx + 1}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => moveField(idx, -1)}
                        disabled={idx === 0}
                        className="px-2 py-0.5 text-xs text-gray-600 bg-white border border-gray-300 rounded disabled:opacity-30"
                        title="上へ"
                      >↑</button>
                      <button
                        onClick={() => moveField(idx, +1)}
                        disabled={idx === fields.length - 1}
                        className="px-2 py-0.5 text-xs text-gray-600 bg-white border border-gray-300 rounded disabled:opacity-30"
                        title="下へ"
                      >↓</button>
                      <button
                        onClick={() => removeField(idx)}
                        className="px-2 py-0.5 text-xs text-red-600 bg-white border border-red-200 rounded hover:bg-red-50"
                      >削除</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div>
                      <label className="block text-[10px] font-medium text-gray-600 mb-0.5">ラベル（表示名）</label>
                      <input
                        type="text"
                        value={f.label}
                        onChange={(e) => updateField(idx, { label: e.target.value })}
                        className="w-full text-sm border border-gray-300 rounded px-2 py-1"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-gray-600 mb-0.5">キー名（英数字）</label>
                      <input
                        type="text"
                        value={f.name}
                        onChange={(e) => updateField(idx, { name: e.target.value })}
                        className="w-full text-sm font-mono border border-gray-300 rounded px-2 py-1"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-gray-600 mb-0.5">タイプ</label>
                      <select
                        value={f.type}
                        onChange={(e) => updateField(idx, { type: e.target.value as FieldType })}
                        className="w-full text-sm border border-gray-300 rounded px-2 py-1"
                      >
                        {(Object.keys(FIELD_TYPE_LABELS) as FieldType[]).map((t) => (
                          <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center pt-5">
                      <label className="flex items-center gap-1 text-sm">
                        <input
                          type="checkbox"
                          checked={f.required ?? false}
                          onChange={(e) => updateField(idx, { required: e.target.checked })}
                          className="w-4 h-4"
                        />
                        <span>必須</span>
                      </label>
                    </div>
                  </div>
                  {!HAS_OPTIONS.includes(f.type) && (
                    <div>
                      <label className="block text-[10px] font-medium text-gray-600 mb-0.5">プレースホルダー（任意）</label>
                      <input
                        type="text"
                        value={f.placeholder ?? ''}
                        onChange={(e) => updateField(idx, { placeholder: e.target.value })}
                        placeholder="例: 山田太郎"
                        className="w-full text-sm border border-gray-300 rounded px-2 py-1"
                      />
                    </div>
                  )}
                  {HAS_OPTIONS.includes(f.type) && (
                    <div>
                      <label className="block text-[10px] font-medium text-gray-600 mb-0.5">選択肢（1行=1項目）</label>
                      <textarea
                        value={(f.options ?? []).join('\n')}
                        onChange={(e) => updateField(idx, { options: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
                        rows={3}
                        placeholder="選択肢A&#10;選択肢B&#10;選択肢C"
                        className="w-full text-sm border border-gray-300 rounded px-2 py-1"
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {fields.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-4">項目がありません。「+ 項目追加」から始めてください</p>
            )}
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        )}

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

// ───── Form Preview ─────
// LIFFのフォーム表示と同じ見た目をモック
function FormPreview({ name, description, fields }: { name: string; description: string; fields: FormField[] }) {
  if (fields.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-400">
        項目を追加するとプレビューが表示されます
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 max-w-md mx-auto p-5">
      <h2 className="text-lg font-bold text-gray-900 mb-1">{name || '（フォーム名未設定）'}</h2>
      {description && <p className="text-xs text-gray-500 mb-4 whitespace-pre-line">{description}</p>}

      <div className="space-y-4">
        {fields.map((f, idx) => (
          <div key={`${f.name}-${idx}`}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {f.label || '（ラベル未設定）'}
              {f.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <PreviewField field={f} />
          </div>
        ))}
      </div>

      <button
        type="button"
        disabled
        className="w-full mt-6 py-3 text-sm font-semibold text-white rounded-lg disabled:opacity-60 cursor-not-allowed"
        style={{ backgroundColor: '#06C755' }}
      >送信（プレビューでは無効）</button>

      <p className="text-[10px] text-gray-400 text-center mt-3">※実際のLIFF表示と若干異なる場合があります</p>
    </div>
  )
}

function PreviewField({ field }: { field: FormField }) {
  const baseInput = 'w-full px-3 py-2 text-sm border border-gray-300 rounded'

  switch (field.type) {
    case 'textarea':
      return (
        <textarea
          rows={4}
          placeholder={field.placeholder ?? ''}
          className={baseInput}
          disabled
        />
      )
    case 'select': {
      const opts = field.options ?? []
      return (
        <select className={baseInput} disabled>
          <option value="">選択してください</option>
          {opts.map((o, i) => <option key={i} value={o}>{o}</option>)}
        </select>
      )
    }
    case 'radio': {
      const opts = field.options ?? []
      return (
        <div className={`grid ${field.columns === 2 ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
          {opts.map((o, i) => (
            <label key={i} className="flex items-center gap-2 text-sm text-gray-700">
              <input type="radio" name={`preview-${field.name}`} disabled className="w-4 h-4" />
              <span>{o}</span>
            </label>
          ))}
        </div>
      )
    }
    case 'checkbox': {
      const opts = field.options ?? []
      return (
        <div className={`grid ${field.columns === 2 ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
          {opts.map((o, i) => (
            <label key={i} className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" disabled className="w-4 h-4" />
              <span>{o}</span>
            </label>
          ))}
        </div>
      )
    }
    case 'date':
      return <input type="date" className={baseInput} disabled />
    case 'number':
      return <input type="number" placeholder={field.placeholder ?? ''} className={baseInput} disabled />
    case 'email':
      return <input type="email" placeholder={field.placeholder ?? ''} className={baseInput} disabled />
    case 'tel':
      return <input type="tel" placeholder={field.placeholder ?? ''} className={baseInput} disabled />
    default:
      return <input type="text" placeholder={field.placeholder ?? ''} className={baseInput} disabled />
  }
}
