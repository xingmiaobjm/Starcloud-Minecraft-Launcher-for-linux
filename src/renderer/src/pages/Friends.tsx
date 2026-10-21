/// 好友页：严格按 Win 端 0.3.7 FriendsPage 的 QQ 式两栏交互 ——
/// 左「会话列表」、右「聊天」。好友申请 / 联机邀请是列表顶部的系统会话（点开小窗），
/// 添加好友走左上「+」菜单；邀请联机 / 删除好友在聊天头「⋯」菜单里。
/// 联机板块整页嵌在第二个标签（Win 端把 MultiplayerPage 塞进 SelectorBar 第二项）。
/// 与 Win 的差异：消息实时推送（SSE）这里先用 20s 轮询替代，行为等价、延迟稍高。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { request } from '../bridge'
import type { MultiplayerSnapshot } from '../bridge'
import type {
  ScConversationPage,
  ScFriend,
  ScFriendInvite,
  ScFriendMessage,
  ScFriendRequests,
  ScFriendSearchResult,
  ScSession
} from '../bridge-friends'
import MultiplayerPage from './Multiplayer'
import { EmptyState, InfoBar, Modal, Segmented, Select, useToasts, type ToastKind } from '../ui'
import { IconMore, IconPlus, IconSearch } from '../icons'

// ── 小工具 ──────────────────────────────────────────────────────────────────

const pad = (n: number): string => String(n).padStart(2, '0')

function parseTime(iso: string | undefined): Date | null {
  if (iso === undefined || iso === '') return null
  const t = new Date(iso)
  return Number.isNaN(t.getTime()) ? null : t
}

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate()

/** 会话列表时间：今天只显示时分，昨天显示「昨天」，更早显示日期（Win FormatStamp）。 */
function formatStamp(iso: string | undefined): string {
  const time = parseTime(iso)
  if (time === null) return ''
  const today = new Date()
  if (sameDay(time, today)) return `${pad(time.getHours())}:${pad(time.getMinutes())}`
  const yesterday = new Date(today.getTime() - 86_400_000)
  if (sameDay(time, yesterday)) return '昨天'
  return time.getFullYear() === today.getFullYear()
    ? `${pad(time.getMonth() + 1)}-${pad(time.getDate())}`
    : `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}`
}

/** 聊天区时间分隔：今天「HH:mm」，昨天「昨天 HH:mm」，更早带日期（Win FormatSeparator）。 */
function formatSeparator(time: Date): string {
  const today = new Date()
  const hm = `${pad(time.getHours())}:${pad(time.getMinutes())}`
  if (sameDay(time, today)) return hm
  const yesterday = new Date(today.getTime() - 86_400_000)
  if (sameDay(time, yesterday)) return `昨天 ${hm}`
  return time.getFullYear() === today.getFullYear()
    ? `${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${hm}`
    : `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${hm}`
}

/** 头像首字母（Win InitialOf：展示名首字符，空则回落 ID）。 */
function initialOf(displayName: string, id: string): string {
  const name = displayName.trim() !== '' ? displayName : id
  return name.trim() === '' ? '?' : name.trim()[0].toUpperCase()
}

const previewOf = (last: ScFriendMessage | null | undefined): string =>
  last === null || last === undefined
    ? '还没有消息'
    : last.content.replace(/\r/g, ' ').replace(/\n/g, ' ')

// ── 菜单按钮（Win MenuFlyout 等价：点击弹出，非右键） ────────────────────────

