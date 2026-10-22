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
