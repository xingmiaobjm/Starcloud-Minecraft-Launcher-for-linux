/// 实验室三个子工具（对齐 Win LabPage 的三块）：
/// · 彩色文字：文本 + 单色/渐变/彩虹 + 样式码 → Minecraft § 格式代码（Core McText）
/// · 指令助手：模板库 + 参数表单 → 拼好的命令（Core CommandHelper）
/// · 投影社区：多源聚合搜索 → 文件列表 → 下载到 schematics（Core ProjectionCommunityService）
import { useCallback, useEffect, useMemo, useState } from 'react'

import { nativeApi, request } from '../bridge'
import { EmptyState, Modal, Select, SkeletonList, Spinner, Toggle, useToasts } from '../ui'
import { IconSearch, IconRefresh } from '../icons'

// ── 彩色文字 ────────────────────────────────────────────────────────────────

interface PaletteColor {
  code: string
  name: string
  hex: string
}

type ColorMode = 'solid' | 'gradient' | 'rainbow'

const STYLE_LABEL: Array<{ key: keyof Styles; label: string }> = [
  { key: 'bold', label: '粗体' },
  { key: 'italic', label: '斜体' },
  { key: 'underline', label: '下划线' },
  { key: 'strikethrough', label: '删除线' },
  { key: 'obfuscated', label: '随机字' }
]

interface Styles {
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
  obfuscated: boolean
}

