/// 下载页 · 社区资源（Mod / 整合包 / 数据包 / 资源包 / 光影包）
/// 对齐 Win DownloadPage 的社区检索：中文关键词先翻成英文（Modrinth 项目名都是英文），
/// 按 类型 + 加载器 + 游戏版本 + 排序 搜索；Mod/资源包/光影/数据包装进选中实例，
/// 整合包走「下载 .mrpack 并新建隔离实例」的导入流程。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { onBridgeEvent, request } from '../bridge'
import type { InstalledVersion } from '../bridge'
import { Select, Spinner, useToasts } from '../ui'
import { IconCube, IconDownload, IconRefresh, IconSearch } from '../icons'

interface Hit {
  projectId: string
  slug: string
  title: string
  description: string
  author: string
  downloads: number
  iconUrl?: string
  displayCategories: string[]
  loaders: string[]
  webUrl: string
}

interface SearchResult {
  totalHits: number
  hits: Hit[]
}

const LOADERS = [
  { value: 'auto', label: '加载器：自动' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'forge', label: 'Forge' },
  { value: 'neoforge', label: 'NeoForge' },
  { value: 'quilt', label: 'Quilt' }
]

const SORTS = [
  { value: 'relevance', label: '相关度' },
  { value: 'downloads', label: '下载量' },
  { value: 'updated', label: '最近更新' }
]

const KIND_LABEL: Record<string, string> = {
  mod: 'Mod',
  modpack: '整合包',
  datapack: '数据包',
  resourcepack: '资源包',
  shader: '光影包'
}

function fmtCount(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)} 亿`
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)} 万`
  return String(n)
}

function isCjk(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text)
}

