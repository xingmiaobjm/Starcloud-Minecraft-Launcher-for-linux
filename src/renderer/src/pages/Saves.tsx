/// 存档页：对齐 Win 端 SavesPage —— 顶部工具栏（批量操作 + 搜索 + 筛选 + 导入 + 打开目录）
/// + 满高列表（64px 世界缩略图、名称双行、版本/隔离芯片、两行数据列）。
///
/// 缩略图：世界目录里的 icon.png 由桥接 `saves.icon` 读成 data URL 返回
/// （渲染层读不到文件系统，也不该为图片放开 file:// CSP）。
import { useCallback, useEffect, useMemo, useState } from 'react'

import { request } from '../bridge'
import type { SaveInfo, SaveList } from '../bridge'
import { EmptyState, Modal, SkeletonList, useToasts, Select } from '../ui'
import { IconRefresh, IconWorld } from '../icons'

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

/** 上次游玩文案（对齐 Win 端：无记录 → 无游玩记录）。 */
function lastPlayedText(iso?: string): string {
  if (iso === undefined || iso === null || iso === '') return '无游玩记录'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '无游玩记录'
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

export default function SavesPage(props: {
  /** 系统保存对话框（导出分享包） */
  onSaveFile?: (
    defaultName: string,
    filters: Array<{ name: string; extensions: string[] }>
  ) => Promise<string | null>
  /** 系统打开文件对话框（导入分享包） */
  onOpenFile?: (filters: Array<{ name: string; extensions: string[] }>) => Promise<string | null>
  /** 已安装版本 id 列表（复制到其他版本） */
  versions?: string[]
  /** 打开指定版本实例的「复制到其他版本」对话框 */
  onCopyToVersion?: (save: SaveInfo, targetVersionId: string) => void
}): JSX.Element {
  const { push, host } = useToasts()
  const [saves, setSaves] = useState<SaveInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [icons, setIcons] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [versionFilter, setVersionFilter] = useState('全部')
  const [busy, setBusy] = useState(false)
  /** 复制到其他版本：选目标版本 */
  const [copyTarget, setCopyTarget] = useState<string | null>(null)

  // 选中/缩略图的键必须带 gameRoot：版本隔离下每个版本都有自己的
  // saves/新世界，只按 folderName 记录会一点选一片（用户实测：点一个亮四个）。
  const saveKey = (s: SaveInfo): string => `${s.gameRoot}/${s.folderName}`

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const data = await request<SaveList>('saves.list')
      setSaves(data.saves)
      // 缩略图逐张取（数量有限；失败就保持占位块）
      for (const s of data.saves) {
        if (s.iconPath === undefined || s.iconPath === '') continue
        void request<{ dataUrl: string }>('saves.icon', { path: s.iconPath })
          .then((r) => setIcons((prev) => ({ ...prev, [`${s.gameRoot}/${s.folderName}`]: r.dataUrl })))
          .catch(() => undefined)
      }
    } catch (e) {
      push('error', `存档列表读取失败：${String(e)}`)
    }
    setLoading(false)
  }, [push])

  useEffect(() => {
    void load()
  }, [load])

  const versions = useMemo(() => {
    const set = new Set<string>()
    for (const s of saves) set.add(s.versionId === '' ? '全局' : s.versionId)
    return ['全部', ...set]
  }, [saves])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return saves.filter((s) => {
      if (q !== '' && !`${s.levelName} ${s.folderName} ${s.versionId}`.toLowerCase().includes(q)) {
        return false
      }
      if (versionFilter !== '全部') {
        const v = s.versionId === '' ? '全局' : s.versionId
        if (v !== versionFilter) return false
      }
      return true
    })
  }, [saves, query, versionFilter])

  const selectedSaves = filtered.filter((s) => selected.has(saveKey(s)))

  async function openFolder(save?: SaveInfo): Promise<void> {
    setBusy(true)
    try {
      await request('saves.openFolder', { gameRoot: save?.gameRoot, folderName: save?.folderName })
      push('success', save === undefined ? '已打开存档目录' : `已打开 ${save.levelName} 的目录`)
    } catch (e) {
      push('error', `打开目录失败：${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function backup(targets: SaveInfo[]): Promise<void> {
    if (targets.length === 0) {
      push('info', '先勾选要备份的世界')
      return
    }
    setBusy(true)
    try {
      let total = 0
      for (const t of targets) {
        const r = await request<{ sizeBytes: number }>('saves.backup', {
          gameRoot: t.gameRoot,
          folderName: t.folderName
        })
        total += r.sizeBytes
      }
      push('success', `已备份 ${targets.length} 个世界（${formatBytes(total)}）`)
    } catch (e) {
      push('error', `备份失败：${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  function toggle(folder: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(folder)) next.delete(folder)
      else next.add(folder)
      return next
    })
  }

  /** 导出分享包：把选中的世界压成 zip（对方「导入分享包」即可，无需任何账号）。 */
  async function exportShare(): Promise<void> {
    const save = selectedSaves[0]
    if (save === undefined) return
    const saveFile = props.onSaveFile
    if (saveFile === undefined) {
      push('info', '当前环境没有保存对话框')
      return
    }
    const dest = await saveFile(`${save.folderName}-分享包.zip`, [
      { name: '世界分享包', extensions: ['zip'] }
    ])
    if (dest === null) return
    setBusy(true)
    try {
      const r = await request<{ path: string; sizeBytes: number }>('saves.exportShare', {
        gameRoot: save.gameRoot,
        folderName: save.folderName,
        destPath: dest
      })
      push('success', `已导出分享包：${r.path}`)
    } catch (e) {
      push('error', `导出失败：${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  /** 导入分享包：选一个 zip，落到共享 .minecraft 的 saves 下。 */
  async function importShare(): Promise<void> {
    const openFile = props.onOpenFile
    if (openFile === undefined) {
      push('info', '当前环境没有文件对话框')
      return
    }
    const zip = await openFile([{ name: '世界分享包', extensions: ['zip'] }])
    if (zip === null) return
    setBusy(true)
    try {
      const r = await request<{ folderName: string }>('saves.importShare', { zipPath: zip })
      push('success', `已导入世界「${r.folderName}」到共享存档`)
      await load()
    } catch (e) {
      push('error', `导入失败：${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  /** 复制到其他版本：把选中的世界复制进目标版本的实例目录。 */
  async function copyToVersion(targetVersionId: string): Promise<void> {
    const save = selectedSaves[0]
    if (save === undefined) return
    setBusy(true)
    try {
      const r = await request<{ folderName: string; versionId: string }>('saves.copyToVersion', {
        gameRoot: save.gameRoot,
        folderName: save.folderName,
        targetVersionId
      })
      push('success', `已复制到 ${r.versionId}：${r.folderName}`)
      await load()
    } catch (e) {
      push('error', `复制失败：${String(e)}`)
    } finally {
      setBusy(false)
    }
  }
  const tplBtn = (
    label: string,
    onClick: () => void,
    opts?: { disabled?: boolean; title?: string }
  ): JSX.Element => (
    <button
      className="btn"
      disabled={opts?.disabled === true || busy}
      title={opts?.title ?? label}
      onClick={onClick}
    >
      {label}
    </button>
  )

  return (
    <div className="page">
      {/* 工具栏（对齐 Win 端批量操作行） */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          marginBottom: 14,
          flexWrap: 'wrap',
          flexShrink: 0
        }}
      >
        {tplBtn('用其他版本启动', () => push('info', '跨版本启动：需选择版本后可用'), {
          disabled: true
        })}
        {tplBtn('复制到其他版本', () => setCopyTarget('__pick__'), {
          disabled: selectedSaves.length !== 1 || (props.versions ?? []).length === 0,
          title: '把选中的世界复制到另一个已安装版本'
        })}
        {tplBtn(
          '备份所选世界',
          () => void backup(selectedSaves),
          { disabled: selectedSaves.length === 0, title: '备份勾选的世界' }
        )}
        {tplBtn('同步到设备…', () => push('info', '设备同步：需登录 Starcloud ID'), {
          disabled: true
        })}
        {tplBtn('分享', () => void exportShare(), {
          disabled: selectedSaves.length !== 1,
          title: '导出为世界分享包（zip），对方导入即可'
        })}
        <div style={{ width: 1, height: 24, background: 'var(--stroke-divider)' }} />
        <input
          className="input"
          style={{ width: 220 }}
          placeholder="搜索世界 / 版本"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          width={150}
          value={versionFilter}
          options={versions.map((v) => ({ value: v, label: v }))}
          onChange={setVersionFilter}
        />
        <div style={{ flex: 1 }} />
        {tplBtn('导入分享包', () => void importShare(), { disabled: false })}
        {tplBtn('打开存档目录', () => void openFolder())}
        <button className="btn btn-subtle" onClick={() => void load()} disabled={loading}>
          <IconRefresh size={15} />
        </button>
      </div>

      {/* 列表卡片：满高、内部滚动 */}
      <div className="card card-flush" style={{ flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '6px 12px 12px' }}>
          {loading && <SkeletonList rows={5} avatar tall />}
          {!loading && filtered.length === 0 && (
            <EmptyState
              title={saves.length === 0 ? '还没有发现存档' : '没有匹配的世界'}
              hint={
                saves.length === 0
                  ? '启动一次游戏后回到这里，或确认设置里的 .minecraft 目录是否正确。'
                  : '换个关键词或版本筛选试试。'
              }
              action={
                <button className="btn" onClick={() => void load()}>
                  <IconRefresh size={14} /> 重新扫描
                </button>
              }
            />
          )}
          {filtered.map((s) => {
            const key = saveKey(s)
            const icon = icons[key]
            const checked = selected.has(key)
            return (
              <div
                key={key}
                className={`row${checked ? ' row-active' : ''}`}
                onClick={() => toggle(key)}
              >
                {/* 64px 世界缩略图（Win 端同尺寸） */}
                <div
                  className="icon32"
                  style={{ width: 64, height: 64, borderRadius: 8, overflow: 'hidden' }}
                >
                  {icon !== undefined ? (
                    <img src={icon} alt="" width={64} height={64} style={{ objectFit: 'cover' }} />
                  ) : (
                    <IconWorld size={22} style={{ opacity: 0.45 }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t-strong truncate">{s.levelName}</div>
                  <div className="t-meta truncate">{s.folderName}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className="chip">{s.versionId === '' ? '全局' : s.versionId}</span>
                  {s.isolated && <span className="chip">隔离</span>}
                </div>
                <div className="meta">
                  <span className="meta-k">上次游玩</span>
                  <span className="meta-v">{lastPlayedText(s.lastPlayed)}</span>
                  <span className="meta-k">大小</span>
                  <span className="meta-v">{formatBytes(s.sizeBytes)}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 复制到其他版本：选目标版本 */}
      <Modal
        open={copyTarget !== null}
        title="复制到其他版本"
        onClose={() => setCopyTarget(null)}
        width={440}
        footer={
          <>
            <button className="btn" onClick={() => setCopyTarget(null)}>
              取消
            </button>
            <button
              className="btn btn-primary"
              style={{ fontWeight: 600 }}
              disabled={copyTarget === null || copyTarget === '__pick__'}
              onClick={() => {
                const target = copyTarget
                setCopyTarget(null)
                if (target !== null && target !== '__pick__') void copyToVersion(target)
              }}
            >
              复制
            </button>
          </>
        }
      >
        <div className="t-cap" style={{ marginBottom: 8 }}>
          跨版本复制会新建一份「来自 xxx」的世界副本，原世界不受影响。
        </div>
        <Select
          width={undefined}
          value={copyTarget !== null && copyTarget !== '__pick__' ? copyTarget : ''}
          options={[
            { value: '', label: '选择目标版本…' },
            ...(props.versions ?? []).map((v) => ({ value: v, label: v }))
          ]}
          onChange={setCopyTarget}
        />
      </Modal>

      {host}
    </div>
  )
}
