/// 首页：左「已安装版本」卡 + 右「账户 / 启动」卡 + 底「运行日志」。
/// 规格对齐 Win 端 HomePage.xaml：
/// · 左栏 Grid "* / 360"，四行 = 启动自检 → 插件挂载 → 首页卡片 → 版本列表卡
/// · 版本行 Grid "Auto / 260px 1fr auto"：32px 方块图标 + 名称(260) + 芯片 + 两行数据列
/// · 版本行右键菜单（Win 02 §2.1）：启动 / 打开详细信息 / 三个文件夹入口 · 置顶收藏 · 删除此版本
/// · 启动按钮状态机（Win 02 §2.4）：启动游戏 / 启动中（禁用）/ 停止游戏（运行中可点）
/// · 卡头视图切换 + 行尾置顶/收藏双图标（Win 02 §2.2）
/// · 右栏：正版/外置/离线 三段滑动指示器 + 头像 + 品牌黄大启动按钮（右侧下拉段）
import { useEffect, useState } from 'react'

import { request } from '../bridge'
import type { AccountList, GameAccount, InstalledVersion } from '../bridge'
import type { GameSessionApi } from '../state/session'
import { Modal, Segmented, useContextMenu, useToasts } from '../ui'
import grassIcon from '../assets/mc-icons/natural_grass_block.png'
import amethystIcon from '../assets/mc-icons/block_of_amethyst.png'
import cobbleIcon from '../assets/mc-icons/masonry_cobblestone.png'
import dirtIcon from '../assets/mc-icons/natural_dirt.png'
import neoforgeIcon from '../assets/mc-icons/neoforge.png'
import forgeIcon from '../assets/mc-icons/forge.png'
import fabricIcon from '../assets/mc-icons/fabric.png'
import quiltIcon from '../assets/mc-icons/quilt.png'
import { IconRefresh, IconChevronUp, IconChevronDown, IconPlay, IconUser, IconClose } from '../icons'


type Mode = 'microsoft' | 'external' | 'offline'

const MODE_LABEL: Record<Mode, string> = {
  microsoft: '正版',
  external: '外置',
  offline: '离线'
}

/** 无账户时通栏就地登录按钮文案（Win 02 §2.5 NoAccountBtn，按模式三态）。 */
const NO_ACCOUNT_LABEL: Record<Mode, string> = {
  microsoft: '登录微软账户',
  external: '登录第三方账户',
  offline: '添加离线账户'
}

/**
 * 版本行图标（对齐 Win 端 VersionRowHelpers）：
 * 加载器图标优先（neoforge/forge/fabric/quilt），原版按版本类型
 * （正式版草方块 / 快照紫水晶 / 远古版圆石与泥土）。
 * 图标文件与 Win 端同一套 MC-Icons 素材。
 */
const LOADER_ICONS: Record<string, string> = {
  neoforge: neoforgeIcon,
  forge: forgeIcon,
  fabric: fabricIcon,
  quilt: quiltIcon
}
const TYPE_ICONS: Record<string, string> = {
  release: grassIcon,
  snapshot: amethystIcon,
  old_beta: cobbleIcon,
  old_alpha: dirtIcon
}

// ── 行尾标记图标（Win 02 §1.4：置顶 E909 实心图钉 / 收藏 EC4D 圆角五角星；
// icons.tsx 没有这两枚，这里内联小 SVG，风格与 FontIcon 近似） ──

function IconPinGlyph(props: { size?: number }): JSX.Element {
  const s = props.size ?? 14
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M14.2 2.5a1.3 1.3 0 0 1 1.3 1.3v1.6l-.3 1.2 3.1 3.1c.5.5.15 1.4-.57 1.4h-4.4l-.45 6.6a1.15 1.15 0 0 1-2.3 0l-.45-6.6H5.77c-.72 0-1.07-.9-.57-1.4l3.1-3.1-.3-1.2V3.8a1.3 1.3 0 0 1 1.3-1.3h5.2z" />
      <path d="M11.4 18.2h1.2l.2 3a.8.8 0 0 1-1.6 0l.2-3z" />
    </svg>
  )
}