export default function CommunityPanel(props: { kind: string }): JSX.Element {
  const { push, host } = useToasts()
  const [query, setQuery] = useState('')
  const [loader, setLoader] = useState('auto')
  const [gameVersion, setGameVersion] = useState('')
  const [sort, setSort] = useState('relevance')
  const [hits, setHits] = useState<Hit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [instances, setInstances] = useState<InstalledVersion[]>([])
  const [target, setTarget] = useState('')
  const [installing, setInstalling] = useState<{ id: string; stage: string; percent: number } | null>(null)
  const seq = useRef(0)

  const withLoader = props.kind === 'mod' || props.kind === 'modpack'

  useEffect(() => {
    void request<{ installed: InstalledVersion[] }>('catalog.installed')
      .then((r) => {
        setInstances(r.installed)
        // 默认装到「默认版本」，没有默认再退到第一个
        const preferred = r.installed.find((v) => v.isDefault === true) ?? r.installed[0]
        if (preferred !== undefined) setTarget((prev) => (prev === '' ? preferred.id : prev))
      })
      .catch(() => undefined)
  }, [])

  // 安装进度（Mod 等走 content.progress；整合包走 modpack.progress）
  useEffect(() => {
    let alive = true
    onBridgeEvent((event, params) => {
      if (!alive) return
      if (event === 'content.progress') {
        setInstalling((prev) =>
          prev === null ? prev : { ...prev, stage: String(params.stage ?? '安装中') }
        )
      } else if (event === 'modpack.progress') {
        const percent = Number(params.percent ?? -1)
        setInstalling((prev) =>
          prev === null
            ? prev
            : { ...prev, stage: String(params.stage ?? '安装中'), percent }
        )
      }
    })
    return () => {
      alive = false
    }
  }, [])

  const search = useCallback(
    async (reset = true): Promise<void> => {
      const my = ++seq.current
      setLoading(true)
      setHint(null)
      if (reset) setHits([])
      try {
        const q = query.trim()
        let effective = q
        if (q !== '' && isCjk(q)) {
          const t = await request<{
            original: string
            effective: string
            translated: boolean
            source?: string
          }>('content.translate', { query: q })
          effective = t.effective
          if (t.translated) setHint(`「${t.original}」按「${t.effective}」搜索（${t.source ?? '翻译'}）`)
        }
        const r = await request<SearchResult>('content.search', {
          kind: props.kind,
          query: effective,
          loader: withLoader && loader !== 'auto' ? loader : undefined,
          gameVersion: gameVersion.trim() === '' ? undefined : gameVersion.trim(),
          index: sort,
          limit: 20,
          offset: 0
        })
        if (my !== seq.current) return
        setHits(r.hits)
        setTotal(r.totalHits)
      } catch (e) {
        if (my === seq.current) push('error', `搜索失败：${String(e)}`)
      }
      if (my === seq.current) setLoading(false)
    },
    [query, props.kind, loader, gameVersion, sort, withLoader, push]
  )

  // 切类别时自动拉一次默认列表
  useEffect(() => {
    setQuery('')
    setSort('relevance')
    void (async () => {
      setLoading(true)
      try {
        const r = await request<SearchResult>('content.search', {
          kind: props.kind,
          query: '',
          index: 'relevance',
          limit: 20,
          offset: 0
        })
        setHits(r.hits)
        setTotal(r.totalHits)
      } catch (e) {
        push('error', `加载列表失败：${String(e)}`)
      }
      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.kind])

  async function install(hit: Hit): Promise<void> {
    if (installing !== null) return
    setInstalling({ id: hit.projectId, stage: '准备中', percent: -1 })
    try {
      if (props.kind === 'modpack') {
        const r = await request<{ targetId: string; renamed: boolean; summary: string }>(
          'content.installModpack',
          { projectId: hit.projectId }
        )
        push(
          'success',
          `已安装整合包「${hit.title}」为版本「${r.targetId}」${r.renamed ? '（同名已自动改名）' : ''}\n${r.summary}`
        )
        const list = await request<{ installed: InstalledVersion[] }>('catalog.installed')
        setInstances(list.installed)
      } else {
        if (target === '') {
          push('error', '先在「版本」页安装一个游戏版本，再装内容')
          setInstalling(null)
          return
        }
        const r = await request<{ installed: Array<{ title: string; fileName: string }> }>(
          'content.install',
          { kind: props.kind, projectId: hit.projectId, title: hit.title, targetVersionId: target }
        )
        push(
          r.installed.length > 0 ? 'success' : 'info',
          r.installed.length > 0
            ? `${hit.title} 已安装到 ${target}`
            : `${hit.title} 没有找到兼容 ${target} 的版本`
        )
      }
    } catch (e) {
      push('error', `安装失败：${String(e)}`)
    }
    setInstalling(null)
  }

  const targetOptions = useMemo(
    () => instances.map((v) => ({ value: v.id, label: v.id })),
    [instances]
  )

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      {/* 筛选行 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
          <span style={{ position: 'absolute', left: 9, top: 8, opacity: 0.55, display: 'flex' }}>
            <IconSearch size={15} />
          </span>
          <input
            className="input"
            style={{ paddingLeft: 30 }}
            placeholder={`搜索${KIND_LABEL[props.kind] ?? ''}（支持中文，会自动翻成英文）`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void search()
            }}
          />
        </div>
        {withLoader && (
          <Select<string> width={150} value={loader} options={LOADERS} onChange={setLoader} />
        )}
        <input
          className="input"
          style={{ width: 120 }}
          placeholder="游戏版本"
          value={gameVersion}
          onChange={(e) => setGameVersion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void search()
          }}
        />
        <Select<string>
          width={130}
          value={sort}
          options={SORTS}
          onChange={(v) => {
            setSort(v)
            setTimeout(() => void search(), 0)
          }}
        />
        <button className="btn btn-primary btn-sm" disabled={loading} onClick={() => void search()}>
          {loading ? '搜索中…' : '搜索'}
        </button>
      </div>

      {/* 安装目标 + 状态 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        {props.kind !== 'modpack' && (
          <>
            <span className="t-cap">安装到</span>
            <Select<string>
              width={180}
              value={target}
              options={targetOptions.length > 0 ? targetOptions : [{ value: '', label: '没有已安装版本' }]}
              onChange={setTarget}
              disabled={instances.length === 0}
            />
          </>
        )}
        <span className="t-cap" style={{ flex: 1 }}>
          {hint !== null ? hint : total > 0 ? `共 ${total} 个结果` : ''}
        </span>
        <button className="btn btn-sm btn-subtle" onClick={() => void search()} disabled={loading}>
          <IconRefresh size={14} /> 刷新
        </button>
      </div>

      {installing !== null && (
        <div className="info info-info" style={{ marginBottom: 10 }}>
          <Spinner />
          <div className="info-body">
            {installing.stage}
            {installing.percent >= 0 && ` · ${installing.percent}%`}
          </div>
        </div>
      )}

      {/* 结果列表 */}
      <div className="card card-flush" style={{ flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 10px 10px' }}>
          {loading && hits.length === 0 && (
            <div style={{ padding: 10 }}>
              <Spinner size="lg" />
            </div>
          )}
          {!loading && hits.length === 0 && (
            <div className="empty" style={{ minHeight: 160 }}>
              <div className="empty-title">没有找到内容</div>
              <div className="empty-hint">换个关键词，或清空游戏版本筛选再试。</div>
            </div>
          )}
          {hits.map((hit) => (
            <div key={hit.projectId} className="row row-static" style={{ alignItems: 'flex-start' }}>
              <div
                className="icon32"
                style={{ width: 44, height: 44, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}
              >
                {hit.iconUrl !== undefined && hit.iconUrl !== '' ? (
                  <img src={hit.iconUrl} alt="" width={44} height={44} style={{ objectFit: 'cover' }} />
                ) : (
                  <IconCube size={22} style={{ opacity: 0.45 }} />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span className="t-strong truncate">{hit.title}</span>
                  <span className="t-meta" style={{ flexShrink: 0 }}>by {hit.author}</span>
                </div>
                <div
                  className="t-cap"
                  style={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    margin: '2px 0 4px'
                  }}
                >
                  {hit.description}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span className="chip" style={{ height: 18, fontSize: 10 }}>
                    ↓ {fmtCount(hit.downloads)}
                  </span>
                  {hit.loaders.slice(0, 3).map((l) => (
                    <span key={l} className="chip" style={{ height: 18, fontSize: 10 }}>{l}</span>
                  ))}
                  {hit.displayCategories.slice(0, 2).map((c) => (
                    <span key={c} className="chip" style={{ height: 18, fontSize: 10 }}>{c}</span>
                  ))}
                </div>
              </div>
              <button
                className="btn btn-sm"
                style={{ flexShrink: 0 }}
                disabled={installing !== null}
                onClick={() => void install(hit)}
              >
                <IconDownload size={13} /> 安装
              </button>
            </div>
          ))}
        </div>
      </div>
      {host}
    </div>
  )
}
