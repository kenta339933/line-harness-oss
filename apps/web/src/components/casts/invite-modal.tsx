'use client'
import { useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'

interface Props {
  castId: string
  castLabel: string
  alreadyBound: boolean
  onClose: () => void
  onUnbind?: () => void
}

interface InviteResult {
  token: string
  expiresAt: string
  url: string
  alreadyBound: boolean
}

export default function InviteModal({ castId, castLabel, alreadyBound, onClose, onUnbind }: Props) {
  const [result, setResult] = useState<InviteResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [unbinding, setUnbinding] = useState(false)

  const issue = async () => {
    setLoading(true); setError('')
    try {
      const res = await fetchApi<{ success: boolean; data?: InviteResult; error?: string }>(
        `/api/casts/${encodeURIComponent(castId)}/invite`,
        { method: 'POST' },
      )
      if (res.success && res.data) setResult(res.data)
      else setError(res.error ?? '発行に失敗しました')
    } catch {
      setError('発行に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  // 自動発行
  useEffect(() => {
    issue()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [castId])

  const copy = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('URLをコピーしてください', result.url)
    }
  }

  const unbind = async () => {
    if (!confirm('現在の紐付けを解除しますか？\nキャストは再度招待URLから紐付けし直す必要があります。')) return
    setUnbinding(true); setError('')
    try {
      const res = await fetchApi<{ success: boolean; error?: string }>(
        `/api/casts/${encodeURIComponent(castId)}/invite/binding`,
        { method: 'DELETE' },
      )
      if (!res.success) {
        setError(res.error ?? '解除に失敗しました')
        return
      }
      onUnbind?.()
      onClose()
    } catch {
      setError('解除に失敗しました')
    } finally {
      setUnbinding(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900">{castLabel}</h3>
            <p className="text-xs text-gray-500 mt-0.5">配信予定表 招待URL</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {alreadyBound && (
          <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
            このキャストは既にLIFFに紐付け済みです。再発行で前のリンクは無効になります。
          </div>
        )}

        {loading && <p className="text-sm text-gray-500 text-center py-6">発行中...</p>}

        {result && !loading && (
          <>
            <p className="text-xs text-gray-600 mb-2">
              下記URLをLINEなどでキャストに送ってください。タップ→LINEログイン→紐付け完了。
            </p>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-3 break-all">
              <code className="text-xs font-mono text-gray-800">{result.url}</code>
            </div>
            <div className="flex gap-2 mb-3">
              <button
                onClick={copy}
                className="flex-1 px-4 py-2 text-sm font-medium text-white rounded"
                style={{ backgroundColor: '#06C755' }}
              >{copied ? '✓ コピー済み' : '🔗 URLをコピー'}</button>
              <button
                onClick={issue}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
              >再発行</button>
            </div>
            <p className="text-[10px] text-gray-400">
              有効期限: {new Date(result.expiresAt).toLocaleString('ja-JP')}（24時間）／ 1回使い切り
            </p>
          </>
        )}

        {alreadyBound && !loading && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <button
              onClick={unbind}
              disabled={unbinding}
              className="text-xs text-red-600 hover:text-red-800"
            >{unbinding ? '解除中...' : '⚠️ 紐付けを解除する'}</button>
          </div>
        )}

        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>
    </div>
  )
}
