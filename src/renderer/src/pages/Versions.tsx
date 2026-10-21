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
    { label: '导入整合包', onSelect: () => void pickAndPreview() },
    { label: '从链接导入', onSelect: () => setLinkOpen(true) },
    { label: '备份与回档', onSelect: () => void openBackup(menuRef.current) },
    { label: '', separator: true },
    { label: '问 Nova', onSelect: () => menuRef.current !== null && props.onAskNova(menuRef.current.id) },
    {
      label: '删除',
      danger: true,
      onSelect: () => menuRef.current !== null && setConfirm(menuRef.current)
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
  const [exportExclude, setExportExclude] = useState('')
  const [exportBusy, setExportBusy] = useState(false)
  const [progress, setProgress] = useState<{ stage: string; percent: number } | null>(null)

  // ── 导入（文件 / 链接共用预览弹窗） ──
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
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const kinds = ['全部', '正式版', '快照版', 'NeoForge', 'Forge', 'Fabric', 'Quilt']

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((v) => {
      if (q !== '' && !v.id.toLowerCase().includes(q)) return false
      if (kindFilter !== '全部' && tagFor(v) !== kindFilter) return false
      return true
    })
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
        includeGameSettings: false,
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
    const path = await nat.pickFile('选择整合包', [
      { name: '整合包（.mrpack / .zip）', extensions: ['mrpack', 'zip'] }
    ])
    if (path === null) return
    await previewPack(path)
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
        <button className="btn" onClick={() => void pickAndPreview()} title="导入整合包">
          <IconImport size={15} /> 导入整合包
        </button>
        <button className="btn" onClick={() => setLinkOpen(true)} title="从链接导入">
          从链接导入
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
          options={kinds.map((k) => ({ value: k, label: k }))}
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
                title="删除"
                disabled={busy !== null}
                onClick={(e) => {
                  e.stopPropagation()
                  setConfirm(v)
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

      {/* 删除确认 */}
      <Modal
        open={confirm !== null}
        title="删除版本？"
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
          将删除版本 <b>{confirm?.id}</b> 的整个目录（含模组与配置），不可恢复。
        </div>
      </Modal>

      {host}
    </div>
  )
}
