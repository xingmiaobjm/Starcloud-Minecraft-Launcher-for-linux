/// 版本页：对齐 Win 端 VersionsPage —— 顶部工具栏 + 满高卡片列表 +
/// 行右键 / 「…」共用的完整行菜单（Win 0.3.7 同款 13 项）：
/// 启动 / 版本详情 / 三个文件夹入口 · 重命名 / 复制版本 / 导出整合包 /
/// 导入整合包 / 从链接导入 / 备份与回档 · 问 Nova / 删除。
/// 整合包导出导入与备份走桥接（versions.export*/import*/backup*），进度走 modpack.progress 事件。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { nativeApi, onBridgeEvent, request } from '../bridge'
import type { InstalledVersion } from '../bridge'
import { EmptyState, Modal, ProgressBar, SkeletonList, useToasts, Select, useContextMenu } from '../ui'
import VersionDetailPage from './VersionDetail'

import grassIcon from '../assets/mc-icons/natural_grass_block.png'
import amethystIcon from '../assets/mc-icons/block_of_amethyst.png'
import cobbleIcon from '../assets/mc-icons/masonry_cobblestone.png'
import dirtIcon from '../assets/mc-icons/natural_dirt.png'
import neoforgeIcon from '../assets/mc-icons/neoforge.png'
import forgeIcon from '../assets/mc-icons/forge.png'
import fabricIcon from '../assets/mc-icons/fabric.png'
import quiltIcon from '../assets/mc-icons/quilt.png'
import { IconFolder, IconImport, IconRefresh, IconMore, IconTrash } from '../icons'

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
const LOADER_LABEL: Record<string, string> = {
  neoforge: 'NeoForge',
  forge: 'Forge',
  fabric: 'Fabric',
  quilt: 'Quilt'
}
const TYPE_LABEL: Record<string, string> = {
  release: '正式版',
  snapshot: '快照版',
  old_beta: '远古 Beta',
  old_alpha: '远古 Alpha'
}

/** 版本行图标（加载器优先，否则按版本类型）。 */
function iconFor(v: InstalledVersion): string {
  const loader = v.loader ?? ''
  if (LOADER_ICONS[loader] !== undefined) return LOADER_ICONS[loader]
  const lower = v.id.toLowerCase()
  if (lower.includes('neoforge')) return neoforgeIcon
  if (lower.includes('forge')) return forgeIcon
  if (lower.includes('fabric')) return fabricIcon
  if (lower.includes('quilt')) return quiltIcon
  return TYPE_ICONS[v.type ?? 'release'] ?? grassIcon
}

/** 类型标签（加载器优先，否则版本类型）。 */
function tagFor(v: InstalledVersion): string {
  const loader = v.loader ?? ''
  if (LOADER_LABEL[loader] !== undefined) return LOADER_LABEL[loader]
  const lower = v.id.toLowerCase()
  if (lower.includes('neoforge')) return 'NeoForge'
  if (lower.includes('forge')) return 'Forge'
  if (lower.includes('fabric')) return 'Fabric'
  if (lower.includes('quilt')) return 'Quilt'
  return TYPE_LABEL[v.type ?? 'release'] ?? '正式版'
}

