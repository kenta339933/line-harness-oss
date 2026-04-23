'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'

interface Form {
  id: string
  name: string
  submitCount?: number
}

interface Submission {
  id: string
  formId: string
  friendId: string
  friendName?: string
  data: Record<string, unknown>
  createdAt: string
}

const PAGE_SIZE = 20

export default function FormSubmissionsPage() {
  const { selectedAccountId } = useAccount()
  const [forms, setForms] = useState<Form[]>([])
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [subLoading, setSubLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [fieldLabels, setFieldLabels] = useState<Record<string, string>>({})
  const [detailSubmission, setDetailSubmission] = useState<Submission | null>(null)

  const loadForms = useCallback(async () => {
    setLoading(true)
    try {
      const accountQuery = selectedAccountId ? `?lineAccountId=${selectedAccountId}` : ''
      const res = await fetchApi<{ success: boolean; data: Form[] }>(`/api/forms${accountQuery}`)
      if (res.success) setForms(res.data)
    } catch { /* silent */ }
    setLoading(false)
  }, [selectedAccountId])

  useEffect(() => {
    loadForms()
    setSelectedFormId(null)
    setSubmissions([])
  }, [loadForms])

  const loadSubmissions = useCallback(async (formId: string) => {
    setSubLoading(true)
    setPage(1)
    try {
      // Load form definition for field labels
      const formRes = await fetchApi<{ success: boolean; data: { fields: Array<{ name: string; label: string }> } }>(`/api/forms/${formId}`)

      const res = await fetchApi<{ success: boolean; data: (Submission & { friendName?: string })[] }>(`/api/forms/${formId}/submissions`)

      // Guard against race condition: only update if this form is still selected
      setSelectedFormId((current) => {
        if (current !== formId) return current
        if (formRes.success && formRes.data.fields) {
          const labels: Record<string, string> = {}
          const fields = typeof formRes.data.fields === 'string' ? JSON.parse(formRes.data.fields) : formRes.data.fields
          for (const f of fields) labels[f.name] = f.label
          setFieldLabels(labels)
        }
        if (res.success) {
          setSubmissions(res.data.map((s) => ({
            ...s,
            data: typeof s.data === 'string' ? JSON.parse(s.data) : s.data,
            friendName: s.friendName || '不明',
          })))
        }
        return current
      })
    } catch { /* silent */ }
    // Only clear loading if this form is still selected
    setSelectedFormId((current) => {
      if (current === formId) setSubLoading(false)
      return current
    })
  }, [selectedAccountId])

  const handleSelectForm = (formId: string) => {
    setSelectedFormId(formId)
    loadSubmissions(formId)
  }

  // Pagination
  const totalPages = Math.ceil(submissions.length / PAGE_SIZE)
  const paged = submissions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Get all unique field keys
  const fieldKeys = submissions.length > 0
    ? [...new Set(submissions.flatMap(s => Object.keys(s.data)))]
    : []

  return (
    <div>
      <Header title="フォーム回答" description="フォーム送信データの一覧" />

      {/* Form selector */}
      <div className="mb-6">
        <div className="flex flex-wrap gap-2">
          {loading ? (
            <div className="text-sm text-gray-400">読み込み中...</div>
          ) : (
            forms.map((form) => (
              <button
                key={form.id}
                onClick={() => handleSelectForm(form.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedFormId === form.id
                    ? 'text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                style={selectedFormId === form.id ? { backgroundColor: '#06C755' } : {}}
              >
                {form.name}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Stats */}
      {selectedFormId && !subLoading && submissions.length > 0 && (
        <div className="mb-4 text-sm text-gray-500">
          全 <span className="font-bold text-gray-900">{submissions.length}</span> 件の回答
        </div>
      )}

      {/* Table */}
      {selectedFormId && (
        subLoading ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">読み込み中...</div>
        ) : submissions.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">回答がありません</div>
        ) : (
          <>
            <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
              <table className="w-full min-w-[800px]">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">名前</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">日時</th>
                    {fieldKeys.map((key) => (
                      <th key={key} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">
                        {fieldLabels[key] || key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paged.map((sub) => (
                    <tr
                      key={sub.id}
                      className="hover:bg-green-50 cursor-pointer transition-colors"
                      onClick={() => setDetailSubmission(sub)}
                      title="クリックで全文表示"
                    >
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">{sub.friendName}</td>
                      <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                        {new Date(sub.createdAt).toLocaleString('ja-JP', {
                          month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      {fieldKeys.map((key) => (
                        <td key={key} className="px-4 py-3 text-sm text-gray-700 max-w-[240px] truncate">
                          {Array.isArray(sub.data[key])
                            ? (sub.data[key] as string[]).join(', ')
                            : (sub.data[key] !== null && sub.data[key] !== undefined && sub.data[key] !== '') ? String(sub.data[key]) : '-'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-xs text-gray-400">
                  {(page - 1) * PAGE_SIZE + 1}〜{Math.min(page * PAGE_SIZE, submissions.length)} 件 / 全{submissions.length}件
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50"
                  >
                    前へ
                  </button>
                  <span className="px-3 py-1.5 text-sm text-gray-500">{page} / {totalPages}</span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50"
                  >
                    次へ
                  </button>
                </div>
              </div>
            )}
          </>
        )
      )}

      {/* 詳細モーダル - 回答全文表示 */}
      {detailSubmission && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setDetailSubmission(null)}
        >
          <div
            className="bg-white rounded-lg max-w-3xl w-full max-h-[85vh] overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{detailSubmission.friendName} さんの回答</h2>
                <p className="text-xs text-gray-400 mt-1">
                  {new Date(detailSubmission.createdAt).toLocaleString('ja-JP', {
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                  })}
                </p>
              </div>
              <button
                onClick={() => setDetailSubmission(null)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100"
                aria-label="閉じる"
              >
                ×
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {fieldKeys.map((key) => {
                const val = detailSubmission.data[key]
                const displayVal = Array.isArray(val)
                  ? (val as unknown[]).map(v => String(v)).join(', ')
                  : (val !== null && val !== undefined && val !== '')
                    ? String(val)
                    : ''
                return (
                  <div key={key} className="border-b border-gray-100 pb-3 last:border-0">
                    <dt className="text-xs font-semibold text-gray-500 uppercase mb-1">
                      {fieldLabels[key] || key}
                    </dt>
                    <dd className="text-sm text-gray-900 whitespace-pre-wrap break-words">
                      {displayVal || <span className="text-gray-300">未入力</span>}
                    </dd>
                  </div>
                )
              })}
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-3 flex justify-end">
              <button
                onClick={() => setDetailSubmission(null)}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