function MenuButton(props: {
  title: string
  items: Array<{ label: string; onSelect: () => void; disabled?: boolean; danger?: boolean }>
}): JSX.Element {
  const [rect, setRect] = useState<{ left: number; top: number } | null>(null)
  const ref = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const open = rect !== null

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (ref.current?.contains(t) === true || popRef.current?.contains(t) === true) return
      setRect(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setRect(null)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const WIDTH = 170
  return (
    <>
      <button
        ref={ref}
        className="btn btn-subtle"
        style={{ width: 34, height: 32, padding: 0, justifyContent: 'center' }}
        title={props.title}
        aria-label={props.title}
        onClick={() => {
          if (open) {
            setRect(null)
            return
          }
          const r = ref.current?.getBoundingClientRect()
          if (r === undefined) return
          // 默认向下弹（Win MenuFlyout 的默认方向）。向上弹会盖进标题栏的
          // app-region: drag 区，真实点击会被拖拽吞掉（"菜单点不了"的坑）。
          const estimated = props.items.length * 32 + 24
          const below = window.innerHeight - r.bottom > estimated + 12
          setRect({
            left: r.right - WIDTH,
            top: below ? r.bottom + 6 : Math.max(56, r.top - estimated - 6)
          })
        }}
      >
        {props.title === '更多操作' ? <IconMore size={14} /> : <IconPlus size={14} />}
      </button>
      {open &&
        rect !== null &&
        createPortal(
          <div
            ref={popRef}
            className="flyout"
            style={{
              position: 'fixed',
              left: Math.max(8, rect.left),
              top: rect.top,
              width: WIDTH,
              zIndex: 900,
              padding: 6,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              background: 'var(--surface-window)'
            }}
          >
            {props.items.map((item) => (
              <button
                key={item.label}
                className={`nav-item${item.danger === true ? ' btn-danger' : ''}`}
                style={{ height: 32, width: '100%', fontSize: 13 }}
                disabled={item.disabled === true}
                onClick={() => {
                  setRect(null)
                  item.onSelect()
                }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}

// ── 系统会话图标（Win 端 friends-request.svg / friends-invite.svg 的等价自绘） ──

function RequestGlyph(): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="10" cy="8" r="3.4" />
      <path d="M4 19.5c0-3 2.7-5 6-5 1.2 0 2.3.25 3.2.7" strokeLinecap="round" />
      <path d="M17.5 13.5v6M14.5 16.5h6" strokeLinecap="round" />
    </svg>
  )
}

function InviteGlyph(): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="7" width="18" height="11" rx="4" />
      <path d="M7.5 11v3M6 12.5h3" strokeLinecap="round" />
      <circle cx="15.5" cy="11.6" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="17.8" cy="13.6" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** 空会话水印（Win 端 chat-empty.svg：两块对话气泡，铺得很淡）。 */
function ChatWatermark(): JSX.Element {
  return (
    <svg width="190" height="190" viewBox="0 0 48 48" fill="currentColor" aria-hidden>
      <path d="M10 8h20a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6H18l-6 5a1 1 0 0 1-1.6-.8V14a6 6 0 0 1-.4-6z" opacity=".55" />
      <path d="M40 18h2a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4h-1v4a1 1 0 0 1-1.7.7L35 37h-9a4 4 0 0 1-4-4v-1h8a8 8 0 0 0 8-8v-6z" opacity=".3" />
    </svg>
  )
}

// ── 页面 ────────────────────────────────────────────────────────────────────

type Section = 'friends' | 'multiplayer'

/** 会话列表行模型（对应 Win ConversationRowModel）。 */
interface Row {
  kind: 'requests' | 'invites' | 'friend'
  userId: string
  name: string
  initial: string
  preview: string
  timeText: string
  unread: number
  sortTime: number
  id?: string
  system?: 'requests' | 'invites'
}

export default function FriendsPage(props: { onGoLogin?: () => void }): JSX.Element {
  const { push, host } = useToasts()
  const [section, setSection] = useState<Section>('friends')

  // 会话与登录态
  const [session, setSession] = useState<ScSession | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [friends, setFriends] = useState<ScFriend[]>([])
  const [lastMessages, setLastMessages] = useState<Record<string, ScFriendMessage | null>>({})
  const [requestCount, setRequestCount] = useState(0)
  const [inviteTotal, setInviteTotal] = useState(0)

  // 聊天
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ScFriendMessage[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [nextBeforeId, setNextBeforeId] = useState<number | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const [filter, setFilter] = useState('')

  // 顶部提示条（Win InfoBar StatusBar）
  const [banner, setBanner] = useState<{ kind: ToastKind; text: string } | null>(null)

  // 小窗
  const [addOpen, setAddOpen] = useState(false)
  const [requestsOpen, setRequestsOpen] = useState(false)
  const [invitesOpen, setInvitesOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)

  const msgsRef = useRef<HTMLDivElement | null>(null)
  /** 下一次消息渲染的滚动意图：end = 滚到底，keep = 保持阅读位置（加载更早时）。 */
  const scrollIntent = useRef<'end' | 'keep'>('end')

  const showBanner = useCallback((kind: ToastKind, text: string): void => {
    setBanner({ kind, text })
  }, [])
  const selectedFriend = useMemo(
    () => friends.find((f) => f.user_id === selectedUserId) ?? null,
    [friends, selectedUserId]
  )

  const refreshCounts = useCallback(async (): Promise<void> => {
    try {
      const data = await request<{ requests: ScFriendRequests }>('friends.requests')
      // 好友申请系统会话只统计别人发来的（发出的申请不在页面展示，也不可撤回）
      setRequestCount(data.requests.incoming.length)
    } catch {
      setRequestCount(0)
    }
    try {
      const data = await request<{ invites: { incoming: ScFriendInvite[]; outgoing: ScFriendInvite[] } }>(
        'friends.invites'
      )
      setInviteTotal(data.invites.incoming.length + data.invites.outgoing.length)
    } catch {
      setInviteTotal(0)
    }
  }, [])

  /** 好友列表不返回最后一条消息：按需补拉（每人 limit=1），拉过就缓存（Win EnsurePreviewsAsync）。 */
  const ensurePreviews = useCallback(async (list: ScFriend[]): Promise<void> => {
    const missing = list.filter((f) => !(f.user_id in lastMessages))
    if (missing.length === 0) return
    const patch: Record<string, ScFriendMessage | null> = {}
    // 并发 4：一条预览失败不拖住整页
    const queue = [...missing]
    await Promise.all(
      Array.from({ length: Math.min(4, queue.length) }, async () => {
        for (let f = queue.shift(); f !== undefined; f = queue.shift()) {
          try {
            const page = await request<ScConversationPage>('friends.conversation', {
              userId: f.user_id,
              limit: 1
            })
            patch[f.user_id] = page.items.at(-1) ?? null
          } catch {
            patch[f.user_id] = null
          }
        }
      })
    )
    setLastMessages((prev) => ({ ...prev, ...patch }))
  }, [lastMessages])

  const refreshFriends = useCallback(async (): Promise<void> => {
    try {
      const data = await request<{ friends: ScFriend[] }>('friends.list')
      setFriends(data.friends)
      await ensurePreviews(data.friends)
    } catch (e) {
      setFriends([])
      showBanner('error', String(e))
    }
  }, [ensurePreviews, showBanner])

  const refreshAll = useCallback(async (): Promise<void> => {
    const state = await request<ScSession>('starcloud.state').catch(() => null)
    setSession(state)
    if (state === null || !state.loggedIn) {
      setLoaded(true)
      return
    }
    await Promise.all([refreshFriends(), refreshCounts()])
    setLoaded(true)
  }, [refreshCounts, refreshFriends])

  useEffect(() => {
    void refreshAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 轮询（替代 Win 端 SSE）：只刷列表与计数，聊天内容在打开会话时拉取
  useEffect(() => {
    if (session === null || !session.loggedIn || section !== 'friends') return
    const timer = window.setInterval(() => {
      void refreshFriends()
      void refreshCounts()
    }, 20_000)
    return () => window.clearInterval(timer)
  }, [session, section, refreshFriends, refreshCounts])

  // ── 聊天区 ──

  const openConversation = useCallback(
    async (userId: string): Promise<void> => {
      setSelectedUserId(userId)
      setMessages([])
      setHasMore(false)
      setNextBeforeId(undefined)
      scrollIntent.current = 'end'
      try {
        const data = await request<{ page: ScConversationPage }>('friends.conversation', {
          userId,
          limit: 100
        })
        if (selectedUserId !== null && selectedUserId !== userId) return // 期间切到了别的会话
        setMessages(data.page.items)
        setHasMore(data.page.has_more)
        setNextBeforeId(data.page.next_before_id)
        const last = data.page.items.at(-1)
        if (last !== undefined) setLastMessages((prev) => ({ ...prev, [userId]: last }))
        await request('friends.markRead', { userId })
        setFriends((prev) => prev.map((f) => (f.user_id === userId ? { ...f, unread: 0 } : f)))
      } catch (e) {
        showBanner('error', String(e))
      }
    },
    [selectedUserId, showBanner]
  )

  useEffect(() => {
    // 消息渲染后按意图滚动
    const el = msgsRef.current
    if (el === null) return
    if (scrollIntent.current === 'end') el.scrollTop = el.scrollHeight
    scrollIntent.current = 'end'
  }, [messages])

  const sendingRef = useRef(false)
  const sendMessage = useCallback(async (): Promise<void> => {
    if (sendingRef.current || selectedUserId === null) return
    const text = draft.trim()
    if (text === '') return
    sendingRef.current = true
    try {
      const data = await request<{ message: ScFriendMessage }>('friends.send', {
        userId: selectedUserId,
        content: text
      })
      setDraft('')
      scrollIntent.current = 'end'
      setMessages((prev) => [...prev, data.message])
      setLastMessages((prev) => ({ ...prev, [selectedUserId]: data.message }))
    } catch (e) {
      showBanner('error', String(e))
    } finally {
      sendingRef.current = false
    }
  }, [draft, selectedUserId, showBanner])

  const loadOlder = useCallback(async (): Promise<void> => {
    if (selectedUserId === null || nextBeforeId === undefined) return
    try {
      const data = await request<{ page: ScConversationPage }>('friends.conversation', {
        userId: selectedUserId,
        beforeId: nextBeforeId,
        limit: 100
      })
      const known = new Set(messages.map((m) => m.id))
      const older = data.page.items.filter((m) => !known.has(m.id))
      scrollIntent.current = 'keep'
      setMessages((prev) => [...older, ...prev])
      setHasMore(data.page.has_more)
      setNextBeforeId(data.page.next_before_id)
    } catch (e) {
      showBanner('error', String(e))
    }
  }, [messages, nextBeforeId, selectedUserId, showBanner])

  const removeFriend = useCallback(
    async (f: ScFriend): Promise<void> => {
      if (!window.confirm(`确定删除好友「${f.display_name}」吗？聊天与邀请记录不会自动清理。`)) return
      try {
        await request('friends.remove', { userId: f.user_id })
        showBanner('success', `已删除好友「${f.display_name}」`)
        setSelectedUserId(null)
        await refreshFriends()
      } catch (e) {
        showBanner('error', String(e))
      }
    },
    [refreshFriends, showBanner]
  )

  // ── 会话列表行 ──

  const rows = useMemo<Array<Row>>(() => {
    const list: Array<Row> = [
      {
        kind: 'requests',
        userId: '',
        name: '好友申请',
        initial: '申',
        preview: requestCount > 0 ? `${requestCount} 条待处理` : '没有新的申请',
        timeText: '',
        unread: 0,
        sortTime: Number.MAX_SAFE_INTEGER,
        system: 'requests'
      },
      {
        kind: 'invites',
        userId: '',
        name: '联机邀请',
        initial: '邀',
        preview: inviteTotal > 0 ? `${inviteTotal} 个待处理` : '没有新的邀请',
        timeText: '',
        unread: inviteTotal,
        sortTime: Number.MAX_SAFE_INTEGER,
        system: 'invites'
      }
    ]
    for (const f of friends) {
      const last = lastMessages[f.user_id]
      list.push({
        kind: 'friend',
        userId: f.user_id,
        name: f.display_name,
        initial: initialOf(f.display_name, f.id),
        preview: previewOf(last),
        timeText: formatStamp(last?.created_at),
        unread: Math.max(f.unread, 0),
        sortTime: parseTime(last?.created_at)?.getTime() ?? 0,
        id: f.id
      })
    }
    const kw = filter.trim().toLowerCase()
    const filtered =
      kw === ''
        ? list
        : list.filter(
            (r) =>
              r.name.toLowerCase().includes(kw) || (r.id ?? '').toLowerCase().includes(kw)
          )
    const system = filtered.filter((r) => r.system !== undefined)
    const personRows = filtered
      .filter((r) => r.system === undefined)
      .sort((a, b) => b.sortTime - a.sortTime || a.name.localeCompare(b.name, 'zh'))
    return [...system, ...personRows]
  }, [friends, filter, inviteTotal, lastMessages, requestCount])

  // ── 弹窗子组件的状态放外面，页面重挂载不丢 ──

  const openRequestsDialog = useCallback((): void => {
    setBanner(null)
    setRequestsOpen(true)
  }, [])
  const openInvitesDialog = useCallback((): void => {
    setBanner(null)
    setInvitesOpen(true)
  }, [])

  /** 接受邀请后的进房（Win JoinAcceptedInviteAsync）。 */
  const joinAcceptedInvite = useCallback(
    async (invite: ScFriendInvite): Promise<void> => {
      const room = invite.room_code ?? ''
      if (room !== '') {
        try {
          await request('multiplayer.join', { room })
          setSection('multiplayer')
          push('success', '正在连接房间…进入游戏后到「多人游戏」即可看到对方世界。')
        } catch (e) {
          push('error', `已接受邀请，但自动进房失败：${String(e)}。可到联机页手动粘贴邀请码。`)
        }
        return
      }
      try {
        await navigator.clipboard.writeText(invite.connectionText)
        push('success', `已接受邀请。地址 ${invite.connectionText} 已复制，进游戏「多人游戏 → 直接连接」粘贴即可。`)
      } catch {
        push('info', `已接受邀请。地址 ${invite.connectionText}，进游戏「多人游戏 → 直接连接」粘贴即可。`)
      }
    },
    [push]
  )

  // ── 渲染 ──

  if (!loaded) {
    return (
      <div className="page" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <span className="spinner spinner-lg" />
        {host}
      </div>
    )
  }

  return (
    <div className="page" style={{ maxWidth: 1500, height: '100%' }}>
      {banner !== null && (
        <div style={{ marginBottom: 12 }}>
          <InfoBar kind={banner.kind} onDismiss={() => setBanner(null)}>
            {banner.text}
          </InfoBar>
        </div>
      )}

      {/* 好友 / 联机 两个板块同页：导航栏不再单列「联机」（Win 0.3.7 起并入好友页） */}
      <div style={{ marginBottom: 12, width: 260 }}>
        <Segmented<Section>
          value={section}
          options={[
            { value: 'friends', label: '好友' },
            { value: 'multiplayer', label: '联机' }
          ]}
          onChange={setSection}
        />
      </div>

      {section === 'multiplayer' ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <MultiplayerPage />
        </div>
      ) : session === null || !session.loggedIn ? (
        <div className="card" style={{ alignSelf: 'flex-start', width: '100%' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ width: 4, height: 18, borderRadius: 2, background: 'var(--accent)' }} />
            <span className="t-strong" style={{ fontSize: 16 }}>好友</span>
          </div>
          <div className="t-cap" style={{ marginBottom: 12 }}>
            登录 Starcloud ID 后即可添加好友、聊天和接收联机邀请。
          </div>
          <button className="btn btn-primary" style={{ fontWeight: 600 }} onClick={props.onGoLogin}>
            去登录
          </button>
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: '300px 1fr',
            gap: 12
          }}
        >
          {/* 左：会话列表 */}
          <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: 6, padding: '12px 10px 6px 12px' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <span style={{ position: 'absolute', left: 9, top: 8.5, opacity: 0.55, display: 'flex' }}>
                  <IconSearch size={15} />
                </span>
                <input
                  className="input"
                  placeholder="搜索好友"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  style={{ paddingLeft: 30 }}
                />
              </div>
              <MenuButton
                title="添加"
                items={[
                  { label: '添加好友', onSelect: () => setAddOpen(true) },
                  { label: '好友申请', onSelect: openRequestsDialog },
                  { label: '联机邀请', onSelect: openInvitesDialog }
                ]}
              />
            </div>
            <div className="t-cap" style={{ margin: '0 14px 4px' }}>
              {friends.length === 0 ? '' : `${friends.length} 位好友`}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 4px 6px', position: 'relative' }}>
              {rows.map((r) => (
                <button
                  key={`${r.kind}:${r.userId}`}
                  className={`fr-row${r.userId !== '' && r.userId === selectedUserId ? ' fr-row-active' : ''}`}
                  onClick={() => {
                    if (r.system === 'requests') openRequestsDialog()
                    else if (r.system === 'invites') openInvitesDialog()
                    else void openConversation(r.userId)
                  }}
                >
                  <span className="fr-avatar">
                    {r.system === 'requests' ? (
                      <RequestGlyph />
                    ) : r.system === 'invites' ? (
                      <InviteGlyph />
                    ) : (
                      r.initial
                    )}
                  </span>
                  <span style={{ minWidth: 0, textAlign: 'left' }}>
                    <span className="fr-name truncate" style={{ display: 'block' }}>{r.name}</span>
                    <span className="fr-preview truncate" style={{ display: 'block' }}>{r.preview}</span>
                  </span>
                  <span className="fr-meta">
                    <span className="fr-time">{r.timeText}</span>
                    {r.unread > 0 && (
                      <span className="fr-badge">{r.unread > 99 ? '99+' : r.unread}</span>
                    )}
                  </span>
                </button>
              ))}
              {friends.length === 0 && (
                <div className="t-cap" style={{ margin: '10px 10px 12px', position: 'sticky', bottom: 0 }}>
                  还没有好友。点左上「+ → 添加好友」搜索对方的 Starcloud ID。
                </div>
              )}
            </div>
          </div>

          {/* 右：聊天 */}
          <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            {selectedFriend === null ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}>
                <span style={{ opacity: 0.12 }}>
                  <ChatWatermark />
                </span>
              </div>
            ) : (
              <>
                <div className="fr-chat-head">
                  <span className="fr-avatar">{initialOf(selectedFriend.display_name, selectedFriend.id)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="t-strong truncate">{selectedFriend.display_name}</div>
                    <div className="t-cap truncate">{selectedFriend.id}</div>
                  </div>
                  <MenuButton
                    title="更多操作"
                    items={[
                      { label: '加载更早的消息', onSelect: () => void loadOlder(), disabled: !hasMore },
                      { label: '邀请联机', onSelect: () => setInviteOpen(true) },
                      {
                        label: '删除好友',
                        danger: true,
                        onSelect: () => void removeFriend(selectedFriend)
                      }
                    ]}
                  />
                </div>

                <div className="fr-msgs" ref={msgsRef}>
                  <ChatRows
                    messages={messages}
                    meId={session?.userId ?? ''}
                    myInitial={initialOf(session?.displayName ?? '', session?.userId ?? '')}
                    friendInitial={initialOf(selectedFriend.display_name, selectedFriend.id)}
                  />
                </div>

                <div className="fr-composer">
                  <textarea
                    className="input"
                    style={{ minHeight: 36, maxHeight: 110, height: 36, resize: 'none', paddingTop: 7.5 }}
                    placeholder="输入消息，Enter 发送，Shift+Enter 换行"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void sendMessage()
                      }
                    }}
                  />
                  <button
                    className="btn btn-primary"
                    style={{ height: 36, padding: '0 18px', fontWeight: 600 }}
                    onClick={() => void sendMessage()}
                  >
                    发送
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── 小窗 ── */}
      <AddFriendDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSent={() => void refreshCounts()}
      />
      <RequestsDialog
        open={requestsOpen}
        onClose={() => setRequestsOpen(false)}
        onChanged={() => {
          void refreshFriends()
          void refreshCounts()
        }}
      />
      <InvitesDialog
        open={invitesOpen}
        onClose={() => setInvitesOpen(false)}
        onAccepted={(invite) => {
          setInvitesOpen(false)
          void refreshCounts()
          void joinAcceptedInvite(invite)
        }}
        onChanged={() => void refreshCounts()}
      />
      <InviteFriendDialog
        open={inviteOpen}
        friends={friends}
        presetUserId={selectedUserId}
        onClose={() => setInviteOpen(false)}
        onSent={(msg) => {
          showBanner('success', msg)
          void refreshCounts()
        }}
      />
      {host}
    </div>
  )
}

// ── 聊天消息渲染（QQ 习惯：自己靠右、对方靠左，头像在气泡外侧，>5 分钟插时间） ──

function ChatRows(props: {
  messages: ScFriendMessage[]
  meId: string
  myInitial: string
  friendInitial: string
}): JSX.Element {
  const nodes: JSX.Element[] = []
  let previous: Date | null = null
  props.messages.forEach((m, i) => {
    const time = parseTime(m.created_at)
    if (time !== null && (previous === null || time.getTime() - previous.getTime() > 5 * 60_000)) {
      nodes.push(
        <div key={`t${m.id}`} className="fr-time-sep">
          {formatSeparator(time)}
        </div>
      )
    }
    if (time !== null) previous = time
    const mine = m.from_user_id === props.meId
    nodes.push(
      <div key={m.id} className={`fr-msg${mine ? ' fr-msg-mine' : ''}`}>
        <span className="fr-avatar fr-avatar-sm">{mine ? props.myInitial : props.friendInitial}</span>
        <span className={`fr-bubble${mine ? ' fr-bubble-mine' : ''}`}>{m.content}</span>
      </div>
    )
  })
  return <>{nodes}</>
}

// ── 添加好友（Win FriendsDialogs.AddFriendAsync） ────────────────────────────

function AddFriendDialog(props: {
  open: boolean
  onClose: () => void
  onSent: () => void
}): JSX.Element | null {
  const [query, setQuery] = useState('')
  const [hint, setHint] = useState('输入对方的 Starcloud ID 或昵称。')
  const [results, setResults] = useState<ScFriendSearchResult[] | null>(null)
  const [notice, setNotice] = useState<{ kind: ToastKind; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const sentRef = useRef(false)

  const doSearch = useCallback(async (): Promise<void> => {
    const q = query.trim()
    if (q === '') {
      setHint('输入对方的 Starcloud ID 或昵称。')
      return
    }
    setHint('搜索中…')
    setResults(null)
    try {
      const data = await request<{ results: ScFriendSearchResult[] }>('friends.search', { query: q })
      if (data.results.length === 0) {
        setResults([])
        setHint('没有找到匹配的用户。')
        return
      }
      setHint('')
      setResults(data.results)
    } catch (e) {
      setHint(String(e))
    }
  }, [query])

  const add = useCallback(
    async (u: ScFriendSearchResult): Promise<void> => {
      setBusy(true)
      try {
        await request('friends.sendRequest', { target: u.user_id })
        sentRef.current = true
        setResults((prev) =>
          prev === null ? prev : prev.map((r) => (r.user_id === u.user_id ? { ...r, relation: 'outgoing' } : r))
        )
        setNotice({ kind: 'success', text: '好友申请已发送，等待对方同意后即可开始聊天。' })
      } catch (e) {
        setNotice({ kind: 'error', text: `操作失败：${String(e)}` })
      }
      setBusy(false)
    },
    []
  )

  const close = useCallback((): void => {
    if (sentRef.current) props.onSent()
    sentRef.current = false
    setQuery('')
    setResults(null)
    setHint('输入对方的 Starcloud ID 或昵称。')
    setNotice(null)
    props.onClose()
  }, [props])

  return (
    <Modal
      open={props.open}
      title="添加好友"
      onClose={close}
      width={460}
      footer={
        <button className="btn" onClick={close}>
          关闭
        </button>
      }
    >
      {notice !== null && (
        <div style={{ marginBottom: 10 }}>
          <InfoBar kind={notice.kind} onDismiss={() => setNotice(null)}>
            {notice.text}
          </InfoBar>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="Starcloud ID 或昵称"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void doSearch()
          }}
        />
        <button className="btn btn-primary" style={{ padding: '0 14px' }} onClick={() => void doSearch()}>
          搜索
        </button>
      </div>
      {hint !== '' && (
        <div className="t-cap" style={{ margin: '8px 0' }}>
          {hint}
        </div>
      )}
      <div style={{ minHeight: 140, maxHeight: 360, overflowY: 'auto' }}>
        {(results ?? []).map((u) => (
          <div key={u.user_id} className="fr-dialog-row">
            <span className="fr-avatar fr-avatar-sm">{initialOf(u.display_name, u.id)}</span>
            <span style={{ minWidth: 0 }}>
              <span className="t-strong truncate" style={{ display: 'block', fontSize: 13 }}>
                {u.display_name}
              </span>
              <span className="t-cap truncate" style={{ display: 'block' }}>{u.id}</span>
            </span>
            {u.relation !== 'none' && (
              <span className="t-cap">
                {u.relation === 'friend'
                  ? '已是好友'
                  : u.relation === 'outgoing'
                    ? '已申请'
                    : u.relation === 'incoming'
                      ? '待你处理'
                      : ''}
              </span>
            )}
            {u.relation === 'none' && (
              <button
                className="btn"
                style={{ height: 28, padding: '0 10px' }}
                disabled={busy}
                onClick={() => void add(u)}
              >
                添加
              </button>
            )}
          </div>
        ))}
      </div>
    </Modal>
  )
}

// ── 好友申请（Win FriendsDialogs.RequestsAsync：只列别人发来的） ──────────────

function RequestsDialog(props: {
  open: boolean
  onClose: () => void
  onChanged: () => void
}): JSX.Element | null {
  const [incoming, setIncoming] = useState<ScFriendRequests['incoming'] | null>(null)
  const [error, setError] = useState('')

  const reload = useCallback(async (): Promise<void> => {
    setError('')
    try {
      const data = await request<{ requests: ScFriendRequests }>('friends.requests')
      setIncoming(data.requests.incoming)
    } catch (e) {
      setIncoming([])
      setError(String(e))
    }
  }, [])

  useEffect(() => {
    if (props.open) void reload()
  }, [props.open, reload])

  const act = useCallback(
    async (fn: () => Promise<unknown>): Promise<void> => {
      try {
        await fn()
        props.onChanged()
        await reload()
      } catch {
        // 失败保留列表，用户可再点一次
      }
    },
    [props, reload]
  )

  return (
    <Modal
      open={props.open}
      title="好友申请"
      onClose={props.onClose}
      width={460}
      footer={
        <button className="btn" onClick={props.onClose}>
          关闭
        </button>
      }
    >
      <div style={{ minHeight: 170, maxHeight: 420, overflowY: 'auto' }}>
        {error !== '' ? (
          <div style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</div>
        ) : incoming !== null && incoming.length === 0 ? (
          <EmptyState title="暂时没有新的好友申请" hint="对方通过 Starcloud ID 找到你并发送申请后，会出现在这里。" />
        ) : (
          (incoming ?? []).map((r) => (
            <div key={r.request_id} className="fr-dialog-row">
              <span className="fr-avatar fr-avatar-sm">{initialOf(r.user.display_name, r.user.id)}</span>
              <span style={{ minWidth: 0 }}>
                <span className="t-strong truncate" style={{ display: 'block', fontSize: 13 }}>
                  {r.user.display_name}
                </span>
                <span className="t-cap" style={{ display: 'block', whiteSpace: 'normal' }}>
                  {r.message !== undefined && r.message !== '' ? r.message : '请求添加你为好友'}
                </span>
              </span>
              <button
                className="btn btn-primary"
                style={{ height: 28, padding: '0 10px', fontWeight: 500 }}
                onClick={() => void act(() => request('friends.acceptRequest', { requestId: r.request_id }))}
              >
                同意
              </button>
              <button
                className="btn"
                style={{ height: 28, padding: '0 10px' }}
                onClick={() => void act(() => request('friends.rejectRequest', { requestId: r.request_id }))}
              >
                拒绝
              </button>
            </div>
          ))
        )}
      </div>
    </Modal>
  )
}

// ── 联机邀请（Win FriendsDialogs.InvitesAsync：接受后关窗交给页面进房） ────────

function InvitesDialog(props: {
  open: boolean
  onClose: () => void
  onAccepted: (invite: ScFriendInvite) => void
  onChanged: () => void
}): JSX.Element | null {
  const [invites, setInvites] = useState<{ incoming: ScFriendInvite[]; outgoing: ScFriendInvite[] } | null>(
    null
  )
  const [error, setError] = useState('')

  const reload = useCallback(async (): Promise<void> => {
    setError('')
    try {
      const data = await request<{
        invites: { incoming: ScFriendInvite[]; outgoing: ScFriendInvite[] }
      }>('friends.invites')
      setInvites(data.invites)
    } catch (e) {
      setInvites({ incoming: [], outgoing: [] })
      setError(String(e))
    }
  }, [])

  useEffect(() => {
    if (props.open) void reload()
  }, [props.open, reload])

  const act = useCallback(
    async (fn: () => Promise<unknown>): Promise<void> => {
      try {
        await fn()
        props.onChanged()
        await reload()
      } catch {
        // 失败保留列表
      }
    },
    [props, reload]
  )

  const row = (invite: ScFriendInvite, incoming: boolean): JSX.Element => (
    <div key={invite.invite_id} className="fr-dialog-row">
      <span className="fr-avatar fr-avatar-sm">{initialOf(invite.user.display_name, invite.user.id)}</span>
      <span style={{ minWidth: 0 }}>
        <span className="t-strong truncate" style={{ display: 'block', fontSize: 13 }}>
          {incoming ? `${invite.user.display_name} 邀请你联机` : `已邀请 ${invite.user.display_name}`}
        </span>
        <span className="t-cap truncate" style={{ display: 'block', fontFamily: 'var(--font-mono)' }}>
          {invite.connectionText}
        </span>
        {invite.message !== undefined && invite.message !== '' && (
          <span className="t-cap" style={{ display: 'block', whiteSpace: 'normal' }}>
            {invite.message}
          </span>
        )}
      </span>
      {incoming ? (
        <>
          <button
            className="btn btn-primary"
            style={{ height: 28, padding: '0 10px', fontWeight: 500 }}
            onClick={() => {
              void request('friends.acceptInvite', { inviteId: invite.invite_id })
                .then(() => props.onAccepted(invite))
                .catch(() => void reload())
            }}
          >
            接受
          </button>
          <button
            className="btn"
            style={{ height: 28, padding: '0 10px' }}
            onClick={() => void act(() => request('friends.declineInvite', { inviteId: invite.invite_id }))}
          >
            拒绝
          </button>
        </>
      ) : (
        <>
          <span />
          <button
            className="btn"
            style={{ height: 28, padding: '0 10px' }}
            onClick={() => void act(() => request('friends.cancelInvite', { inviteId: invite.invite_id }))}
          >
            撤回
          </button>
        </>
      )}
    </div>
  )

  return (
    <Modal
      open={props.open}
      title="联机邀请"
      onClose={props.onClose}
      width={480}
      footer={
        <button className="btn" onClick={props.onClose}>
          关闭
        </button>
      }
    >
      <div style={{ minHeight: 170, maxHeight: 420, overflowY: 'auto' }}>
        {error !== '' ? (
          <div style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</div>
        ) : invites !== null && invites.incoming.length + invites.outgoing.length === 0 ? (
          <EmptyState title="暂时没有新的联机邀请" hint="好友邀请你联机后，会出现在这里。" />
        ) : (
          <>
            {(invites?.incoming ?? []).map((i) => row(i, true))}
            {(invites?.outgoing ?? []).map((i) => row(i, false))}
          </>
        )}
      </div>
    </Modal>
  )
}

// ── 邀请好友联机（Win InviteFriendDialog：房间码 / 地址端口至少一项） ──────────

function InviteFriendDialog(props: {
  open: boolean
  friends: ScFriend[]
  presetUserId: string | null
  onClose: () => void
  onSent: (message: string) => void
}): JSX.Element | null {
  const [userId, setUserId] = useState<string>('')
  const [room, setRoom] = useState('')
  const [address, setAddress] = useState('')
  const [port, setPort] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // 打开时预填：选中好友 + 当前陶瓦房间码（Win 端先 RefreshAsync 拿最新房间）
  useEffect(() => {
    if (!props.open) return
    setError('')
    setBusy(false)
    setUserId(props.presetUserId ?? props.friends[0]?.user_id ?? '')
    setAddress('')
    setPort('')
    setMessage('')
    void request<MultiplayerSnapshot>('multiplayer.state')
      .then((snap) => setRoom(snap.state.room ?? ''))
      .catch(() => setRoom(''))
  }, [props.open, props.presetUserId, props.friends])

  const options = useMemo(
    () =>
      props.friends.map((f) => ({
        value: f.user_id,
        label: `${f.display_name}（${f.id}）`
      })),
    [props.friends]
  )

  if (props.friends.length === 0) {
    return (
      <Modal
        open={props.open}
        title="邀请好友联机"
        onClose={props.onClose}
        width={420}
        footer={
          <button className="btn btn-primary" onClick={props.onClose}>
            知道了
          </button>
        }
      >
        还没有好友。先在「添加好友」里搜索对方的 Starcloud ID。
      </Modal>
    )
  }

  const submit = async (): Promise<void> => {
    const roomText = room.trim()
    const addr = address.trim()
    const portText = port.trim()
    let portNum: number | null = null
    if (portText !== '') {
      const n = Number(portText)
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        setError('端口需为 1-65535 的整数')
        return
      }
      portNum = n
    }
    if (roomText === '' && addr === '') {
      setError('请填写陶瓦邀请码，或直连地址')
      return
    }
    if (userId === '') {
      setError('请选择要邀请的好友')
      return
    }
    setBusy(true)
    try {
      await request('friends.createInvite', {
        userId,
        address: addr === '' ? undefined : addr,
        port: portNum === null ? undefined : portNum,
        roomCode: roomText === '' ? undefined : roomText,
        message: message.trim() === '' ? undefined : message.trim()
      })
      props.onSent('联机邀请已发送，对方接受后即可加入。')
      props.onClose()
    } catch (e) {
      setError(String(e))
    }
    setBusy(false)
  }

  return (
    <Modal
      open={props.open}
      title="邀请好友联机"
      onClose={props.onClose}
      width={460}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            取消
          </button>
          <button className="btn btn-primary" style={{ fontWeight: 600 }} disabled={busy} onClick={() => void submit()}>
            发送邀请
          </button>
        </>
      }
    >
      <div className="t-cap" style={{ marginBottom: 10 }}>
        房间码与地址端口至少填一项；邀请 10 分钟内有效。
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', alignItems: 'center' }}>
        <label className="t-cap" style={{ fontSize: 12 }}>好友</label>
        <Select
          value={userId === '' ? (options[0]?.value ?? '') : userId}
          options={options}
          onChange={setUserId}
        />
        <label className="t-cap" style={{ fontSize: 12 }}>陶瓦邀请码</label>
        <input
          className="input"
          placeholder="陶瓦联机邀请码（如 U/XXXX-XXXX-XXXX-XXXX）"
          value={room}
          onChange={(e) => setRoom(e.target.value)}
        />
        <label className="t-cap" style={{ fontSize: 12 }}>直连地址</label>
        <input
          className="input"
          placeholder="直连地址（可选，如 example.com 或 1.2.3.4）"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <label className="t-cap" style={{ fontSize: 12 }}>端口</label>
        <input
          className="input"
          placeholder="端口（可选，如 25565）"
          maxLength={5}
          value={port}
          onChange={(e) => setPort(e.target.value)}
        />
        <label className="t-cap" style={{ fontSize: 12 }}>留言</label>
        <textarea
          className="input"
          style={{ height: 64, minHeight: 64, resize: 'none' }}
          placeholder="留言（可选，最多 100 字）"
          maxLength={100}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>
      {error !== '' && (
        <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{error}</div>
      )}
    </Modal>
  )
}