function fmtSize(bytes: number): string {
  if (!bytes) return '未完成'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 上次启动文案（对齐 Win 端 FormatLastPlayed）。 */
function lastPlayed(iso?: string): string {
  if (iso === undefined || iso === null || iso === '') return '从未启动'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '从未启动'
  const pad = (n: number): string => n.toString().padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const today = new Date()
  const dayDiff = Math.floor(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86400000
  )
  if (dayDiff <= 0) return `今天 ${hm}`
  if (dayDiff === 1) return `昨天 ${hm}`
  if (dayDiff < 30) return `${dayDiff} 天前`
  if (dayDiff < 365) return `${Math.floor(dayDiff / 30)} 个月前`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 排序对齐 Win：默认版本置顶，其余 id 倒序。 */
function sortVersions(list: InstalledVersion[]): InstalledVersion[] {
  return [...list].sort((a, b) => {
    const aLast = a.isDefault === true ? 1 : 0
    const bLast = b.isDefault === true ? 1 : 0
    if (aLast !== bLast) return bLast - aLast
    const ai = a.id.toLowerCase()
    const bi = b.id.toLowerCase()
    return ai < bi ? 1 : ai > bi ? -1 : 0
  })
}

// ── 整合包 / 备份的数据形状（桥接 versions.* 返回体） ────────────────────────

interface PackDir {
  name: string
  fileCount: number
  totalBytes: number
  standard: boolean
}

interface ExportProbe {
  versionId: string
  gameVersion: string
  dependencies: Record<string, string>
  loader: string
  dirs: PackDir[]
}

interface PackPreview {
  format: string
  name: string
  gameVersion: string
  dependencies: Record<string, string>
  loader: string
  fileCount: number
  totalBytes: number
  contentRoot: string
}

interface BackupEntry {
  id: string
  version_id: string
  name: string
  created_at: string
  size_bytes: number
  file_count: number
  zip_path: string
  includes: string[]
}

const FORMAT_LABEL: Record<string, string> = {
  modrinth: 'Modrinth 整合包',
  curseforge: 'CurseForge 整合包',
  multimc: 'MultiMC / Prism 实例包',
  raw: '通用压缩包'
}

/** 每种导出格式的说明行（Win 03 §5.1，照抄）。 */
const FORMAT_HINT: Record<string, string> = {
  modrinth: '按 SHA1 反查 Modrinth 来源；反查不到的文件按下方策略处理。',
  curseforge: '按文件指纹反查 CurseForge 来源；反查不到的文件按下方策略处理。',
  multimc: '自包含实例包：全部内容原样打进 .minecraft/，不联网反查，导入端解压即用。'
}

/** 压缩级别（Win 03 §5.1 三档；桥接 versions.exportModpack 暂无压缩参数，见 doExport TODO）。 */
const COMPRESSION_LABEL: Record<string, string> = {
  optimal: '最优压缩（体积最小）',
  fast: '快速压缩（速度优先）',
  none: '不压缩（最快）'
}

/** 依赖键 → 展示名（导出时加载器类型固定，只展示）。 */
const LOADER_DISPLAY: Record<string, string> = {
  'fabric-loader': 'Fabric',
  'quilt-loader': 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge'
}

/** 版本名合法性（与桥接 IsValidVersionId 同规则：非空且不含路径非法字符）。 */
function validVersionId(name: string): boolean {
  return name.trim().length > 0 && !/[<>:"/\\|?*]/.test(name)
}

export default function VersionsPage(props: {
  onLaunch: (id: string) => void
  onAskNova: (id: string) => void
}): JSX.Element {
  const { push, host } = useToasts()
  const nat = nativeApi()
  const [items, setItems] = useState<InstalledVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<InstalledVersion | null>(null)
  /** 运行中守卫弹窗（Win Delete_Click：运行中只弹提示，没有删除按钮） */
  const [guard, setGuard] = useState<InstalledVersion | null>(null)
  /** 正在运行的版本 id 集合（runtime.state 的 instances；删除守卫用） */
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set())
  const [gameDir, setGameDir] = useState('')
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState('全部')
  const [openId, setOpenId] = useState<string | null>(null)

  // ── 行菜单（Win 端 RowMenu：右键与「…」按钮共用） ──
  const [menuRow, setMenuRow] = useState<InstalledVersion | null>(null)
  const menuRef = useRef<InstalledVersion | null>(null)
  menuRef.current = menuRow
  const menu = useContextMenu([
    { label: '启动', onSelect: () => menuRef.current !== null && props.onLaunch(menuRef.current.id) },
    { label: '版本详情', onSelect: () => menuRef.current !== null && setOpenId(menuRef.current.id) },
    {
      label: '打开版本文件夹',
      onSelect: () => void openFolders(menuRef.current, 'version')
    },
    { label: '打开存档文件夹', onSelect: () => void openFolders(menuRef.current, 'saves') },
    { label: '打开模组文件夹', onSelect: () => void openFolders(menuRef.current, 'mods') },
    { label: '', separator: true },
    { label: '重命名', onSelect: () => openRename(menuRef.current) },
    { label: '复制版本', onSelect: () => openCopy(menuRef.current) },
    { label: '导出整合包', onSelect: () => void openExport(menuRef.current) },
    { label: '导入整合包', onSelect: () => setImportOpen(true) },
    { label: '备份与回档', onSelect: () => void openBackup(menuRef.current) },
    { label: '', separator: true },
    { label: '问 Nova', onSelect: () => menuRef.current !== null && props.onAskNova(menuRef.current.id) },
    {
      label: '删除',
      danger: true,
      onSelect: () => void openDeleteConfirm(menuRef.current)
    }
  ])

  // ── 重命名 / 复制 ──
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null)
  const [renameBusy, setRenameBusy] = useState(false)
  const [copy, setCopy] = useState<{ id: string; name: string; isolated: boolean } | null>(null)
  const [copyContent, setCopyContent] = useState(false)
  const [copyBusy, setCopyBusy] = useState(false)

  // ── 导出 ──
  const [exportProbe, setExportProbe] = useState<ExportProbe | null>(null)
  const [exportFormat, setExportFormat] = useState('modrinth')
  const [exportName, setExportName] = useState('')
  const [exportPkgVer, setExportPkgVer] = useState('1.0.0')
  const [exportAuthor, setExportAuthor] = useState('')
  const [exportDesc, setExportDesc] = useState('')
  const [exportMc, setExportMc] = useState('')
  const [exportLoaderKey, setExportLoaderKey] = useState('none')
  const [exportLoaderVer, setExportLoaderVer] = useState('')
  const [exportDirs, setExportDirs] = useState<Set<string>>(new Set())
  /** 自定义目录（Win 03 §5.1：输入目录名 + 添加，追加进勾选列表与 dirs 参数） */
  const [exportCustomDirs, setExportCustomDirs] = useState<string[]>([])
  const [exportNewDir, setExportNewDir] = useState('')
  const [exportDirError, setExportDirError] = useState('')
  /** 打包策略（Win 03 §5.1：包含实例设置默认勾选；压缩级别默认最优） */
  const [exportIncludeSettings, setExportIncludeSettings] = useState(true)
  const [exportCompression, setExportCompression] = useState<'optimal' | 'fast' | 'none'>('optimal')
  const [exportExclude, setExportExclude] = useState('')
  const [exportBusy, setExportBusy] = useState(false)
  const [progress, setProgress] = useState<{ stage: string; percent: number } | null>(null)

  // ── 导入（方式选择弹窗：拖入 / 选文件 / 链接，文件与链接共用预览弹窗） ──
  const [importOpen, setImportOpen] = useState(false)
  const [dropHot, setDropHot] = useState(false)
  const [importPack, setImportPack] = useState<{ path: string; preview: PackPreview } | null>(null)
  const [importName, setImportName] = useState('')
  const [importIsolated, setImportIsolated] = useState(true)
  const [importMc, setImportMc] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkBusy, setLinkBusy] = useState(false)

  // ── 备份与回档 ──
  const [backupFor, setBackupFor] = useState<InstalledVersion | null>(null)
  const [backupEntries, setBackupEntries] = useState<BackupEntry[]>([])
  const [backupDirs, setBackupDirs] = useState<Set<string>>(new Set())
  const [backupSaves, setBackupSaves] = useState(true)
  const [backupBusy, setBackupBusy] = useState(false)

  // modpack.progress 事件 → 打开的弹窗里显示
  useEffect(() => {
    onBridgeEvent((event, params) => {
      if (event !== 'modpack.progress') return
      setProgress({ stage: String(params.stage ?? ''), percent: Number(params.percent ?? -1) })
    })
  }, [])

  const loadBackupList = useCallback(async (versionId: string): Promise<void> => {
    try {
      const r = await request<{ entries: BackupEntry[] }>('versions.backupList', { versionId })
      setBackupEntries(r.entries)
    } catch {
      setBackupEntries([])
    }
  }, [])

  /** 运行实例清单（Win `_s.Runtime.Instances` 同口径：删除守卫用它判断运行中）。 */
  async function loadRuntime(): Promise<void> {
    try {
      const r = await request<{ instances?: Array<{ pid: number; versionId: string }> }>(
        'runtime.state',
        {}
      )
      setRunningIds(new Set((r.instances ?? []).map((i) => i.versionId)))
    } catch {
      setRunningIds(new Set())
    }
  }

  async function reload(): Promise<void> {
    setLoading(true)
    try {
      const r = await request<{ installed: InstalledVersion[] }>('catalog.installed')
      setItems(sortVersions(r.installed))
    } catch (e) {
      push('error', `读取版本列表失败：${String(e)}`)
    } finally {
      setLoading(false)
    }
    try {
      const s = await request<{ gameDir: string }>('settings.get')
      setGameDir(s.gameDir)
    } catch {
      /* 目录读取失败不阻塞列表 */
    }
    await loadRuntime()
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * 用户自定义类别（Win 02 §3.2：实例档案 profile.Category，在版本详情页填写）。
   * 桥接 catalog.installed 目前未返回 category 字段，返回后筛选与搜索自动生效；
   * 这里按「可能出现的字段」读取，取不到按未分类处理。
   */
  function categoryOf(v: InstalledVersion): string {
    const c = (v as { category?: unknown }).category
    return typeof c === 'string' ? c.trim() : ''
  }

  // 类别筛选动态项（Win 02 §3.2：全部 / 未分类 / 动态类别去重排序）
  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const v of items) {
      const c = categoryOf(v)
      if (c !== '') set.add(c)
    }
    return ['全部', '未分类', ...[...set].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  // 列表重建后原筛选可能失效：失效则回「全部」（Win 02 §3.2 同口径）
  useEffect(() => {
    if (!categories.includes(kindFilter)) setKindFilter('全部')
  }, [categories, kindFilter])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((v) => {
      const cat = categoryOf(v)
      // 搜索范围：id + 类别（Win 02 §3.2 SearchBox：id + category 小写包含）
      if (q !== '' && !(v.id.toLowerCase().includes(q) || cat.toLowerCase().includes(q))) {
        return false
      }
      if (kindFilter === '未分类') {
        if (cat !== '') return false
      } else if (kindFilter !== '全部' && cat !== kindFilter) {
        return false
      }
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, query, kindFilter])

  async function openFolder(): Promise<void> {
    try {
      await request('versions.openFolder', {})
    } catch (e) {
      push('error', String(e))
    }
  }

  /** 行菜单的三个文件夹入口（Win OpenFolder_Click：跟随实例根，缺目录就建）。 */
  async function openFolders(v: InstalledVersion | null, kind: string): Promise<void> {
    if (v === null) return
    setBusy(v.id)
    try {
      await request('versions.openFolder', { versionId: v.id, kind })
    } catch (e) {
      push('error', String(e))
    } finally {
      setBusy(null)
    }
  }

  function openRename(v: InstalledVersion | null): void {
    if (v === null) return
    setRename({ id: v.id, name: v.id })
  }

  async function doRename(): Promise<void> {
    if (rename === null || renameBusy) return
    const newName = rename.name.trim()
    if (!validVersionId(newName)) return
    setRenameBusy(true)
    try {
      await request('versions.rename', { versionId: rename.id, newName })
      push('success', `已重命名为 ${newName}`)
      setRename(null)
      await reload()
    } catch (e) {
      push('error', `重命名失败：${String(e)}`)
    }
    setRenameBusy(false)
  }

  function openCopy(v: InstalledVersion | null): void {
    if (v === null) return
    setCopyContent(false)
    setCopy({ id: v.id, name: `${v.id}-copy`, isolated: v.isolated === true })
  }

  async function doCopy(): Promise<void> {
    if (copy === null || copyBusy) return
    const newId = copy.name.trim()
    if (!validVersionId(newId)) return
    setCopyBusy(true)
    try {
      await request('versions.copy', { versionId: copy.id, newId, copyContent })
      push('success', `已复制为 ${newId}`)
      setCopy(null)
      await reload()
    } catch (e) {
      push('error', `复制失败：${String(e)}`)
    }
    setCopyBusy(false)
  }

  // ── 导出整合包（Win ModPackExportDialog 的字段与流程） ──

  async function openExport(v: InstalledVersion | null): Promise<void> {
    if (v === null) return
    setBusy(v.id)
    try {
      const probe = await request<ExportProbe>('versions.exportProbe', { versionId: v.id })
      const loaderKey = ['fabric-loader', 'quilt-loader', 'forge', 'neoforge'].find(
        (k) => probe.dependencies[k] !== undefined
      )
      setExportProbe(probe)
      setExportFormat('modrinth')
      setExportName(v.id)
      setExportPkgVer('1.0.0')
      setExportAuthor('')
      setExportDesc('')
      setExportMc(probe.gameVersion)
      setExportLoaderKey(loaderKey ?? 'none')
      setExportLoaderVer(loaderKey !== undefined ? (probe.dependencies[loaderKey] ?? '') : '')
      setExportDirs(new Set(probe.dirs.filter((d) => d.standard).map((d) => d.name)))
      setExportCustomDirs([])
      setExportNewDir('')
      setExportDirError('')
      setExportIncludeSettings(true)
      setExportCompression('optimal')
      setExportExclude('')
    } catch (e) {
      push('error', String(e))
    }
    setBusy(null)
  }

  function applyExportPreset(want: (name: string) => boolean): void {
    setExportProbe((prev) => {
      if (prev === null) return prev
      setExportDirs(new Set(prev.dirs.filter((d) => want(d.name)).map((d) => d.name)))
      return prev
    })
  }

  /** 自定义目录添加（Win 03 §5.1：三条本地可校验文案；「目录不存在」校验缺桥接入口，见注释）。 */
  function addExportCustomDir(): void {
    const name = exportNewDir.trim()
    if (name === '') {
      setExportDirError('请输入目录名。')
      return
    }
    if (/[<>:"/\\|?*]/.test(name)) {
      setExportDirError('目录名不合法。')
      return
    }
    if (exportCustomDirs.includes(name) || (exportProbe?.dirs ?? []).some((d) => d.name === name)) {
      setExportDirError('该目录已在列表中。')
      return
    }
    // TODO(Win 03 §5.1「目录不存在：{0}」)：渲染层无法探测磁盘目录、桥接也无 stat 入口，
    // 暂不做存在性校验；不存在的目录导出时按 0 个文件处理，无副作用。
    setExportCustomDirs((prev) => [...prev, name])
    setExportDirs((prev) => new Set(prev).add(name))
    setExportNewDir('')
    setExportDirError('')
  }

  async function doExport(): Promise<void> {
    const probe = exportProbe
    if (probe === null || exportBusy || nat === null) return
    if (exportDirs.size === 0) {
      push('info', '请至少勾选一个内容目录。')
      return
    }
    const ext = exportFormat === 'modrinth' ? 'mrpack' : 'zip'
    const kindLabel = FORMAT_LABEL[exportFormat] ?? '整合包'
    const stamp = new Date()
    const pad = (n: number): string => n.toString().padStart(2, '0')
    const suggested = `${probe.versionId}-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}`
    const outPath = await nat.pickSaveFile('导出整合包', suggested, [
      { name: kindLabel, extensions: [ext] }
    ])
    if (outPath === null) return
    setExportBusy(true)
    setProgress(null)
    const dependencies: Record<string, string> = { minecraft: exportMc.trim() }
    if (exportLoaderKey !== 'none' && exportLoaderVer.trim() !== '') {
      dependencies[exportLoaderKey] = exportLoaderVer.trim()
    }
    try {
      const r = await request<{
        downloadableFiles: number
        overriddenFiles: number
        skippedFiles: number
        totalBytes: number
        loaderWarning?: string
      }>('versions.exportModpack', {
        versionId: probe.versionId,
        outPath,
        format: exportFormat,
        name: exportName.trim() === '' ? probe.versionId : exportName.trim(),
        packageVersion: exportPkgVer.trim() === '' ? '1.0.0' : exportPkgVer.trim(),
        author: exportAuthor.trim(),
        description: exportDesc.trim(),
        gameVersion: exportMc.trim(),
        dependencies,
        dirs: [...exportDirs],
        excludeRules: exportExclude
          .split('\n')
          .map((s) => s.trim())
          .filter((s) => s !== ''),
        // TODO(Win 03 §5.1 压缩级别)：桥接 versions.exportModpack 尚无压缩参数（后端固定默认档），
        // UI 先收集 exportCompression，桥接补参数后透传即可
        compressionLevel: exportCompression,
        includeGameSettings: exportIncludeSettings,
        unresolvedAsOverrides: true
      })
      let msg = `${kindLabel} · 可下载 ${r.downloadableFiles} 个 · 打包 ${r.overriddenFiles} 个 · 共 ${fmtSize(r.totalBytes)}`
      if (r.skippedFiles > 0) msg += `\n按排除规则跳过 ${r.skippedFiles} 个文件。`
      if (r.loaderWarning !== undefined && r.loaderWarning !== '') msg += `\n\n提示：${r.loaderWarning}`
      msg += `\n\n已保存到：${outPath}`
      push('success', msg)
      setExportProbe(null)
    } catch (e) {
      push('error', `导出失败：${String(e)}`)
    }
    setExportBusy(false)
    setProgress(null)
  }

  // ── 导入整合包（文件 / 链接都汇到同一个预览弹窗，Win RunImportAsync 同款字段） ──

  async function pickAndPreview(): Promise<void> {
    if (nat === null) {
      push('info', '整合包导入需要桌面端（文件选择框不可用）')
      return
    }
    setImportOpen(false)
    const path = await nat.pickFile('选择整合包', [
      {
        name: '整合包（.mrpack / .zip / .7z / .rar / .tar.gz）',
        extensions: ['mrpack', 'zip', '7z', 'rar', 'gz']
      }
    ])
    if (path === null) return
    await previewPack(path)
  }

  /** 拖入文件 → 换本地路径 → 预览（Win 0.4.x：.mrpack / .zip / .7z / .rar / .tar.gz） */
  function handlePackDrop(e: React.DragEvent): void {
    e.preventDefault()
    const file = [...e.dataTransfer.files].find((f) => /\.(mrpack|zip|7z|rar|gz)$/i.test(f.name))
    if (file === undefined) return
    const path = nat?.getPathForFile(file) ?? ''
    if (path === '') {
      push('info', '无法获取拖入文件的路径')
      return
    }
    setImportOpen(false)
    void previewPack(path)
  }

  async function previewPack(packPath: string): Promise<void> {
    setBusy('import')
    setProgress(null)
    try {
      const preview = await request<PackPreview>('versions.packPreview', { packPath })
      setImportPack({ path: packPath, preview })
      setImportName(preview.name)
      setImportIsolated(true)
      setImportMc(preview.gameVersion)
    } catch (e) {
      push('error', `无法导入整合包：${String(e)}`)
    }
    setBusy(null)
  }

  async function doImport(): Promise<void> {
    const pack = importPack
    if (pack === null || importBusy) return
    const targetId = importName.trim()
    if (!validVersionId(targetId)) {
      push('info', '版本名不能为空，且不能包含 < > : " / \\ | ? *')
      return
    }
    if (pack.preview.format === 'raw' && importMc.trim() === '') {
      push('info', '请填写 Minecraft 版本，例如 1.20.1')
      return
    }
    setImportBusy(true)
    setProgress(null)
    try {
      const r = await request<{ targetId: string; renamed: boolean; isolated: boolean; summary: string }>(
        'versions.importPack',
        {
          packPath: pack.path,
          targetId,
          isolated: importIsolated,
          mcVersion: pack.preview.format === 'raw' ? importMc.trim() : undefined,
          contentRoot: pack.preview.contentRoot
        }
      )
      let msg = r.isolated ? `已创建版本「${r.targetId}」。\n${r.summary}` : `已写入共享 .minecraft 目录。\n${r.summary}`
      if (r.renamed) msg += '\n（同名版本已存在，已自动改名）'
      push('success', msg)
      setImportPack(null)
      await reload()
    } catch (e) {
      push('error', `导入失败：${String(e)}`)
    }
    setImportBusy(false)
    setProgress(null)
  }

  async function doLinkImport(): Promise<void> {
    const url = linkUrl.trim()
    if (url === '' || linkBusy || nat === null) return
    setLinkBusy(true)
    setProgress(null)
    try {
      const r = await request<{ url: string; fileName: string }>('versions.resolvePackLink', { url })
      const dl = await request<{ path: string; fileName: string }>('versions.downloadPack', {
        url: r.url,
        fileName: r.fileName
      })
      setLinkOpen(false)
      setLinkUrl('')
      setLinkBusy(false)
      await previewPack(dl.path)
      return
    } catch (e) {
      push('error', `下载失败：${String(e)}`)
    }
    setLinkBusy(false)
    setProgress(null)
  }

  // ── 备份与回档（Win ModPackDialogs.BackupAsync：粒度 + 列表内回档/删除） ──

  async function openBackup(v: InstalledVersion | null): Promise<void> {
    if (v === null) return
    setBusy(v.id)
    setBackupFor(v)
    setBackupSaves(true)
    setBackupBusy(false)
    try {
      const probe = await request<ExportProbe>('versions.exportProbe', { versionId: v.id })
      const names = probe.dirs.filter((d) => d.standard && d.name !== 'saves').map((d) => d.name)
      setBackupDirs(new Set(names))
    } catch {
      setBackupDirs(new Set(['mods', 'config']))
    }
    await loadBackupList(v.id)
    setBusy(null)
  }

  async function doBackup(): Promise<void> {
    const v = backupFor
    if (v === null || backupBusy) return
    setBackupBusy(true)
    setProgress(null)
    try {
      await request('versions.backupCreate', {
        versionId: v.id,
        dirs: [...backupDirs],
        includeSaves: backupSaves
      })
      push('success', `已备份 ${v.id}`)
      await loadBackupList(v.id)
    } catch (e) {
      push('error', `备份失败：${String(e)}`)
    }
    setBackupBusy(false)
    setProgress(null)
  }

  async function restoreBackup(entry: BackupEntry): Promise<void> {
    const v = backupFor
    if (v === null || backupBusy) return
    if (!window.confirm(`确定回档到「${entry.name}」吗？当前状态会先自动备份一份（安全网）。`)) return
    setBackupBusy(true)
    setProgress(null)
    try {
      await request('versions.backupRestore', { entryId: entry.id, versionId: v.id })
      push('success', `已回档到「${entry.name}」`)
    } catch (e) {
      push('error', `回档失败：${String(e)}`)
    }
    setBackupBusy(false)
    setProgress(null)
  }

  async function deleteBackup(entry: BackupEntry): Promise<void> {
    const v = backupFor
    if (v === null || backupBusy) return
    if (!window.confirm(`确定删除备份「${entry.name}」？此操作不可撤销。`)) return
    setBackupBusy(true)
    try {
      await request('versions.backupDelete', { entryId: entry.id })
      await loadBackupList(v.id)
    } catch (e) {
      push('error', String(e))
    }
    setBackupBusy(false)
  }

  async function remove(v: InstalledVersion): Promise<void> {
    setBusy(v.id)
    try {
      const r = await request<{ freedBytes: number }>('versions.delete', { versionId: v.id })
      push('success', `已删除 ${v.id}（释放 ${fmtSize(r.freedBytes)}）`)
      await reload()
    } catch (e) {
      push('error', String(e))
    } finally {
      setBusy(null)
    }
  }

  /**
   * 删除入口（菜单「删除」与行内删除快键共用，Win Delete_Click 同流程）：
   * 先取一次最新运行实例 —— 运行中只弹「请先停止游戏再删除」守卫弹窗（没有删除按钮），
   * 否则按隔离 / 共享两套文案弹确认（默认取消）。
   */
  async function openDeleteConfirm(v: InstalledVersion | null): Promise<void> {
    if (v === null) return
    // 点删除时取一次最新运行实例（runtime.state），别用加载页面时的旧快照
    let running = false
    try {
      const r = await request<{ instances?: Array<{ versionId: string }> }>('runtime.state', {})
      const ids = new Set((r.instances ?? []).map((i) => i.versionId))
      setRunningIds(ids)
      running = ids.has(v.id)
    } catch {
      running = runningIds.has(v.id)
    }
    if (running) {
      setConfirm(null)
      setGuard(v)
      return
    }
    setGuard(null)
    setConfirm(v)
  }

  if (openId !== null) {
    return <VersionDetailPage versionId={openId} onBack={() => setOpenId(null)} />
  }

  const progressBlock =
    progress !== null ? (
      <div style={{ marginTop: 10 }}>
        <div className="t-cap" style={{ marginBottom: 6 }}>
          {progress.stage}
        </div>
        <ProgressBar value={progress.percent >= 0 ? progress.percent : undefined} indeterminate={progress.percent < 0} />
      </div>
    ) : null

  return (
    <div className="page">
      {/* 工具栏（对齐 Win 端：目录栏 + 导入 + 搜索 + 类别 + 刷新 / 打开目录） */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          marginBottom: 14,
          flexShrink: 0
        }}
      >
        <div
          className="input"
          style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}
          title={gameDir}
        >
          <IconFolder size={15} style={{ opacity: 0.6 }} />
          <span className="truncate" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {gameDir === '' ? '游戏目录' : gameDir}
          </span>
        </div>
        <button className="btn" onClick={() => setImportOpen(true)} title="导入整合包">
          <IconImport size={15} /> 导入整合包
        </button>
        <input
          className="input"
          style={{ width: 210 }}
          placeholder="搜索版本 / 类别"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          width={110}
          value={kindFilter}
          options={categories.map((k) => ({ value: k, label: k }))}
          onChange={setKindFilter}
        />
        <button className="btn" onClick={() => void reload()} disabled={loading}>
          <IconRefresh size={14} /> 刷新
        </button>
        <button className="btn" onClick={() => void openFolder()}>
          <IconFolder size={15} /> 打开游戏目录
        </button>
      </div>

      {/* 列表卡片：满高、内部滚动 */}
      <div className="card card-flush" style={{ flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '6px 10px 10px' }}>
          {loading && <SkeletonList rows={6} avatar />}
          {!loading && filtered.length === 0 && (
            <EmptyState
              title={items.length === 0 ? '还没有已安装的版本' : '没有匹配的版本'}
              hint={
                items.length === 0
                  ? '去「下载」页选择一个版本安装。'
                  : '换个关键词或类别试试。'
              }
            />
          )}
          {filtered.map((v) => (
            <div
              key={v.id}
              className="row"
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto minmax(120px, 260px) minmax(0, 1fr) auto auto auto',
                columnGap: 12,
                cursor: 'default'
              }}
              onContextMenu={(e) => {
                // Win 同款：行上右键弹 RowMenu
                e.preventDefault()
                e.stopPropagation()
                setMenuRow(v)
                menu.open(e.clientX, e.clientY)
              }}
              onClick={() => setOpenId(v.id)}
            >
              <div className="icon32">
                <img src={iconFor(v)} alt="" width={32} height={32} />
              </div>
              <span className="t-strong truncate">{v.id}</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span className="chip">{tagFor(v)}</span>
                {v.isolated === true && <span className="chip">版本隔离</span>}
                {v.isDefault === true && <span className="chip chip-accent">默认</span>}
                {v.jarExists === false && <span className="chip chip-danger">缺少 jar</span>}
              </div>
              <div className="meta">
                <span className="meta-k">上次启动</span>
                <span className="meta-v">{lastPlayed(v.lastPlayedAt)}</span>
                <span className="meta-k">大小</span>
                <span className="meta-v">{fmtSize(v.sizeBytes)}</span>
              </div>
              <button
                className="btn btn-subtle btn-sm"
                title="更多"
                disabled={busy !== null}
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuRow(v)
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  menu.open(r.right - 200, r.bottom + 6)
                }}
              >
                <IconMore size={16} />
              </button>
              <button
                className="btn btn-subtle btn-sm btn-danger"
                title="删除该版本"
                disabled={busy !== null}
                onClick={(e) => {
                  e.stopPropagation()
                  void openDeleteConfirm(v)
                }}
              >
                <IconTrash size={15} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 行右键菜单（Win RowMenu 同款条目与分组） */}
      {menu.node}

      {/* 重命名 */}
      <Modal
        open={rename !== null}
        title="重命名版本"
        onClose={() => setRename(null)}
        width={420}
        footer={
          <>
            <button className="btn" onClick={() => setRename(null)}>
              取消
            </button>
            <button
              className="btn btn-primary"
              style={{ fontWeight: 600 }}
              disabled={renameBusy || !validVersionId(rename?.name ?? '')}
              onClick={() => void doRename()}
            >
              重命名
            </button>
          </>
        }
      >
        <input
          className="input"
          placeholder="新的版本名"
          value={rename?.name ?? ''}
          onChange={(e) => setRename((prev) => (prev === null ? prev : { ...prev, name: e.target.value }))}
        />
        {!validVersionId(rename?.name ?? '') && (
          <div className="t-cap" style={{ marginTop: 8, color: 'var(--danger)' }}>
            版本名不能为空，且不能包含 {'< > : " / \\ | ? *'}
          </div>
        )}
      </Modal>

      {/* 复制版本 */}
      <Modal
        open={copy !== null}
        title="复制版本"
        onClose={() => setCopy(null)}
        width={440}
        footer={
          <>
            <button className="btn" onClick={() => setCopy(null)}>
              取消
            </button>
            <button
              className="btn btn-primary"
              style={{ fontWeight: 600 }}
              disabled={copyBusy || !validVersionId(copy?.name ?? '')}
              onClick={() => void doCopy()}
            >
              复制
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            className="input"
            placeholder={`例如 ${copy?.id ?? '版本'}-copy`}
            value={copy?.name ?? ''}
            onChange={(e) => setCopy((prev) => (prev === null ? prev : { ...prev, name: e.target.value }))}
          />
          {copy?.isolated === true && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={copyContent}
                onChange={(e) => setCopyContent(e.target.checked)}
              />
              同时复制 mods / 存档等隔离内容
            </label>
          )}
        </div>
      </Modal>

      {/* 导出整合包 */}
      <Modal
        open={exportProbe !== null}
        title="导出整合包"
        onClose={() => (exportBusy ? undefined : setExportProbe(null))}
        width={560}
        footer={
          <>
            <button className="btn" disabled={exportBusy} onClick={() => setExportProbe(null)}>
              取消
            </button>
            <button
              className="btn btn-primary"
              style={{ fontWeight: 600 }}
              disabled={exportBusy}
              onClick={() => void doExport()}
            >
              下一步（选择保存位置）
            </button>
          </>
        }
      >
        {exportProbe !== null && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="t-cap">
              源版本：{exportProbe.versionId}　MC {exportMc || exportProbe.gameVersion}
              {exportProbe.loader !== '' ? ` · ${exportProbe.loader}` : ''}
            </div>
            <div className="t-strong" style={{ fontSize: 14 }}>导出格式</div>
            <Select
              width={280}
              value={exportFormat}
              options={[
                { value: 'modrinth', label: 'Modrinth 整合包（.mrpack）' },
                { value: 'curseforge', label: 'CurseForge 整合包（.zip）' },
                { value: 'multimc', label: 'MultiMC / Prism 实例包（.zip）' }
              ]}
              onChange={setExportFormat}
            />
            {FORMAT_HINT[exportFormat] !== undefined && (
              <div className="t-cap" style={{ marginTop: -6 }}>
                {FORMAT_HINT[exportFormat]}
              </div>
            )}
            <div className="t-strong" style={{ fontSize: 14 }}>包元数据</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', alignItems: 'center' }}>
              <label className="t-cap" style={{ fontSize: 12 }}>名称</label>
              <input className="input" value={exportName} onChange={(e) => setExportName(e.target.value)} />
              <label className="t-cap" style={{ fontSize: 12 }}>包版本号</label>
              <input className="input" value={exportPkgVer} onChange={(e) => setExportPkgVer(e.target.value)} />
              <label className="t-cap" style={{ fontSize: 12 }}>作者</label>
              <input className="input" placeholder="可留空" value={exportAuthor} onChange={(e) => setExportAuthor(e.target.value)} />
              <label className="t-cap" style={{ fontSize: 12 }}>简介</label>
              <input className="input" placeholder="可留空" value={exportDesc} onChange={(e) => setExportDesc(e.target.value)} />
            </div>
            <div className="t-strong" style={{ fontSize: 14 }}>加载器与依赖（可手改）</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', alignItems: 'center' }}>
              <label className="t-cap" style={{ fontSize: 12 }}>Minecraft 版本</label>
              <input className="input" value={exportMc} onChange={(e) => setExportMc(e.target.value)} />
              <label className="t-cap" style={{ fontSize: 12 }}>加载器</label>
              {/* 加载器由实例自动识别，不允许改类型（把 Fabric 包当 Forge 导出没有意义）；
                  能改的只是它的版本号（Win 导出对话框同样只让填加载器版本）。 */}
              <div className="t-body" style={{ fontSize: 13 }}>
                {exportLoaderKey === 'none'
                  ? '无（原版）'
                  : (LOADER_DISPLAY[exportLoaderKey] ?? exportLoaderKey)}
              </div>
              <label className="t-cap" style={{ fontSize: 12 }}>加载器版本</label>
              <input
                className="input"
                value={exportLoaderVer}
                onChange={(e) => setExportLoaderVer(e.target.value)}
                disabled={exportLoaderKey === 'none'}
                placeholder={exportLoaderKey === 'none' ? '无加载器' : '可手动指定版本号'}
              />
            </div>
            <div className="t-strong" style={{ fontSize: 14 }}>打包内容</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-sm" onClick={() => applyExportPreset((n) => n === 'mods' || n === 'config')}>
                仅 Mod 与配置
              </button>
              <button
                className="btn btn-sm"
                onClick={() => applyExportPreset((n) => n !== 'saves')}
              >
                全部内容
              </button>
              <button className="btn btn-sm" onClick={() => applyExportPreset(() => true)}>
                全部（含存档）
              </button>
            </div>
            <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(exportProbe.dirs ?? []).map((d) => (
                <label key={d.name} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={exportDirs.has(d.name)}
                    onChange={(e) => {
                      setExportDirs((prev) => {
                        const next = new Set(prev)
                        if (e.target.checked) next.add(d.name)
                        else next.delete(d.name)
                        return next
                      })
                    }}
                  />
                  {d.name}
                  <span className="t-cap">
                    {d.fileCount} 项 · {fmtSize(d.totalBytes)}
                    {d.standard ? '' : '（自定义）'}
                  </span>
                </label>
              ))}
              {/* 自定义目录（Win 03 §5.1：追加进列表，标「（自定义）」，勾选态随添加即选） */}
              {exportCustomDirs
                .filter((n) => !(exportProbe.dirs ?? []).some((d) => d.name === n))
                .map((n) => (
                  <label key={n} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={exportDirs.has(n)}
                      onChange={(e) => {
                        setExportDirs((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(n)
                          else next.delete(n)
                          return next
                        })
                      }}
                    />
                    {n}
                    <span className="t-cap">（自定义）</span>
                  </label>
                ))}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="目录名，如 kubejs / schematics"
                value={exportNewDir}
                onChange={(e) => {
                  setExportNewDir(e.target.value)
                  setExportDirError('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addExportCustomDir()
                }}
              />
              <button className="btn" onClick={addExportCustomDir}>
                添加
              </button>
            </div>
            {exportDirError !== '' && (
              <div className="t-cap" style={{ color: 'var(--danger)', marginTop: -6 }}>
                {exportDirError}
              </div>
            )}
            <div className="t-strong" style={{ fontSize: 14 }}>打包策略与排除规则</div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={exportIncludeSettings}
                onChange={(e) => setExportIncludeSettings(e.target.checked)}
              />
              包含实例设置（options.txt / servers.dat 等）
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', alignItems: 'center' }}>
              <label className="t-cap" style={{ fontSize: 12 }}>压缩级别</label>
              <Select
                width={220}
                value={exportCompression}
                options={(Object.keys(COMPRESSION_LABEL) as Array<'optimal' | 'fast' | 'none'>).map(
                  (k) => ({ value: k, label: COMPRESSION_LABEL[k] })
                )}
                onChange={setExportCompression}
              />
            </div>
            <label className="t-cap" style={{ fontSize: 12 }}>
              排除规则（每行一条；含 / 匹配整条相对路径，否则匹配任意一层目录名，支持 * 与 ?）
            </label>
            <textarea
              className="input"
              style={{ height: 64, minHeight: 64, resize: 'none' }}
              value={exportExclude}
              onChange={(e) => setExportExclude(e.target.value)}
            />
            {exportBusy && progressBlock}
          </div>
        )}
      </Modal>

      {/* 导入预览（文件 / 链接共用） */}
      <Modal
        open={importPack !== null}
        title="导入整合包"
        onClose={() => (importBusy ? undefined : setImportPack(null))}
        width={520}
        footer={
          <>
            <button className="btn" disabled={importBusy} onClick={() => setImportPack(null)}>
              取消
            </button>
            <button
              className="btn btn-primary"
              style={{ fontWeight: 600 }}
              disabled={importBusy}
              onClick={() => void doImport()}
            >
              导入
            </button>
          </>
        }
      >
        {importPack !== null && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="t-cap">格式：{FORMAT_LABEL[importPack.preview.format] ?? importPack.preview.format}</div>
            <div className="t-strong" style={{ fontSize: 14 }}>包名：{importPack.preview.name}</div>
            <div className="t-cap">
              Minecraft {importPack.preview.gameVersion || '（未识别）'}
              {importPack.preview.loader !== '' ? ` · ${importPack.preview.loader}` : ''} ·{' '}
              {importPack.preview.fileCount} 个文件 · {fmtSize(importPack.preview.totalBytes)}
            </div>
            <div className="t-cap" style={{ fontSize: 12 }}>新建版本名称</div>
            <input
              className="input"
              placeholder="新建版本名称"
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
            />
            {importPack.preview.format === 'raw' && (
              <>
                <div className="t-cap" style={{ fontSize: 12 }}>Minecraft 版本（必填）</div>
                <input
                  className="input"
                  placeholder="例如 1.20.1"
                  value={importMc}
                  onChange={(e) => setImportMc(e.target.value)}
                />
                <div className="t-cap" style={{ fontSize: 12 }}>
                  这个压缩包没有整合包清单，请填写它对应的 Minecraft 版本；导入时会联动安装该原版。
                </div>
              </>
            )}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={importIsolated}
                onChange={(e) => setImportIsolated(e.target.checked)}
              />
              版本隔离（推荐，整合包内容单独存放）
            </label>
            <div className="t-cap" style={{ fontSize: 12 }}>
              {importIsolated
                ? '整合包内容将单独存放在 versions/<新名称>/ 下。'
                : '将写入共享 .minecraft 目录，不会新建版本条目。'}
            </div>
            {importBusy && progressBlock}
          </div>
        )}
      </Modal>

      {/* 导入整合包：方式选择弹窗（Win ImportPackDialog 同款：拖入 / 选文件 / 从链接导入） */}
      <Modal open={importOpen} title="导入整合包" onClose={() => setImportOpen(false)} width={520}>
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDropHot(true)
          }}
          onDragLeave={() => setDropHot(false)}
          onDrop={(e) => {
            setDropHot(false)
            handlePackDrop(e)
          }}
          style={{
            border: dropHot
              ? '1.5px solid var(--accent)'
              : '1.5px dashed var(--stroke-strong)',
            borderRadius: 8,
            background: 'var(--surface-subtle)',
            padding: '26px 24px',
            textAlign: 'center'
          }}
        >
          <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>把整合包拖到这里</div>
          <div className="t-cap" style={{ marginTop: 4 }}>
            支持 .mrpack、.zip、.7z、.rar、.tar.gz（Modrinth / CurseForge / MultiMC / packwiz / 通用压缩包）
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => void pickAndPreview()}>
            选择文件
          </button>
          <button
            className="btn"
            style={{ flex: 1 }}
            onClick={() => {
              setImportOpen(false)
              setLinkOpen(true)
            }}
          >
            从链接导入
          </button>
        </div>
      </Modal>

      {/* 从链接导入 */}
      <Modal
        open={linkOpen}
        title="从链接导入"
        onClose={() => (linkBusy ? undefined : setLinkOpen(false))}
        width={520}
        footer={
          <>
            <button className="btn" disabled={linkBusy} onClick={() => setLinkOpen(false)}>
              取消
            </button>
            <button
              className="btn btn-primary"
              style={{ fontWeight: 600 }}
              disabled={linkBusy || linkUrl.trim() === ''}
              onClick={() => void doLinkImport()}
            >
              下载并导入
            </button>
          </>
        }
      >
        <div className="t-cap" style={{ marginBottom: 10 }}>
          支持 Modrinth / CurseForge 整合包页面链接，以及 .mrpack / .zip 压缩包直链。
        </div>
        <input
          className="input"
          placeholder="https://modrinth.com/modpack/… 或 …/curseforge.com/minecraft/modpacks/…"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
        />
        {linkBusy && progressBlock}
      </Modal>

      {/* 备份与回档 */}
      <Modal
        open={backupFor !== null}
        title={`备份与回档 · ${backupFor?.id ?? ''}`}
        onClose={() => (backupBusy ? undefined : setBackupFor(null))}
        width={560}
        footer={
          <>
            <button
              className="btn"
              disabled={backupBusy}
              onClick={() => {
                void request('shell.openPath', { path: `${gameDir}\\starcloud\\backups` }).catch(() =>
                  push('info', `备份目录：${gameDir}/starcloud/backups`)
                )
              }}
            >
              打开备份目录
            </button>
            <button className="btn" disabled={backupBusy} onClick={() => setBackupFor(null)}>
              关闭
            </button>
            <button
              className="btn btn-primary"
              style={{ fontWeight: 600 }}
              disabled={backupBusy}
              onClick={() => void doBackup()}
            >
              开始备份
            </button>
          </>
        }
      >
        {backupFor !== null && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="t-strong" style={{ fontSize: 14 }}>备份粒度</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[...backupDirs].map((name) => (
                <span key={name} className="chip chip-accent">
                  {name}
                </span>
              ))}
              {backupSaves && <span className="chip chip-accent">saves</span>}
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={backupSaves}
                onChange={(e) => setBackupSaves(e.target.checked)}
              />
              包含存档（saves）
            </label>
            {backupBusy && progressBlock}
            <div className="t-strong" style={{ fontSize: 14, marginTop: 6 }}>
              已有备份（{backupEntries.length}）
            </div>
            <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {backupEntries.length === 0 && (
                <div className="t-cap">还没有这个版本的备份。</div>
              )}
              {backupEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="fr-dialog-row"
                  style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto' }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span className="t-strong truncate" style={{ display: 'block', fontSize: 13 }}>
                      {entry.name}
                    </span>
                    <span className="t-cap">
                      {new Date(entry.created_at).toLocaleString()} · {fmtSize(entry.size_bytes)} ·{' '}
                      {entry.includes.join('、') || '—'}
                    </span>
                  </span>
                  <button
                    className="btn"
                    style={{ height: 28, padding: '0 10px' }}
                    disabled={backupBusy}
                    onClick={() => void restoreBackup(entry)}
                  >
                    回档
                  </button>
                  <button
                    className="btn btn-danger"
                    style={{ height: 28, padding: '0 10px' }}
                    disabled={backupBusy}
                    onClick={() => void deleteBackup(entry)}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* 运行中删除守卫（Win Delete_Click：运行中只弹这句话，没有删除按钮） */}
      <Modal
        open={guard !== null}
        title="删除版本"
        onClose={() => setGuard(null)}
        footer={
          <button className="btn" onClick={() => setGuard(null)}>
            关闭
          </button>
        }
      >
        <div className="dialog-body">
          版本 <b>{guard?.id}</b> 正在运行，请先停止游戏再删除。
        </div>
      </Modal>

      {/* 删除确认（文案照抄 Win：隔离 / 共享两套；按钮 删除/取消，默认取消） */}
      <Modal
        open={confirm !== null}
        title="删除版本"
        onClose={() => setConfirm(null)}
        footer={
          <>
            <button className="btn" onClick={() => setConfirm(null)}>
              取消
            </button>
            <button
              className="btn btn-primary"
              style={{ background: 'var(--danger)', color: '#fff' }}
              onClick={() => {
                const v = confirm
                setConfirm(null)
                if (v !== null) void remove(v)
              }}
            >
              删除
            </button>
          </>
        }
      >
        <div className="dialog-body">
          确定要删除版本 <b>{confirm?.id}</b> 吗？
          <br />
          {confirm?.isolated === true
            ? '将删除其版本文件夹（含 mods / 存档 / 配置），此操作不可恢复。'
            : '将删除其版本文件夹，此操作不可恢复。'}
          {confirm?.isolated === true ? null : (
            <>
              <br />
              <br />
              注意：这是共享实例，mods / 配置 / 存档等文件位于 .minecraft 根目录，不会被一并删除。
            </>
          )}
        </div>
      </Modal>

      {host}
    </div>
  )
}
