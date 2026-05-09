'use client'

import { useState } from 'react'
import type { Tag } from '@line-crm/shared'
import type { FriendWithTags } from '@/lib/api'
import { api } from '@/lib/api'
import TagBadge from './tag-badge'

interface FriendTableProps {
  friends: FriendWithTags[]
  allTags: Tag[]
  onRefresh: () => void
}

export default function FriendTable({ friends, allTags, onRefresh }: FriendTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [addingTagForFriend, setAddingTagForFriend] = useState<string | null>(null)
  const [selectedTagId, setSelectedTagId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id)
    setAddingTagForFriend(null)
    setSelectedTagId('')
    setError('')
  }

  const handleAddTag = async (friendId: string) => {
    if (!selectedTagId) return
    setLoading(true)
    setError('')
    try {
      await api.friends.addTag(friendId, selectedTagId)
      setAddingTagForFriend(null)
      setSelectedTagId('')
      onRefresh()
    } catch {
      setError('タグの追加に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveTag = async (friendId: string, tagId: string) => {
    setLoading(true)
    setError('')
    try {
      await api.friends.removeTag(friendId, tagId)
      onRefresh()
    } catch {
      setError('タグの削除に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  }

  if (friends.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
        <p className="text-gray-500">友だちが見つかりません</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {error && (
        <div className="px-4 py-3 bg-red-50 border-b border-red-100 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* モバイル: コンパクトカード */}
      <ul className="lg:hidden divide-y divide-gray-100">
        {friends.map((friend) => {
          const isExpanded = expandedId === friend.id
          const isAddingTag = addingTagForFriend === friend.id
          const availableTags = allTags.filter(
            (t) => !friend.tags.some((ft) => ft.id === t.id)
          )
          const refCode = (friend as unknown as { refCode?: string }).refCode
          const entryRouteName = (friend as unknown as { entryRouteName?: string }).entryRouteName
          const entryRouteCategory = (friend as unknown as { entryRouteCategory?: string }).entryRouteCategory
          const categoryEmoji = entryRouteCategory === '広告' ? '📢' : entryRouteCategory === 'リファラル' ? '👥' : entryRouteCategory === 'SNS' ? '🌐' : ''
          return (
            <li key={friend.id}>
              <button
                onClick={() => toggleExpand(friend.id)}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 active:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {friend.pictureUrl ? (
                    <img
                      src={friend.pictureUrl}
                      alt={friend.displayName}
                      className="w-10 h-10 rounded-full object-cover bg-gray-100 shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-medium shrink-0">
                      {friend.displayName?.charAt(0) ?? '?'}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <p className="text-sm font-medium text-gray-900 truncate">{friend.displayName}</p>
                      {!friend.isFollowing && (
                        <span className="shrink-0 text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">ブロック</span>
                      )}
                    </div>
                    {friend.statusMessage && (
                      <p className="text-xs text-gray-400 truncate">{friend.statusMessage}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-1 mt-1">
                      {entryRouteName ? (
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700"
                          title={`登録経路: ${entryRouteCategory ? entryRouteCategory + ' / ' : ''}${entryRouteName}（refCode: ${refCode}）`}
                        >
                          {categoryEmoji} {entryRouteName}
                        </span>
                      ) : refCode ? (
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-700"
                          title="登録経路の定義なし。/entry-routes で登録するとここに表示されます"
                        >
                          {refCode}（未定義）
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-400">登録経路: 不明</span>
                      )}
                      {friend.tags.map((tag) => <TagBadge key={tag.id} tag={tag} />)}
                      <span className="text-[11px] text-gray-400 ml-auto">{formatDate(friend.createdAt)}</span>
                    </div>
                  </div>
                  <svg
                    className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>
              {isExpanded && (
                <div className="px-4 pb-4 bg-gray-50 space-y-3">
                  <div>
                    <p className="text-[10px] font-semibold text-gray-500 mb-1">LINE ユーザーID</p>
                    <p className="text-[11px] text-gray-600 font-mono break-all">{friend.lineUserId}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-gray-500 mb-1">タグ管理</p>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {friend.tags.map((tag) => (
                        <TagBadge
                          key={tag.id}
                          tag={tag}
                          onRemove={() => handleRemoveTag(friend.id, tag.id)}
                        />
                      ))}
                    </div>
                    {isAddingTag ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          className="text-sm border border-gray-300 rounded-md px-2 py-1 flex-1 min-w-[140px]"
                          value={selectedTagId}
                          onChange={(e) => setSelectedTagId(e.target.value)}
                        >
                          <option value="">タグを選択...</option>
                          {availableTags.map((tag) => (
                            <option key={tag.id} value={tag.id}>{tag.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleAddTag(friend.id)}
                          disabled={!selectedTagId || loading}
                          className="px-3 py-1.5 text-xs font-medium rounded-md text-white disabled:opacity-50"
                          style={{ backgroundColor: '#06C755' }}
                        >
                          追加
                        </button>
                        <button
                          onClick={() => { setAddingTagForFriend(null); setSelectedTagId('') }}
                          className="px-3 py-1.5 text-xs font-medium rounded-md text-gray-600 bg-gray-200"
                        >
                          キャンセル
                        </button>
                      </div>
                    ) : (
                      availableTags.length > 0 && (
                        <button
                          onClick={() => setAddingTagForFriend(friend.id)}
                          className="text-xs font-medium text-green-600 flex items-center gap-1"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          タグを追加
                        </button>
                      )
                    )}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {/* デスクトップ: テーブル */}
      <div className="hidden lg:block overflow-x-auto">
      <table className="w-full min-w-[640px]">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
              アイコン / 表示名
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
              ステータス
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
              タグ / 流入
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
              登録日
            </th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {friends.map((friend) => {
            const isExpanded = expandedId === friend.id
            const isAddingTag = addingTagForFriend === friend.id
            const availableTags = allTags.filter(
              (t) => !friend.tags.some((ft) => ft.id === t.id)
            )
            const refCode = (friend as unknown as { refCode?: string }).refCode
            const entryRouteName = (friend as unknown as { entryRouteName?: string }).entryRouteName
            const entryRouteCategory = (friend as unknown as { entryRouteCategory?: string }).entryRouteCategory
            const categoryEmoji = entryRouteCategory === '広告' ? '📢' : entryRouteCategory === 'リファラル' ? '👥' : entryRouteCategory === 'SNS' ? '🌐' : ''

            return (
              <>
                <tr
                  key={friend.id}
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => toggleExpand(friend.id)}
                >
                  {/* Avatar + Name */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {friend.pictureUrl ? (
                        <img
                          src={friend.pictureUrl}
                          alt={friend.displayName}
                          className="w-9 h-9 rounded-full object-cover bg-gray-100"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-medium">
                          {friend.displayName?.charAt(0) ?? '?'}
                        </div>
                      )}
                      <div>
                        <p className="text-sm font-medium text-gray-900">{friend.displayName}</p>
                        {friend.statusMessage && (
                          <p className="text-xs text-gray-400 truncate max-w-[160px]">{friend.statusMessage}</p>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Following status */}
                  <td className="px-4 py-3">
                    {friend.isFollowing ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        フォロー中
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                        ブロック/退会
                      </span>
                    )}
                  </td>

                  {/* Tags + Ref */}
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {entryRouteName ? (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700"
                          title={`refCode: ${refCode}`}
                        >
                          {categoryEmoji} {entryRouteName}
                        </span>
                      ) : refCode ? (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700"
                          title="登録経路の定義なし"
                        >
                          {refCode}
                        </span>
                      ) : null}
                      {friend.tags.length > 0 ? (
                        friend.tags.map((tag) => <TagBadge key={tag.id} tag={tag} />)
                      ) : !refCode ? (
                        <span className="text-xs text-gray-400">なし</span>
                      ) : null}
                    </div>
                  </td>

                  {/* Registered date */}
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {formatDate(friend.createdAt)}
                  </td>

                  {/* Expand indicator */}
                  <td className="px-4 py-3 text-right">
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform inline-block ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </td>
                </tr>

                {/* Expanded detail row */}
                {isExpanded && (
                  <tr key={`${friend.id}-detail`} className="bg-gray-50">
                    <td colSpan={5} className="px-6 py-4">
                      <div className="space-y-3">
                        <div>
                          <p className="text-xs font-semibold text-gray-500 mb-1">LINE ユーザーID</p>
                          <p className="text-xs text-gray-600 font-mono">{friend.lineUserId}</p>
                        </div>

                        {/* Tag management */}
                        <div>
                          <p className="text-xs font-semibold text-gray-500 mb-2">タグ管理</p>
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {friend.tags.map((tag) => (
                              <TagBadge
                                key={tag.id}
                                tag={tag}
                                onRemove={() => handleRemoveTag(friend.id, tag.id)}
                              />
                            ))}
                          </div>

                          {isAddingTag ? (
                            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                              <select
                                className="text-sm border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-green-500"
                                value={selectedTagId}
                                onChange={(e) => setSelectedTagId(e.target.value)}
                              >
                                <option value="">タグを選択...</option>
                                {availableTags.map((tag) => (
                                  <option key={tag.id} value={tag.id}>{tag.name}</option>
                                ))}
                              </select>
                              <button
                                onClick={() => handleAddTag(friend.id)}
                                disabled={!selectedTagId || loading}
                                className="px-3 py-1 text-xs font-medium rounded-md text-white disabled:opacity-50 transition-opacity"
                                style={{ backgroundColor: '#06C755' }}
                              >
                                追加
                              </button>
                              <button
                                onClick={() => { setAddingTagForFriend(null); setSelectedTagId('') }}
                                className="px-3 py-1 text-xs font-medium rounded-md text-gray-600 bg-gray-200 hover:bg-gray-300 transition-colors"
                              >
                                キャンセル
                              </button>
                            </div>
                          ) : (
                            availableTags.length > 0 && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setAddingTagForFriend(friend.id) }}
                                className="text-xs font-medium text-green-600 hover:text-green-700 flex items-center gap-1 transition-colors"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                タグを追加
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            )
          })}
        </tbody>
      </table>
      </div>
    </div>
  )
}