function IconStarGlyph(props: { size?: number }): JSX.Element {
  const s = props.size ?? 14
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.6l2.77 5.9 6.28.83-4.6 4.42 1.18 6.25L12 16.98l-5.63 3.02 1.18-6.25-4.6-4.42 6.28-.83L12 2.6z" />
    </svg>
  )
}

/** 停止轮廓（Win 02 §2.4 运行中「停止游戏」的停止轮廓 Path）。 */
function IconStopGlyph(props: { size?: number }): JSX.Element {
  const s = props.size ?? 15
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <rect x={5.5} y={5.5} width={13} height={13} rx={2} />
    </svg>
  )
}

function iconFor(version: { id: string; loader?: string; type?: string }): string {
  const loader = version.loader ?? ''
  if (loader !== '' && LOADER_ICONS[loader] !== undefined) return LOADER_ICONS[loader]
  const lower = version.id.toLowerCase()
  if (lower.includes('neoforge')) return neoforgeIcon
  if (lower.includes('forge')) return forgeIcon
  if (lower.includes('fabric')) return fabricIcon
  if (lower.includes('quilt')) return quiltIcon
  const type = version.type ?? (lower.includes('-rc') || lower.includes('-pre') ? 'snapshot' : 'release')
  return TYPE_ICONS[type] ?? grassIcon
}

/** 类型标签（对齐 Win 端 DetectKind）：加载器优先，否则版本类型。 */
function tagFor(version: { id: string; loader?: string; type?: string }): string {
  const loader = version.loader ?? ''
  const LOADER_LABEL: Record<string, string> = {
    neoforge: 'NeoForge',
    forge: 'Forge',
    fabric: 'Fabric',
    quilt: 'Quilt'
  }
  if (loader !== '' && LOADER_LABEL[loader] !== undefined) return LOADER_LABEL[loader]
  const lower = version.id.toLowerCase()
  if (lower.includes('neoforge')) return 'NeoForge'
  if (lower.includes('fabric')) return 'Fabric'
  if (lower.includes('quilt')) return 'Quilt'
  if (lower.includes('forge')) return 'Forge'
  const type = version.type ?? (lower.includes('-rc') || lower.includes('-pre') ? 'snapshot' : 'release')
  const TYPE_LABEL: Record<string, string> = {
    release: '正式版',
    snapshot: '快照版',
    old_beta: '远古 Beta',
    old_alpha: '远古 Alpha'
  }
  return TYPE_LABEL[type] ?? '正式版'
}

/** 上次启动文案（对齐 Win 端 FormatLastPlayed）：
 *  今天 HH:mm / 昨天 HH:mm / N 天前 / N 个月前 / yyyy-MM-dd */
