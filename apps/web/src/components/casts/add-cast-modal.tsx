'use client'
import { useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'

const RATE_TABLE: Record<string, Record<string, Record<string, number>>> = {
  '19':  { '在宅': { '基本': 70, '中位': 75, '最上位': 80 }, '通勤': { '基本': 50, '中位': 55, '最上位': 60 } },
  '19b': { '在宅': { '基本': 60, '中位': 65, '最上位': 70 }, '通勤': { '基本': 50, '中位': 55, '最上位': 60 } },
}

export interface CastEditValues {
  id: string
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
  notes: string | null
  lineFriendId?: string | null
  reminderOffsetMinutes?: number | null
}

interface Props {
  lineAccountId: string
  onClose: () => void
  onCreated: () => void
  existingCast?: CastEditValues  // 指定されたら編集モード
}

export default function AddCastModal({ lineAccountId, onClose, onCreated, existingCast }: Props) {
  const isEdit = !!existingCast
  const [stripchatUsername, setStripchatUsername] = useState(existingCast?.stripchatUsername ?? '')
  const [displayName, setDisplayName] = useState(existingCast?.displayName ?? '')
  const [channel, setChannel] = useState<'在宅' | '通勤'>(((existingCast?.channel as '在宅' | '通勤') ?? '在宅'))
  const [contractVersion, setContractVersion] = useState<'19' | '19b'>(((existingCast?.contractVersion as '19' | '19b') ?? '19'))
  const [stage, setStage] = useState<'基本' | '中位' | '最上位'>(((existingCast?.stage as '基本' | '中位' | '最上位') ?? '基本'))
  const [status, setStatus] = useState<'在籍' | '退所'>(((existingCast?.status as '在籍' | '退所') ?? '在籍'))
  // 紹介者選択: '' = なし、'__new__' = 新規追加、それ以外は既存ID
  const [introducerSelect, setIntroducerSelect] = useState<string>(existingCast?.introducerId ?? '')
  const [introducers, setIntroducers] = useState<Array<{ id: string; name: string | null; castCount: number }>>([])
  const [newIntroducerId, setNewIntroducerId] = useState('')
  const [newIntroducerName, setNewIntroducerName] = useState('')
  // 既存紹介者の名前編集
  const [editingIntroducer, setEditingIntroducer] = useState(false)
  const [editIntroducerName, setEditIntroducerName] = useState('')
  const [renamingIntroducer, setRenamingIntroducer] = useState(false)
  const [joinedAt, setJoinedAt] = useState(existingCast?.joinedAt ?? (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })())
  const [notes, setNotes] = useState(existingCast?.notes ?? '')
  const [lineFriendId, setLineFriendId] = useState<string>(existingCast?.lineFriendId ?? '')
  const [reminderEnabled, setReminderEnabled] = useState<boolean>((existingCast?.reminderOffsetMinutes ?? 30) > 0)
  const [reminderOffsetMinutes, setReminderOffsetMinutes] = useState<number>(
    (existingCast?.reminderOffsetMinutes ?? 30) > 0 ? (existingCast?.reminderOffsetMinutes ?? 30) : 30
  )
  const [friendsList, setFriendsList] = useState<Array<{ id: string; displayName: string; pictureUrl?: string | null }>>([])
  const [friendSearch, setFriendSearch] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; message: string } | null>(
    isEdit ? { ok: true, message: '✅ 既存キャスト' } : null,
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const ratePercent = RATE_TABLE[contractVersion]?.[channel]?.[stage] ?? 0

  // チャトナビLINE友だちリスト取得（リマインド送信先紐付け用）
  useEffect(() => {
    fetchApi<{ success: boolean; data?: { items: Array<{ id: string; displayName: string; pictureUrl?: string | null }> } }>(
      `/api/friends?lineAccountId=${encodeURIComponent(lineAccountId)}&limit=200&search=${encodeURIComponent(friendSearch)}`,
    )
      .then((res) => {
        if (res.success && res.data) setFriendsList(res.data.items)
      })
      .catch(() => { /* no-op */ })
  }, [lineAccountId, friendSearch])

  // 紹介者リスト取得
  const reloadIntroducers = () => {
    fetchApi<{ success: boolean; data?: { introducers: Array<{ id: string; name: string | null; castCount: number }>; nextSuggestion: string }; error?: string }>(
      `/api/casts/_introducers?lineAccountId=${encodeURIComponent(lineAccountId)}`,
    )
      .then((res) => {
        if (res.success && res.data) {
          setIntroducers(res.data.introducers)
          setNewIntroducerId(res.data.nextSuggestion)
        }
      })
      .catch(() => { /* no-op */ })
  }
  useEffect(() => { reloadIntroducers() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineAccountId])

  const renameIntroducer = async () => {
    if (!introducerSelect || introducerSelect === '__new__') return
    setRenamingIntroducer(true)
    try {
      const res = await fetchApi<{ success: boolean; error?: string }>(
        `/api/casts/_introducers/${encodeURIComponent(introducerSelect)}?lineAccountId=${encodeURIComponent(lineAccountId)}`,
        { method: 'PATCH', body: JSON.stringify({ name: editIntroducerName.trim() }) },
      )
      if (!res.success) {
        setError(res.error ?? '紹介者名の更新に失敗しました')
        return
      }
      setEditingIntroducer(false)
      reloadIntroducers()
    } catch {
      setError('紹介者名の更新に失敗しました')
    } finally {
      setRenamingIntroducer(false)
    }
  }

  const verify = async () => {
    const username = stripchatUsername.trim()
    if (!username) {
      setVerifyResult({ ok: false, message: 'ユーザー名を入力してください' })
      return
    }
    setVerifying(true)
    setVerifyResult(null)
    try {
      const res = await fetchApi<{ success: boolean; data?: { exists: boolean; status: number }; error?: string }>(
        `/api/casts/_verify-stripchat?username=${encodeURIComponent(username)}`,
      )
      if (!res.success) {
        setVerifyResult({ ok: false, message: res.error ?? '検証エラー' })
      } else if (res.data?.exists) {
        setVerifyResult({ ok: true, message: '✅ Stripchatで存在を確認できました' })
      } else {
        setVerifyResult({ ok: false, message: `❌ 該当ユーザーが見つかりません (status ${res.data?.status})` })
      }
    } catch {
      setVerifyResult({ ok: false, message: '通信エラー' })
    } finally {
      setVerifying(false)
    }
  }

  const save = async () => {
    setError('')
    const username = stripchatUsername.trim()
    if (!username) { setError('Stripchatユーザー名は必須です'); return }
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) { setError('ユーザー名は半角英数・ハイフン・アンダースコアのみ'); return }
    if (ratePercent === 0) { setError('レート計算失敗（組み合わせ確認）'); return }
    // 検証済みでない or 検証NGなら保存ブロック（編集モードはスキップ・既存キャスト確定）
    if (!isEdit && !verifyResult?.ok) {
      setError('Stripchatユーザー名の「確認」ボタンで存在検証してから保存してください')
      return
    }

    // 紹介者の確定値を計算
    let resolvedIntroducerId: string | null = null
    let resolvedIntroducerName: string | null = null
    if (introducerSelect === '__new__') {
      const newId = newIntroducerId.trim()
      if (!newId) { setError('新規紹介者IDを入力してください'); return }
      if (introducers.some((it) => it.id === newId)) {
        setError(`紹介者ID「${newId}」は既に存在します。既存から選択してください`); return
      }
      resolvedIntroducerId = newId
      resolvedIntroducerName = newIntroducerName.trim() || null
    } else if (introducerSelect) {
      const found = introducers.find((it) => it.id === introducerSelect)
      resolvedIntroducerId = introducerSelect
      resolvedIntroducerName = found?.name ?? null
    }

    setSaving(true)
    try {
      const body = {
        lineAccountId,
        stripchatUsername: username,
        displayName: displayName || null,
        channel,
        contractVersion,
        stage,
        ratePercent,
        introducerId: resolvedIntroducerId,
        introducerName: resolvedIntroducerName,
        status,
        joinedAt: joinedAt || null,
        notes: notes || null,
        lineFriendId: lineFriendId || null,
        reminderOffsetMinutes: reminderEnabled ? reminderOffsetMinutes : 0,
      }
      const res = await fetchApi<{ success: boolean; error?: string }>(
        `/api/casts/${encodeURIComponent(username)}`,
        { method: 'PUT', body: JSON.stringify(body) },
      )
      if (!res.success) { setError(res.error ?? '保存に失敗しました'); return }
      onCreated()
      onClose()
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b border-gray-200">
          <div>
            <h3 className="text-base font-semibold text-gray-900">{isEdit ? 'キャスト編集' : 'キャスト追加'}</h3>
            <p className="text-xs text-gray-500 mt-0.5">{isEdit ? `${existingCast?.stripchatUsername}` : 'Stripchatのユーザー名と契約情報を入力'}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Stripchatユーザー名 *</label>
            {isEdit ? (
              <div className="text-sm border border-gray-200 bg-gray-50 rounded px-2 py-1.5 font-mono text-gray-700">
                {stripchatUsername}
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={stripchatUsername}
                    onChange={(e) => { setStripchatUsername(e.target.value); setVerifyResult(null) }}
                    placeholder="例: rin2432"
                    className="flex-1 text-sm border border-gray-300 rounded px-2 py-1.5 font-mono"
                  />
                  <button
                    type="button"
                    onClick={verify}
                    disabled={verifying || !stripchatUsername.trim()}
                    className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  >{verifying ? '...' : '確認'}</button>
                </div>
                {verifyResult && (
                  <p className={`text-[11px] mt-1 ${verifyResult.ok ? 'text-green-600' : 'text-amber-600'}`}>{verifyResult.message}</p>
                )}
                <p className="text-[10px] text-gray-400 mt-1">cast IDとして使われます。後で変更不可</p>
              </>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">表示名（任意）</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="例: りん（本名は入れない）"
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">配信形態</label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as '在宅' | '通勤')}
                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
              >
                <option value="在宅">在宅</option>
                <option value="通勤">通勤</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">契約バージョン</label>
              <select
                value={contractVersion}
                onChange={(e) => setContractVersion(e.target.value as '19' | '19b')}
                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
              >
                <option value="19">19</option>
                <option value="19b">19b</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">ステージ</label>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value as '基本' | '中位' | '最上位')}
                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
              >
                <option value="基本">基本</option>
                <option value="中位">中位</option>
                <option value="最上位">最上位</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">レート（自動）</label>
              <div className="text-sm border border-gray-200 bg-gray-50 rounded px-2 py-1.5 font-semibold text-gray-700">
                {ratePercent}%
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">入店日</label>
              <input
                type="date"
                value={joinedAt}
                onChange={(e) => setJoinedAt(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
              />
            </div>
            {isEdit && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">在籍状態</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as '在籍' | '退所')}
                  className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                >
                  <option value="在籍">在籍</option>
                  <option value="退所">退所</option>
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">紹介者（任意）</label>
            <div className="flex gap-2">
              <select
                value={introducerSelect}
                onChange={(e) => { setIntroducerSelect(e.target.value); setEditingIntroducer(false) }}
                className="flex-1 text-sm border border-gray-300 rounded px-2 py-1.5"
              >
                <option value="">なし</option>
                {introducers.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.id}{it.name ? ` (${it.name})` : ''} — {it.castCount}名
                  </option>
                ))}
                <option value="__new__">+ 新規追加</option>
              </select>
              {introducerSelect && introducerSelect !== '__new__' && (
                <button
                  type="button"
                  onClick={() => {
                    const cur = introducers.find((it) => it.id === introducerSelect)
                    setEditIntroducerName(cur?.name ?? '')
                    setEditingIntroducer(true)
                  }}
                  className="px-2 py-1 text-xs font-medium text-blue-600 bg-white border border-blue-200 rounded hover:bg-blue-50"
                  title="紹介者名を編集"
                >✎</button>
              )}
            </div>
            {introducerSelect === '__new__' && (
              <div className="grid grid-cols-2 gap-2 mt-2 p-2 bg-green-50 border border-green-200 rounded">
                <div>
                  <label className="block text-[10px] font-medium text-gray-600 mb-1">新規ID（次番号 提案済）</label>
                  <input
                    type="text"
                    value={newIntroducerId}
                    onChange={(e) => setNewIntroducerId(e.target.value)}
                    placeholder="INT-003"
                    className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-gray-600 mb-1">紹介者名</label>
                  <input
                    type="text"
                    value={newIntroducerName}
                    onChange={(e) => setNewIntroducerName(e.target.value)}
                    placeholder="松任谷"
                    className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                  />
                </div>
              </div>
            )}
            {editingIntroducer && (
              <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded">
                <p className="text-[10px] font-medium text-gray-600 mb-1">
                  {introducerSelect} の名前を変更（同じ紹介者を持つ全キャストに反映）
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editIntroducerName}
                    onChange={(e) => setEditIntroducerName(e.target.value)}
                    placeholder="新しい紹介者名"
                    className="flex-1 text-sm border border-gray-300 rounded px-2 py-1.5"
                  />
                  <button
                    type="button"
                    onClick={renameIntroducer}
                    disabled={renamingIntroducer}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
                  >{renamingIntroducer ? '...' : '更新'}</button>
                  <button
                    type="button"
                    onClick={() => setEditingIntroducer(false)}
                    disabled={renamingIntroducer}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded hover:bg-gray-50"
                  >キャンセル</button>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">メモ（任意）</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
            />
          </div>

          {/* LINE友だち（本人）紐付け */}
          <div className="border-t border-gray-200 pt-3 mt-2">
            <label className="block text-xs font-semibold text-gray-700 mb-2">👤 LINE友だち（本人）</label>
            <input
              type="text"
              value={friendSearch}
              onChange={(e) => setFriendSearch(e.target.value)}
              placeholder="名前で検索（最低1文字）"
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 mb-1"
            />
            <select
              value={lineFriendId}
              onChange={(e) => setLineFriendId(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
            >
              <option value="">紐付けなし</option>
              {friendsList.map((f) => (
                <option key={f.id} value={f.id}>{f.displayName}</option>
              ))}
            </select>
            <p className="text-[10px] text-gray-400 mt-1">
              ※チャトナビLINE公式アカウントを友だち追加してる本人を選択
            </p>
          </div>

          {/* 配信予定リマインド設定 */}
          <div className="border-t border-gray-200 pt-3 mt-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={reminderEnabled}
                onChange={(e) => setReminderEnabled(e.target.checked)}
                className="w-4 h-4"
              />
              📨 配信予定リマインドを送信する（LINE通知）
            </label>
            {reminderEnabled && (
              <div className="ml-6 space-y-2">
                <div>
                  <label className="block text-[10px] font-medium text-gray-600 mb-1">何分前に送信？</label>
                  <select
                    value={reminderOffsetMinutes}
                    onChange={(e) => setReminderOffsetMinutes(Number(e.target.value))}
                    className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                  >
                    <option value="5">5分前</option>
                    <option value="10">10分前</option>
                    <option value="15">15分前</option>
                    <option value="30">30分前</option>
                    <option value="60">1時間前</option>
                    <option value="120">2時間前</option>
                  </select>
                </div>
                {!lineFriendId && (
                  <p className="text-[10px] text-orange-600">
                    ⚠️ LINE友だち未紐付けのため、リマインドは送信されません。上で紐付けしてください。
                  </p>
                )}
              </div>
            )}
          </div>

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
          >{saving ? '保存中...' : (isEdit ? '保存' : '追加')}</button>
        </div>
      </div>
    </div>
  )
}
