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

// ── 世吞生成器（Win LabPage「本地离线生成：TNT 爆破阵列」，spec 04 §3.4 / 差异 #30#31） ──
//
// TODO(接线)：本组件已完成参数面板 + TNT 估算 + 生成调用，等 Lab.tsx 在投影工坊
// 分区挂载 <WorldEaterTool /> 即可替换原先固定参数的「生成世吞模板」按钮。

interface WorldEaterParams {
  length: number
  width: number
  layers: number
  spacing: number
  layerGap: number
  offset: number
}

/** 6 参数面板定义（Win 04 §3.4 表格：名称 / 范围 / 默认值照抄）。 */
const WORLD_EATER_PARAMS: Array<{
  key: keyof WorldEaterParams
  label: string
  min: number
  max: number
  def: number
}> = [
  { key: 'length', label: '长度（X）', min: 1, max: 512, def: 64 },
  { key: 'width', label: '宽度（Z）', min: 1, max: 512, def: 16 },
  { key: 'layers', label: '层数', min: 1, max: 32, def: 3 },
  { key: 'spacing', label: '同层间隔', min: 1, max: 16, def: 2 },
  { key: 'layerGap', label: '层间空层', min: 0, max: 16, def: 1 },
  { key: 'offset', label: '逐层错位（Z）', min: -64, max: 64, def: 2 }
]

/** 参数体检（后端 WorldEater.Validate 的报错文案照抄，估算行 / 提交前共用）。 */
function worldEaterValidate(p: WorldEaterParams): string | null {
  if (p.length < 1 || p.length > 512) return '长度需在 1~512 之间'
  if (p.width < 1 || p.width > 512) return '宽度需在 1~512 之间'
  if (p.layers < 1 || p.layers > 32) return '层数需在 1~32 之间'
  if (p.spacing < 1 || p.spacing > 16) return '间隔需在 1~16 之间'
  if (p.layerGap < 0 || p.layerGap > 16) return '层间距需在 0~16 之间'
  if (Math.abs(p.offset) > 512) return '错位量过大'
  return null
}

/** TNT 估算（WorldEater.EstimateTntCount 同公式：每层 ceil(尺寸/间隔) 网格 × 层数）。 */
function worldEaterEstimate(p: WorldEaterParams): number {
  const perLayerX = Math.ceil(p.length / p.spacing)
  const perLayerZ = Math.ceil(p.width / p.spacing)
  return perLayerX * perLayerZ * p.layers
}

export function WorldEaterTool(): JSX.Element {
  const { push, host } = useToasts()
  // 默认值与 Win 端 NumberBox 一致（64/16/3/2/1/2）
  const [params, setParams] = useState<WorldEaterParams>({
    length: 64,
    width: 16,
    layers: 3,
    spacing: 2,
    layerGap: 1,
    offset: 2
  })
  const [generating, setGenerating] = useState(false)

  // 任一参数变更即刷新估算（Win UpdateEaterEstimate：出错显示「参数有误：{0}」）
  const validateError = worldEaterValidate(params)
  const estimate = validateError === null ? worldEaterEstimate(params) : 0
  // 体积同 Win 口径：X=长，Y=层数+层间空层×(层数-1)，Z=宽+|逐层错位×(层数-1)|
  const sizeY = params.layers + params.layerGap * (params.layers - 1)
  const sizeZ = params.width + Math.abs(params.offset * (params.layers - 1))

  function setParam(key: keyof WorldEaterParams, raw: string): void {
    const n = Math.round(Number(raw))
    setParams((prev) => ({ ...prev, [key]: Number.isFinite(n) ? n : prev[key] }))
  }

  async function generate(): Promise<void> {
    const err = worldEaterValidate(params)
    if (err !== null) {
      push('error', err) // Win：校验失败 → ErrorBar 原文，不发起生成
      return
    }
    setGenerating(true)
    try {
      // TODO(Win 04 §3.4 #10)：Win 生成到投影目录并按
      // 「世吞阵列-{长}x{宽}x{层}层-{yyyyMMdd-HHmmss}.litematic」命名；
      // 桥接 lab.worldEater 目前只收这 6 个参数，文件名与落盘目录由后端决定
      // （world-eater-<时间戳>.litematic → 启动器数据目录），待桥接补 dest 参数后对齐。
      const r = await request<{ ok: boolean; path: string }>('lab.worldEater', { ...params })
      const fileName = r.path.split(/[\\/]/).pop() ?? r.path
      push('success', `已生成 ${fileName}（${estimate.toLocaleString()} 个 TNT）`)
    } catch (e) {
      push('error', `生成失败：${String(e)}`)
    }
    setGenerating(false)
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ width: 4, height: 16, borderRadius: 2, background: 'var(--accent)' }} />
        <span className="t-strong" style={{ fontSize: 15 }}>本地离线生成：TNT 爆破阵列</span>
      </div>
      <div className="t-cap" style={{ marginBottom: 12 }}>
        离线可用的简易工具：按参数铺分层 TNT 阵列，用于地形清理或作为自建机器的药室参照。
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 10
        }}
      >
        {WORLD_EATER_PARAMS.map((p) => (
          <label
            key={p.key}
            style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}
          >
            <span className="t-cap">{p.label}</span>
            <input
              className="input"
              type="number"
              min={p.min}
              max={p.max}
              step={1}
              value={params[p.key]}
              onChange={(e) => setParam(p.key, e.target.value)}
            />
          </label>
        ))}
      </div>
      <div
        className="t-body"
        style={{
          marginTop: 12,
          padding: '6px 10px',
          borderRadius: 8,
          background: 'var(--surface-subtle)',
          color: validateError === null ? 'var(--text-primary)' : 'var(--danger)'
        }}
      >
        {validateError !== null
          ? `参数有误：${validateError}`
          : `预计 TNT ${estimate.toLocaleString()} 个（体积 ${params.length}×${sizeY}×${sizeZ}）`}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button
          className="btn btn-primary"
          style={{ fontWeight: 600 }}
          disabled={generating || validateError !== null}
          onClick={() => void generate()}
        >
          {generating ? '生成中…' : '生成 .litematic…'}
        </button>
      </div>
      {host}
    </div>
  )
}

// ── 指令助手 ────────────────────────────────────────────────────────────────