export function ColorTextTool(): JSX.Element {
  const { push, host } = useToasts()
  const [palette, setPalette] = useState<PaletteColor[]>([])
  const [mode, setMode] = useState<ColorMode>('solid')
  const [text, setText] = useState('')
  const [hex, setHex] = useState('#FFD322')
  const [fromHex, setFromHex] = useState('#FFD322')
  const [toHex, setToHex] = useState('#00AAFF')
  const [legacy, setLegacy] = useState(false)
  const [exact, setExact] = useState(true)
  const [segment, setSegment] = useState(1)
  const [styles, setStyles] = useState<Styles>({
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    obfuscated: false
  })
  const [output, setOutput] = useState('')

  useEffect(() => {
    void request<{ colors: PaletteColor[] }>('lab.palette')
      .then((r) => setPalette(r.colors))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (text === '') {
      setOutput('')
      return
    }
    let alive = true
    const timer = window.setTimeout(() => {
      void request<{ text: string }>('lab.colorText', {
        text,
        mode,
        hexColor: hex,
        fromHex,
        toHex,
        legacyPalette: legacy,
        exact,
        segmentLength: segment,
        ...styles
      })
        .then((r) => {
          if (alive) setOutput(r.text)
        })
        .catch((e) => {
          if (alive) push('error', `生成失败：${String(e)}`)
        })
    }, 120)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [text, mode, hex, fromHex, toHex, legacy, exact, segment, styles, push])

  async function copy(): Promise<void> {
    if (output === '') return
    try {
      await navigator.clipboard.writeText(output)
      push('success', '已复制 § 格式文本，游戏内直接粘贴')
    } catch (e) {
      push('error', `复制失败：${String(e)}`)
    }
  }

  return (
    <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ width: 4, height: 16, borderRadius: 2, background: 'var(--accent)' }} />
          <span className="t-strong" style={{ fontSize: 15 }}>彩色文字生成器</span>
          <span className="t-cap">输出 § 格式代码，可直接粘贴到聊天 / 告示牌 / title 命令</span>
        </div>

        <textarea
          className="input"
          style={{ height: 90, minHeight: 90, resize: 'vertical' }}
          placeholder="输入要上色的文字…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <Select<ColorMode>
            width={140}
            value={mode}
            options={[
              { value: 'solid', label: '单色' },
              { value: 'gradient', label: '渐变' },
              { value: 'rainbow', label: '彩虹' }
            ]}
            onChange={setMode}
          />

          {mode === 'solid' && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
              颜色
              <input
                className="input"
                style={{ width: 110 }}
                value={hex}
                onChange={(e) => setHex(e.target.value)}
                placeholder="#FFD322"
              />
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : '#ffd322'}
                onChange={(e) => setHex(e.target.value.toUpperCase())}
                style={{ width: 34, height: 30, padding: 2, background: 'transparent', border: 'none' }}
              />
            </label>
          )}

          {mode === 'gradient' && (
            <>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
                起色
                <input className="input" style={{ width: 100 }} value={fromHex} onChange={(e) => setFromHex(e.target.value)} />
                <input type="color" value={/^#[0-9a-f]{6}$/i.test(fromHex) ? fromHex : '#ffd322'} onChange={(e) => setFromHex(e.target.value.toUpperCase())} style={{ width: 34, height: 30, padding: 2, background: 'transparent', border: 'none' }} />
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
                止色
                <input className="input" style={{ width: 100 }} value={toHex} onChange={(e) => setToHex(e.target.value)} />
                <input type="color" value={/^#[0-9a-f]{6}$/i.test(toHex) ? toHex : '#00aaff'} onChange={(e) => setToHex(e.target.value.toUpperCase())} style={{ width: 34, height: 30, padding: 2, background: 'transparent', border: 'none' }} />
              </label>
            </>
          )}

          {mode !== 'solid' && (
            <>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                <input type="checkbox" checked={exact} onChange={(e) => setExact(e.target.checked)} />
                逐字符精确（1.16+）
              </label>
              {!exact && (
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                  每
                  <input
                    className="input"
                    style={{ width: 56 }}
                    type="number"
                    min={1}
                    value={segment}
                    onChange={(e) => setSegment(Math.max(1, Number(e.target.value) || 1))}
                  />
                  字一色
                </label>
              )}
            </>
          )}

          {mode === 'solid' && (
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
              <input type="checkbox" checked={legacy} onChange={(e) => setLegacy(e.target.checked)} />
              用最近的原版色
            </label>
          )}
        </div>

        {/* 原版 16 色：点一下填进当前颜色输入框 */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {palette.map((c) => (
            <button
              key={c.code}
              title={`§${c.code} ${c.name}`}
              onClick={() => {
                if (mode === 'gradient') setFromHex(c.hex)
                else setHex(c.hex)
              }}
              style={{
                width: 22,
                height: 22,
                borderRadius: 4,
                border: '1px solid var(--stroke-strong)',
                background: c.hex,
                cursor: 'pointer'
              }}
            />
          ))}
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
          {STYLE_LABEL.map((s) => (
            <label key={s.key} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
              <Toggle
                checked={styles[s.key]}
                onChange={(v) => setStyles((prev) => ({ ...prev, [s.key]: v }))}
              />
              {s.label}
            </label>
          ))}
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span className="t-cap">生成结果</span>
            <div style={{ flex: 1 }} />
            <button className="btn btn-primary" style={{ fontWeight: 600 }} disabled={output === ''} onClick={() => void copy()}>
              复制
            </button>
          </div>
          <textarea
            className="input"
            readOnly
            style={{ height: 84, minHeight: 84, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            value={output}
            placeholder="输入文字后这里会显示 § 格式代码"
          />
          {output !== '' && (
            <div
              className="t-body"
              style={{ marginTop: 6, padding: '6px 10px', borderRadius: 8, background: 'var(--surface-subtle)' }}
            >
              预览：<span style={{ fontFamily: 'var(--font-mono)' }}>{output}</span>
            </div>
          )}
        </div>
      </div>
      {host}
    </div>
  )
}

// ── 指令助手 ────────────────────────────────────────────────────────────────

interface CommandParam {
  key: string
  label: string
  defaultValue: string
  suggestions: string
  required: boolean
}

interface CommandTemplate {
  id: string
  category: string
  name: string
  template: string
  note: string
  params: CommandParam[]
}

export function CommandTool(): JSX.Element {
  const { push, host } = useToasts()
  const [templates, setTemplates] = useState<CommandTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [command, setCommand] = useState('')
  const [unfilled, setUnfilled] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const r = await request<{ templates: CommandTemplate[] }>('lab.commands')
        setTemplates(r.templates)
        if (r.templates.length > 0) {
          setActiveId(r.templates[0].id)
          const init: Record<string, string> = {}
          for (const p of r.templates[0].params) init[p.key] = p.defaultValue
          setValues(init)
        }
      } catch (e) {
        push('error', `读取指令模板失败：${String(e)}`)
      }
      setLoading(false)
    })()
  }, [push])

  const active = useMemo(
    () => templates.find((t) => t.id === activeId) ?? null,
    [templates, activeId]
  )

  useEffect(() => {
    if (activeId === null) return
    let alive = true
    void request<{ command: string; hasUnfilled: boolean; error?: string }>('lab.buildCommand', {
      templateId: activeId,
      values
    })
      .then((r) => {
        if (!alive) return
        setCommand(r.command)
        setUnfilled(r.hasUnfilled)
        setErrorText(r.error ?? null)
      })
      .catch((e) => {
        if (alive) push('error', String(e))
      })
    return () => {
      alive = false
    }
  }, [activeId, values, push])

  function pickTemplate(t: CommandTemplate): void {
    setActiveId(t.id)
    const init: Record<string, string> = {}
    for (const p of t.params) init[p.key] = p.defaultValue
    setValues(init)
    setCopied(false)
  }

  const categories = useMemo(() => [...new Set(templates.map((t) => t.category))], [templates])

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch (e) {
      push('error', `复制失败：${String(e)}`)
    }
  }

  return (
    <div className="page-body" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      {/* 左：模板列表 */}
      <div className="card card-flush" style={{ width: 260, flexShrink: 0 }}>
        <div className="card-head">
          <span className="card-title">指令模板</span>
          <span className="chip">{templates.length}</span>
        </div>
        <div style={{ padding: '0 8px 10px', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
          {loading && <SkeletonList rows={4} />}
          {categories.map((cat) => (
            <div key={cat}>
              <div className="t-cap" style={{ margin: '8px 8px 4px' }}>{cat}</div>
              {templates
                .filter((t) => t.category === cat)
                .map((t) => (
                  <button
                    key={t.id}
                    className={`nav-item${t.id === activeId ? ' nav-active' : ''}`}
                    style={{ height: 32, width: '100%', fontSize: 13 }}
                    onClick={() => pickTemplate(t)}
                  >
                    <span className="truncate">{t.name}</span>
                  </button>
                ))}
            </div>
          ))}
        </div>
      </div>

      {/* 右：参数 + 结果 */}
      <div className="card" style={{ flex: 1, minWidth: 0 }}>
        {active === null ? (
          <EmptyState title="选择一个模板" hint="左侧按分类列出常用指令。" />
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span className="t-strong" style={{ fontSize: 15 }}>{active.name}</span>
              <span className="chip">{active.category}</span>
              <div style={{ flex: 1 }} />
              <span className="t-mono" style={{ fontSize: 11, opacity: 0.6 }}>{active.template}</span>
            </div>
            {active.note !== '' && (
              <div className="t-cap" style={{ marginBottom: 10 }}>{active.note}</div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 12px', alignItems: 'center' }}>
              {active.params.map((p) => (
                <TemplateInput
                  key={p.key}
                  param={p}
                  value={values[p.key] ?? ''}
                  onChange={(v) => setValues((prev) => ({ ...prev, [p.key]: v }))}
                />
              ))}
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span className="t-cap">生成的命令</span>
                {unfilled && <span className="chip chip-danger">还有占位符没填</span>}
                {errorText !== null && <span className="chip chip-danger">{errorText}</span>}
                <div style={{ flex: 1 }} />
                <button className="btn btn-primary" style={{ fontWeight: 600 }} onClick={() => void copy()}>
                  {copied ? '已复制' : '复制命令'}
                </button>
              </div>
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: 'var(--surface-subtle)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12.5,
                  wordBreak: 'break-all',
                  minHeight: 40
                }}
              >
                /{command}
              </div>
            </div>
          </>
        )}
      </div>
      {host}
    </div>
  )
}

function TemplateInput(props: {
  param: CommandParam
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  const chips = props.param.suggestions
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
  return (
    <>
      <label className="t-cap" style={{ fontSize: 12 }}>
        {props.param.label}
        {props.param.required && <span style={{ color: 'var(--danger)' }}> *</span>}
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <input
          className="input"
          value={props.value}
          placeholder={props.param.defaultValue}
          onChange={(e) => props.onChange(e.target.value)}
        />
        {chips.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {chips.map((c) => (
              <button
                key={c}
                className="chip"
                style={{ cursor: 'pointer' }}
                onClick={() => props.onChange(c)}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ── 投影社区 ────────────────────────────────────────────────────────────────

interface CommunityItem {
  source: string
  name: string
  author: string
  description: string
  stars: number
  updatedAt: string
  fullName: string
  htmlUrl: string
  imageUrl: string
}

interface CommunityFile {
  name: string
  sizeBytes: number
  downloadUrl: string
}

export function CommunityTool(): JSX.Element {
  const { push, host } = useToasts()
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<CommunityItem[] | null>(null)
  const [failed, setFailed] = useState<string[]>([])
  const [sources, setSources] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [files, setFiles] = useState<{ item: CommunityItem; list: CommunityFile[] } | null>(null)
  const [filesOpen, setFilesOpen] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)

  const search = useCallback(
    async (force: boolean): Promise<void> => {
      setLoading(true)
      try {
        const r = await request<{ items: CommunityItem[]; failedSources: string[]; sources: string[] }>(
          'lab.communitySearch',
          { query, forceRefresh: force }
        )
        setItems(r.items)
        setFailed(r.failedSources)
        setSources(r.sources)
      } catch (e) {
        push('error', `搜索失败：${String(e)}`)
        setItems([])
      }
      setLoading(false)
    },
    [query, push]
  )

  useEffect(() => {
    void search(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function openFiles(item: CommunityItem): Promise<void> {
    setFilesOpen(true)
    setFiles({ item, list: [] })
    try {
      const r = await request<{ files: CommunityFile[] }>('lab.communityFiles', { item })
      setFiles({ item, list: r.files })
    } catch (e) {
      push('error', `读取文件失败：${String(e)}`)
      setFiles({ item, list: [] })
    }
  }

  async function download(file: CommunityFile): Promise<void> {
    setDownloading(file.downloadUrl)
    try {
      const r = await request<{ path: string }>('lab.communityDownload', {
        fileName: file.name,
        sizeBytes: file.sizeBytes,
        downloadUrl: file.downloadUrl
      })
      push('success', `已下载到 ${r.path}`)
    } catch (e) {
      push('error', `下载失败：${String(e)}`)
    }
    setDownloading(null)
  }

  return (
    <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{ width: 4, height: 16, borderRadius: 2, background: 'var(--accent)' }} />
          <span className="t-strong" style={{ fontSize: 15 }}>投影社区</span>
          <span className="t-cap">
            来源：{sources.length > 0 ? sources.join(' · ') : 'GitHub'}
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-subtle" disabled={loading} onClick={() => void search(true)}>
            <IconRefresh size={14} /> 刷新
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <span style={{ position: 'absolute', left: 9, top: 8, opacity: 0.55, display: 'flex' }}>
              <IconSearch size={15} />
            </span>
            <input
              className="input"
              style={{ paddingLeft: 30 }}
              placeholder="搜索投影（关键字，可留空看热门）"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void search(true)
              }}
            />
          </div>
          <button className="btn btn-primary" style={{ fontWeight: 600 }} disabled={loading} onClick={() => void search(true)}>
            {loading ? '搜索中…' : '搜索'}
          </button>
        </div>
        {failed.length > 0 && (
          <div className="t-cap" style={{ marginTop: 8, color: 'var(--warning)' }}>
            部分来源不可用：{failed.join('、')}
          </div>
        )}
      </div>

      <div className="card card-flush" style={{ flex: 1, minHeight: 0 }}>
        <div style={{ padding: 14, overflowY: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
          {loading && <SkeletonList rows={4} />}
          {!loading && items !== null && items.length === 0 && (
            <EmptyState
              title="没有找到投影"
              hint="换个关键词再试；也可以在设置里配置自定义镜像源。"
            />
          )}
          {!loading && items !== null && items.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
              {items.map((item) => (
                <div
                  key={item.fullName + item.source}
                  className="card"
                  style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}
                >
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    {item.imageUrl !== '' ? (
                      <img
                        src={item.imageUrl}
                        alt=""
                        style={{ width: 52, height: 52, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
                        onError={(e) => {
                          ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                        }}
                      />
                    ) : (
                      <span
                        style={{
                          width: 52,
                          height: 52,
                          borderRadius: 8,
                          background: 'var(--surface-subtle)',
                          flexShrink: 0
                        }}
                      />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div className="t-strong truncate" title={item.name}>{item.name}</div>
                      <div className="t-cap truncate">{item.author}</div>
                      <div className="t-cap">★ {item.stars}</div>
                    </div>
                  </div>
                  <div className="t-cap" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 32 }}>
                    {item.description}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-sm" style={{ flex: 1 }} onClick={() => void openFiles(item)}>
                      文件…
                    </button>
                    <button
                      className="btn btn-sm"
                      title={item.htmlUrl}
                      onClick={() => {
                        const api = nativeApi()
                        if (api === null) {
                          push('info', item.htmlUrl)
                          return
                        }
                        void api.openExternal(item.htmlUrl).catch(() => push('info', item.htmlUrl))
                      }}
                    >
                      主页
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal
        open={filesOpen}
        title={files?.item.name ?? '投影文件'}
        onClose={() => setFilesOpen(false)}
        width={520}
        footer={
          <button className="btn" onClick={() => setFilesOpen(false)}>
            关闭
          </button>
        }
      >
        {files === null ? (
          <Spinner />
        ) : files.list.length === 0 ? (
          <EmptyState title="没有可下载的文件" hint="这个仓库里没有找到 .litematic / .schematic。" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
            {files.list.map((f) => (
              <div key={f.downloadUrl} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span className="t-body truncate" style={{ flex: 1 }}>{f.name}</span>
                <span className="t-meta" style={{ flexShrink: 0 }}>
                  {(f.sizeBytes / 1024).toFixed(0)} KB
                </span>
                <button
                  className="btn btn-sm btn-primary"
                  disabled={downloading === f.downloadUrl}
                  onClick={() => void download(f)}
                >
                  {downloading === f.downloadUrl ? '下载中…' : '下载'}
                </button>
              </div>
            ))}
          </div>
        )}
      </Modal>
      {host}
    </div>
  )
}