function lastPlayed(iso?: string): string {
  if (iso === undefined || iso === null || iso === '') return '从未启动'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '从未启动'
  const pad = (n: number): string => n.toString().padStart(2, '0')
  const hm = pad(d.getHours()) + ':' + pad(d.getMinutes())
  const today = new Date()
  const dayDiff = Math.floor(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86400000
  )
  if (dayDiff <= 0) return '今天 ' + hm
  if (dayDiff === 1) return '昨天 ' + hm
  if (dayDiff < 30) return dayDiff + ' 天前'
  if (dayDiff < 365) return Math.floor(dayDiff / 30) + ' 个月前'
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

/** 排序对齐 Win 0.4.0：置顶 → 收藏 → 默认版本 → id 倒序（忽略大小写）。 */
function sortVersions(list: InstalledVersion[]): InstalledVersion[] {
  return [...list].sort((a, b) => {
    const ap = a.pinned === true ? 1 : 0
    const bp = b.pinned === true ? 1 : 0
    if (ap !== bp) return bp - ap
    const af = a.favorite === true ? 1 : 0
    const bf = b.favorite === true ? 1 : 0
    if (af !== bf) return bf - af
    const aLast = a.isDefault === true ? 1 : 0
    const bLast = b.isDefault === true ? 1 : 0
    if (aLast !== bLast) return bLast - aLast
    const ai = a.id.toLowerCase()
    const bi = b.id.toLowerCase()
    return ai < bi ? 1 : ai > bi ? -1 : 0
  })
}

/** 游玩时长文案（累计秒数 → X 小时 / Y 分钟；不足 1 分钟不显示）。 */
function fmtPlay(seconds?: number): string | null {
  if (seconds === undefined || seconds < 60) return null
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
}

function fmtSize(bytes: number): string {
  if (!bytes) return '未完成'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function HomePage(props: {
  session: GameSessionApi
  /** 跳转：点未就绪的自检项 / 空态引导 / 右键菜单都用它。 */
  onNavigate: (page: 'versions' | 'nova' | 'settings' | 'download' | 'accounts') => void
}): JSX.Element {
  const session = props.session
  const { push, host } = useToasts()
  const [installed, setInstalled] = useState<InstalledVersion[]>([])
  const [accounts, setAccounts] = useState<GameAccount[]>([])
  const [selected, setSelected] = useState<string | undefined>()
  const [mode, setMode] = useState<Mode>('offline')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [gameDir, setGameDir] = useState('')
  const [avatarFailed, setAvatarFailed] = useState(false)
  /** 主页版本列表内容（Win 0.4.x：installed / favorites / pinned，设置 → 主页版本列表） */
  const [cardMode, setCardMode] = useState<'installed' | 'favorites' | 'pinned'>('installed')
  /** 右键菜单当前指向的版本（置顶/收藏按它切换，与 Win VersionMenu_Opening 同口径） */
  const [menuRow, setMenuRow] = useState<string | undefined>()
  /** 停止游戏确认弹窗（Win RunningStatusPage Kill_Click 同款文案） */
  const [stopConfirm, setStopConfirm] = useState<{ id: string; pid: number } | null>(null)
  /** 首页「删除此版本」确认弹窗（Win 02 §2.1 #8：Title 删除版本，默认取消） */
  const [deleteRow, setDeleteRow] = useState<string | null>(null)

  async function reload(): Promise<void> {
    setLoading(true)
    try {
      const catalog = await request<{ installed: InstalledVersion[] }>('catalog.installed')
      setInstalled(sortVersions(catalog.installed))
      setSelected((prev) => {
        if (prev !== undefined && catalog.installed.some((v) => v.id === prev)) return prev
        return catalog.installed.find((v) => v.isDefault)?.id ?? catalog.installed[0]?.id
      })
    } catch (e) {
      setError(String(e))
    }
    try {
      const settings = await request<{
        gameDir: string
        homeVersionCardMode?: string
      }>('settings.get')
      setGameDir(settings.gameDir)
      if (
        settings.homeVersionCardMode === 'favorites' ||
        settings.homeVersionCardMode === 'pinned'
      ) {
        setCardMode(settings.homeVersionCardMode)
      }
    } catch { /* 读取失败不阻塞主流程 */ }
    try {
      const list = await request<AccountList>('accounts.list')
      setAccounts(list.accounts)
      const cur = list.accounts.find((a) => a.uuid === list.current) ?? list.accounts[0]
      if (cur !== undefined) {
        setMode(
          cur.type === 'microsoft'
            ? 'microsoft'
            : cur.type === 'external'
              ? 'external'
              : 'offline'
        )
      }
    } catch (e) {
      setError(String(e))
    }
    setLoading(false)
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 换账户后重试头像（避免上一个账户的 404 把新账户也锁在首字母）
  const modeAccounts = accounts.filter((a) =>
    mode === 'offline'
      ? a.type === 'offline'
      : mode === 'microsoft'
        ? a.type === 'microsoft'
        : a.type === 'external'
  )
  const account = modeAccounts[0]
  // 与 Win 端 AvatarHelper.UrlFor 同规则：微软账户按 UUID，其它按用户名
  const avatarId =
    account === undefined ? '' : account.type === 'microsoft' ? account.uuid : account.name
  const avatarUrl = avatarId === '' ? null : 'https://minotar.net/helm/' + encodeURIComponent(avatarId) + '/128'
  const running = session.pid !== undefined && session.pid > 0
  // Win 02 §2.4：按钮 IsEnabled = isRunning || id != null —— 运行中可点（停止），
  // 启动中一律禁用，其余只在「没选版本 / 没有可用账户」时禁用
  const launchReady = selected !== undefined && account !== undefined

  /**
   * 启动按钮 / 右键「启动」共用的同一条链路（Win LaunchBtn_Click）：
   * 先选中该版本；正在运行 → 弹「结束游戏进程」确认后 game.kill；
   * 没在跑 → 走 session.launch。
   */
  function launchOrStop(id?: string): void {
    if (id === undefined || session.launching) return
    setSelected(id)
    if (running) {
      setStopConfirm({ id: session.launchVersion ?? id, pid: session.pid ?? 0 })
      return
    }
    const acct = account
    if (acct === undefined) {
      // Win 端就地弹登录框；Linux 口径是跳账户页登录（与 B4 通栏按钮同入口）
      push('info', '当前模式还没有账户，请先登录')
      props.onNavigate('accounts')
      return
    }
    void session.launch({
      versionId: id,
      playerName: acct.name,
      accountUuid: acct.uuid,
      loginMode: MODE_LABEL[mode]
    })
  }

  /** 置顶 / 收藏开关（Win ToggleVersionFlag 同款：写实例档案后本地重排） */
  function toggleMark(id: string | undefined, key: 'pinned' | 'favorite'): void {
    if (id === undefined) return
    const current = installed.find((v) => v.id === id)
    const nextValue = !(current?.[key] === true)
    // 乐观更新，失败回滚靠 reload
    setInstalled((prev) =>
      sortVersions(prev.map((v) => (v.id === id ? { ...v, [key]: nextValue } : v)))
    )
    void request('versions.setMarks', { versionId: id, [key]: nextValue }).catch((e) => {
      push('error', String(e))
      void reload()
    })
  }

  /**
   * 右键菜单的文件夹入口：作用于右键的那一行（menuRow），不是选中的版本
   * （Win 02 差异 #2 指出的作用行错位就在这里修）。
   */
  function openRowFolder(kind: 'version' | 'saves' | 'mods'): void {
    if (menuRow === undefined) return
    void request('versions.openFolder', { versionId: menuRow, kind }).catch((e) =>
      push('error', String(e))
    )
  }

  /** 卡头视图切换（Win 02 §2.2 HomeVersionCardMode）：本地生效 + 落盘下次进页沿用。 */
  function changeCardMode(next: 'installed' | 'favorites' | 'pinned'): void {
    setCardMode(next)
    void request('settings.apply', { homeVersionCardMode: next }).catch(() => undefined)
  }

  // 右键菜单全部按 Win 02 §2.1 的 8 项与顺序（问 Nova 是 Linux 侧补充项，排在文件夹入口之后）
  const menuTargetRow = menuRow !== undefined ? installed.find((v) => v.id === menuRow) : undefined
  const menu = useContextMenu([
    { label: '启动', onSelect: () => launchOrStop(menuRow) },
    { label: '打开详细信息', onSelect: () => props.onNavigate('versions') },
    { label: '打开版本文件夹', onSelect: () => openRowFolder('version') },
    { label: '打开存档文件夹', onSelect: () => openRowFolder('saves') },
    { label: '打开模组文件夹', onSelect: () => openRowFolder('mods') },
    { label: '问 Nova', onSelect: () => props.onNavigate('nova') },
    { label: '', separator: true },
    {
      label: menuTargetRow?.pinned === true ? '取消置顶' : '置顶',
      onSelect: () => toggleMark(menuRow, 'pinned')
    },
    {
      label: menuTargetRow?.favorite === true ? '取消收藏' : '收藏',
      onSelect: () => toggleMark(menuRow, 'favorite')
    },
    { label: '', separator: true },
    {
      label: '删除此版本',
      danger: true,
      onSelect: () => {
        if (menuRow === undefined) return
        setDeleteRow(menuRow)
      }
    }
  ])

  /** 首页「删除此版本」确认后的执行（Win 02 §2.1 #8）。 */
  function doDeleteRow(): void {
    const target = deleteRow
    setDeleteRow(null)
    if (target === null) return
    void request<{ freedBytes: number }>('versions.delete', { versionId: target })
      .then((r) => {
        push('success', `已删除 ${target}（释放 ${fmtSize(r.freedBytes)}）`)
        return reload()
      })
      .catch((e) => push('error', String(e)))
  }

  /** 按设置过滤主页列表（installed / favorites / pinned）。 */
  const visibleVersions = installed.filter((v) =>
    cardMode === 'favorites'
      ? v.favorite === true
      : cardMode === 'pinned'
        ? v.pinned === true
        : true
  )
  // 卡头标题按视图同步（Win VersionCardText 同口径：收藏的版本 / 置顶的版本）
  const CARD_TITLE: Record<typeof cardMode, string> = {
    installed: '已安装版本',
    favorites: '收藏的版本',
    pinned: '置顶的版本'
  }
  const CARD_MODE_LABEL: Record<typeof cardMode, string> = {
    installed: '已安装',
    favorites: '收藏',
    pinned: '置顶'
  }

  const statusColor = running
    ? 'var(--success)'
    : session.launching
      ? 'var(--warning)'
      : session.status.startsWith('启动失败')
        ? 'var(--danger)'
        : 'var(--text-disabled)'

  return (
    <div className="page">
      {/* 首页不放页面大标题（Win 端首页直接从卡片开始） */}

      {/* 满高两栏：卡片撑满窗口高度、列表在卡内滚动（对齐 Win 端 HomePage） */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 24 }}>
          {/* ── 左栏（*）：启动自检 → 版本列表 ── */}
          <div
            style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}
          >
            {/* 启动自检卡片已移除：Win 端首页只在必要时短暂提示，不常驻占位 */}
            <div className="card card-flush" style={{ flex: 1, minHeight: 0 }}>
              <div className="card-head">
                <span className="card-title">{CARD_TITLE[cardMode]}</span>
                <span className="chip">{visibleVersions.length}</span>
                <div style={{ flex: 1 }} />
                {/* 视图切换（Win 02 §2.2 HomeVersionCardMode：已安装 / 收藏 / 置顶，
                    收藏·置顶两档用小图标 + 文案；切换即落盘 settings.apply） */}
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['installed', 'favorites', 'pinned'] as const).map((m) => (
                    <button
                      key={m}
                      className={`btn btn-sm${cardMode === m ? ' btn-primary' : ' btn-subtle'}`}
                      style={{ padding: '0 8px', height: 26 }}
                      title={`查看${CARD_TITLE[m]}`}
                      onClick={() => changeCardMode(m)}
                    >
                      {m === 'favorites' && <IconStarGlyph size={12} />}
                      {m === 'pinned' && <IconPinGlyph size={12} />}
                      {CARD_MODE_LABEL[m]}
                    </button>
                  ))}
                </div>
                <button
                  className="btn btn-subtle btn-sm"
                  onClick={() => void reload()}
                >
                  <IconRefresh size={14} /> 刷新
                </button>
              </div>
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto', overflowX: 'hidden',
                  padding: '0 10px 10px'
                }}
              >
                {loading && (
                  <div style={{ padding: 20, textAlign: 'center', opacity: 0.6 }}>加载中…</div>
                )}
                {!loading && visibleVersions.length === 0 && cardMode === 'installed' && (
                  <div className="empty">
                    <div className="empty-title">还没有已安装的版本</div>
                    <div className="empty-hint">
                      去「下载」页选择一个版本安装。
                      {gameDir !== '' && <div>当前游戏目录：{gameDir}</div>}
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={() => props.onNavigate('download')}
                    >
                      前往下载
                    </button>
                  </div>
                )}
                {!loading && visibleVersions.length === 0 && cardMode !== 'installed' && (
                  <div className="empty">
                    <div className="empty-title">
                      {cardMode === 'favorites' ? '还没有收藏的版本' : '还没有置顶的版本'}
                    </div>
                    <div className="empty-hint">
                      在版本列表里右键一个版本，选「{cardMode === 'favorites' ? '收藏' : '置顶'}」即可标记。
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={() => props.onNavigate('versions')}
                    >
                      去版本页标记
                    </button>
                  </div>
                )}
                {visibleVersions.map((version, index) => {
                  const isSelected = version.id === selected
                  const icon = iconFor(version)
                  return (
                    <div
                      key={version.id}
                      onContextMenu={(e) => {
                        setMenuRow(version.id)
                        menu.bind().onContextMenu(e)
                      }}
                    >
                      <div
                        className={`row${isSelected ? ' row-active' : ''}`}
                        style={{
                          animationDelay: `${index * 39}ms`,
                          // Win 端列宽：图标 Auto / 名称 260 / 芯片 * / 数据 Auto / 行尾标记 Auto
                          display: 'grid',
                          gridTemplateColumns: 'auto minmax(120px, 260px) minmax(0, 1fr) auto auto',
                          columnGap: 12
                        }}
                        onClick={() => setSelected(version.id)}
                      >
                        <div className="icon32">
                          <img src={icon} alt="" width={32} height={32} />
                        </div>
                        <span className="t-strong truncate">{version.id}</span>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span className="chip">{tagFor(version)}</span>
                          {version.isDefault === true && (
                            <span className="chip chip-accent">默认</span>
                          )}
                        </div>
                        <div className="meta">
                          <span className="meta-k">上次启动</span>
                          <span className="meta-v">{lastPlayed(version.lastPlayedAt)}</span>
                          <span className="meta-k">大小</span>
                          <span className="meta-v">{fmtSize(version.sizeBytes)}</span>
                          {fmtPlay(version.playSeconds) !== null && (
                            <>
                              <span className="meta-k">时长</span>
                              <span className="meta-v">{fmtPlay(version.playSeconds)}</span>
                            </>
                          )}
                        </div>
                        {/* 行尾置顶/收藏双图标（Win 02 §1.4：置顶在前、收藏在后，只有设置过才出现） */}
                        {(version.pinned === true || version.favorite === true) && (
                          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            {version.pinned === true && (
                              <span title="置顶" style={{ color: 'var(--accent)', display: 'flex' }}>
                                <IconPinGlyph size={14} />
                              </span>
                            )}
                            {version.favorite === true && (
                              <span title="收藏" style={{ color: 'var(--accent)', display: 'flex' }}>
                                <IconStarGlyph size={14} />
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* ── 右栏（360）：账户 / 启动 ──
              minWidth: 0 必须要有：flex 子项默认 min-width:auto，遇到不可换行的
              长文本（例如桥接错误信息）会被顶宽，把整栏挤出窗口。 */}
          <div
            style={{
              width: 360,
              minWidth: 360,
              maxWidth: 360,
              flexShrink: 0,
              minHeight: 0,
              display: 'flex'
            }}
          >
            <div
              className="card"
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                gap: 14
              }}
            >
              <Segmented<Mode>
                value={mode}
                options={[
                  { value: 'microsoft', label: MODE_LABEL.microsoft },
                  { value: 'external', label: MODE_LABEL.external },
                  { value: 'offline', label: MODE_LABEL.offline }
                ]}
                onChange={setMode}
              />

              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10
                }}
              >
                {/* 头像：minotar 头部图（失败回退首字母） */}
                <div
                  style={{
                    width: 88,
                    height: 88,
                    borderRadius: 'var(--r-control)',
                    background:
                      account === undefined
                        ? 'var(--surface-hover)'
                        : 'linear-gradient(180deg,#3a2a1a,#241a10)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 40,
                    color: account === undefined ? 'var(--text-tertiary)' : '#e0a76a',
                    overflow: 'hidden',
                    animation: session.launching ? 'pulse 1.4s infinite' : undefined
                  }}
                >
                  {avatarUrl !== null && !avatarFailed ? (
                    <img
                      src={avatarUrl}
                      alt={account?.name ?? ''}
                      width={88}
                      height={88}
                      style={{ objectFit: 'cover' }}
                      onError={() => setAvatarFailed(true)}
                    />
                  ) : (
                    account?.name[0]?.toUpperCase() ?? <IconUser size={36} />
                  )}
                </div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>
                  {account?.name ?? '未选择账户'}
                </div>
                {account === undefined && (
                  // 无账户通栏就地登录按钮（Win 02 §1.5 NoAccountBtn：高 32 通栏，
                  // 文案按模式三态；Linux 口径点击跳账户页完成登录）
                  <button
                    className="btn"
                    style={{ height: 32, width: '100%' }}
                    onClick={() => props.onNavigate('accounts')}
                  >
                    {NO_ACCOUNT_LABEL[mode]}
                  </button>
                )}
                {account !== undefined && modeAccounts.length > 1 && (
                  <div
                    style={{
                      display: 'flex',
                      gap: 6,
                      flexWrap: 'wrap',
                      justifyContent: 'center'
                    }}
                  >
                    {modeAccounts.map((a) => (
                      <button
                        key={a.uuid}
                        className="btn btn-subtle btn-sm"
                        onClick={() =>
                          void request('accounts.setCurrent', { uuid: a.uuid })
                        }
                      >
                        {a.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {session.status !== '' && (
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}
                  title={session.status}
                >
                  <span
                    className="dot"
                    style={{
                      background: statusColor,
                      animation:
                        session.launching || running ? 'pulse 1.6s infinite' : undefined
                    }}
                  />
                  <span className="t-cap truncate" style={{ minWidth: 0, flex: 1 }}>
                    {session.status}
                  </span>
                </div>
              )}

              {/* 启动按钮：主段 + 下拉段（对齐 Win 端 HomePage 的按钮组）
                  两段必须同高同圆角，下拉段是主段的"同组深一档"，不是灰按钮。
                  状态机（Win 02 §2.4）：启动游戏 → 启动中（禁用）→ 停止游戏（运行中可点） */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                <button
                  className="btn btn-primary"
                  style={{
                    flex: 1,
                    height: 62,
                    borderRadius: 'var(--r-control)',
                    flexDirection: 'column',
                    gap: 1,
                    display: 'flex',
                    fontSize: 16,
                    fontWeight: 700,
                    boxShadow:
                      running || session.launching
                        ? 'none'
                        : '0 4px 22px rgba(255,211,34,0.28)'
                  }}
                  disabled={session.launching || (!running && !launchReady)}
                  onClick={() => launchOrStop(selected)}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {running && !session.launching ? (
                      <IconStopGlyph size={15} />
                    ) : (
                      <IconPlay size={15} />
                    )}{' '}
                    {session.launching
                      ? '启动中…'
                      : running
                        ? '停止游戏'
                        : '启动游戏'}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.72 }}>
                    {selected ?? '未选择版本'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 运行日志不放在首页：Win 端首页没有日志区，且启动时日志卡出现会挤压
            两栏布局（用户看到账户卡被"拉大"）。日志在「运行状态 / 启动器日志」页。 */}

        {error !== '' && (
          <div style={{ marginTop: 12 }}>
            <div className="info info-danger">
              <IconClose size={14} />
              <div className="info-body">{error}</div>
            </div>
          </div>
        )}

        {/* 停止游戏确认（文案照抄 Win RunningStatusPage Kill_Click：
            Title「结束游戏进程」Content「将强制结束 {0}（PID {1}），未保存的进度会丢失。」） */}
        <Modal
          open={stopConfirm !== null}
          title="结束游戏进程"
          onClose={() => setStopConfirm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setStopConfirm(null)}>
                取消
              </button>
              <button
                className="btn btn-primary"
                style={{ background: 'var(--danger)', color: '#fff' }}
                onClick={() => {
                  setStopConfirm(null)
                  void session.kill()
                }}
              >
                结束进程
              </button>
            </>
          }
        >
          <div className="dialog-body">
            将强制结束 <b>{stopConfirm?.id}</b>（PID {stopConfirm?.pid}），未保存的进度会丢失。
          </div>
        </Modal>

        {/* 首页「删除此版本」确认（Win 02 §2.1 #8：Title 删除版本、按钮 删除/取消 默认取消；
            首页无「运行中禁止删除」守卫，与版本页不同） */}
        <Modal
          open={deleteRow !== null}
          title="删除版本"
          onClose={() => setDeleteRow(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDeleteRow(null)}>
                取消
              </button>
              <button
                className="btn btn-primary"
                style={{ background: 'var(--danger)', color: '#fff' }}
                onClick={() => doDeleteRow()}
              >
                删除
              </button>
            </>
          }
        >
          <div className="dialog-body">
            确定要删除版本 <b>{deleteRow}</b> 吗？
            <br />
            将删除其版本文件夹，此操作不可恢复。
          </div>
        </Modal>
      {menu.node}
      {host}
    </div>
  )
}
