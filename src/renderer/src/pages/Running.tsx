/// 运行状态页：对齐 Win 0.3.8 RunningStatusPage —— 数据源是桥接里的
/// Core 单例 GameRuntimeMonitor（1s 采样 / 跨启动器重启恢复 / 结束进程）。
///
/// 版式：页头（刷新 + 采样设置）→ 运行卡（实例/运行时长/模式/内存/启动时间 +
/// 打开日志/诊断/复制命令/重启/结束进程）→ CPU/内存/GPU 三张曲线卡 →
/// 启动配置与 JVM + 内容与实时日志。
/// `runtime.changed` 事件每秒推一帧快照；运行时长的秒表由本地 1s 计时器兜底。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { onBridgeEvent, request } from '../bridge'
import type { DiagReport, RuntimeInstance, RuntimeSample, RuntimeState } from '../bridge'
import { InfoBar, Modal, Select, useToasts, useContextMenu } from '../ui'
import { IconChevronDown, IconRefresh } from '../icons'

function fmtBytes(bytes: number): string {
  if (bytes <= 0) return '—'
  const mb = 1024 * 1024
  return bytes >= 1024 * mb
    ? `${(bytes / (1024 * mb)).toFixed(2)} GB`
    : `${(bytes / mb).toFixed(0)} MB`
}

function fmtUptime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

function fmtStarted(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 曲线：归一化到 0..1（CPU/GPU 固定 0–100，内存按窗口自适应，同 Win Draw()）。 */
function Spark(props: { values: number[]; fixed?: boolean }): JSX.Element {
  const { values, fixed } = props
  const points = useMemo(() => {
    const n = values.length
    if (n < 2) return ''
    let min: number
    let max: number
    if (fixed === true) {
      min = 0
      max = 100
    } else {
      min = Math.min(...values)
      max = Math.max(...values)
      const span = max - min
      const pad = span > 0 ? span * 0.08 : Math.max(1, max * 0.02)
      min = Math.max(0, min - pad)
      max += pad
    }
    if (max <= min) max = min + 1
    return values
      .map((v, i) => {
        const norm = Math.min(1, Math.max(0, (v - min) / (max - min)))
        return `${(i * 100) / (n - 1)},${39 - norm * 38}`
      })
      .join(' ')
  }, [values, fixed])

  return (
    <svg
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      style={{ width: '100%', height: 44, display: 'block' }}
      aria-hidden
    >
      {points !== '' && (
        <polyline
          points={points}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.4"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </svg>
  )
}

function StatCard(props: {
  title: string
  value: string
  sub: string
  samples: RuntimeSample[]
  pick: (s: RuntimeSample) => number | undefined
  fixed?: boolean
  paused: boolean
}): JSX.Element {
  const values = props.samples
    .map(props.pick)
    .filter((v): v is number => v !== undefined)
  return (
    <div className="card" style={{ flex: 1, minWidth: 0, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span className="t-cap" style={{ fontSize: 12 }}>{props.title}</span>
        {props.paused && <span className="chip chip-danger">采样暂停</span>}
      </div>
      <div style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.15 }}>{props.value}</div>
      <Spark values={values} fixed={props.fixed} />
      <div className="t-cap" style={{ marginTop: 4, fontSize: 11 }}>{props.sub}</div>
    </div>
  )
}

export default function RunningPage(props: {
  onGoHome: () => void
  onOpenLogs: () => void
  onRestart: (versionId: string) => void
}): JSX.Element {
  const { push, host } = useToasts()
  const [rt, setRt] = useState<RuntimeState | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [nowTick, setNowTick] = useState(0)
  const [diag, setDiag] = useState<{ kind: 'success' | 'warning' | 'error'; text: string } | null>(null)
  const [diagBusy, setDiagBusy] = useState(false)
  const [confirmKill, setConfirmKill] = useState<RuntimeInstance | null>(null)
  const [confirmRestart, setConfirmRestart] = useState<RuntimeInstance | null>(null)
  const [copied, setCopied] = useState(false)
  const logRef = useRef<HTMLDivElement | null>(null)

  const current = useMemo(() => {
    if (rt === null) return null
    return rt.instances.find((i) => i.pid === rt.selectedPid) ?? rt.instances[0] ?? null
  }, [rt])

  const loadLogs = useCallback(async (): Promise<void> => {
    try {
      const r = await request<{ lines: string[] }>('runtime.logs', { lines: 200 })
      setLogs(r.lines)
    } catch {
      /* 日志读失败不打断采样展示 */
    }
  }, [])

  const load = useCallback(async (): Promise<void> => {
    try {
      setRt(await request<RuntimeState>('runtime.state'))
    } catch (e) {
      push('error', `读取运行状态失败：${String(e)}`)
    }
    await loadLogs()
  }, [loadLogs, push])

  useEffect(() => {
    void load()
    onBridgeEvent((event, params) => {
      if (event === 'runtime.changed') setRt(params as unknown as RuntimeState)
    })
    // 事件是推送；订阅前的日志尾与暂停时的兜底由轮询补齐
    const poll = window.setInterval(() => void loadLogs(), 2000)
    const tick = window.setInterval(() => setNowTick((n) => n + 1), 1000)
    return () => {
      window.clearInterval(poll)
      window.clearInterval(tick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 日志吸底（用户翻上去时不打扰）
  useEffect(() => {
    const el = logRef.current
    if (el === null) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) {
      el.scrollTop = el.scrollHeight
    }
  }, [logs, nowTick])

  const sampleMenu = useContextMenu([
    ...([1000, 2000, 5000] as const).map((ms) => ({
      label: `${ms / 1000} 秒${(rt?.intervalMs ?? 0) === ms ? ' ✓' : ''}`,
      onSelect: () => {
        void request<RuntimeState>('runtime.interval', { ms })
          .then(setRt)
          .catch((e) => push('error', String(e)))
      }
    })),
    { label: '', separator: true },
    {
      label: rt?.collectGpu === true ? '采集 GPU ✓' : '采集 GPU',
      onSelect: () => {
        void request<RuntimeState>('runtime.gpu', { enabled: !(rt?.collectGpu === true) })
          .then(setRt)
          .catch((e) => push('error', String(e)))
      }
    }
  ])

  async function diagnose(): Promise<void> {
    setDiagBusy(true)
    setDiag(null)
    try {
      const report = await request<DiagReport>('runtime.diagnose')
      if (report.issues.length === 0) {
        setDiag({ kind: 'success', text: `扫描 ${report.scannedCount} 个版本，未发现问题` })
      } else {
        const head = `发现 ${report.issues.length} 个问题（扫描 ${report.scannedCount} 个版本）：`
        const body = report.issues
          .slice(0, 20)
          .map((i) => `${i.versionId} · ${i.kind} · ${i.detail}`)
          .join('\n')
        setDiag({ kind: 'warning', text: `${head}\n${body}` })
      }
    } catch (e) {
      setDiag({ kind: 'error', text: `诊断失败：${String(e)}` })
    }
    setDiagBusy(false)
  }

  async function copyCommand(): Promise<void> {
    const cmd = rt?.commandLine
    if (cmd === undefined || cmd === '') return
    try {
      await navigator.clipboard.writeText(cmd)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch (e) {
      push('error', `复制失败：${String(e)}`)
    }
  }

  async function kill(pid: number): Promise<void> {
    try {
      await request('runtime.kill', { pid })
      push('info', '已结束游戏进程')
      await load()
    } catch (e) {
      push('error', `结束失败：${String(e)}`)
    }
    setConfirmKill(null)
  }

  async function restart(inst: RuntimeInstance): Promise<void> {
    try {
      await request('runtime.kill', { pid: inst.pid })
      props.onRestart(inst.versionId)
    } catch (e) {
      push('error', `重启失败：${String(e)}`)
    }
    setConfirmRestart(null)
  }

  function selectInstance(pid: string): void {
    void request<RuntimeState>('runtime.select', { pid: Number(pid) })
      .then((r) => {
        setRt(r)
        setLogs([])
        void loadLogs()
      })
      .catch((e) => push('error', String(e)))
  }

  const ctx = rt?.context
  const uptimeText =
    current === null ? '00:00:00' : fmtUptime(current.uptimeSec + nowTick)

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ flex: 1 }} />
        <button className="btn btn-subtle" title="刷新" onClick={() => void load()}>
          <IconRefresh size={15} />
        </button>
        <button
          className="btn"
          title="采样设置"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            sampleMenu.open(r.right - 180, r.bottom + 6)
          }}
        >
          采样设置 <IconChevronDown size={14} />
        </button>
      </div>

      {rt === null ? (
        <div className="card" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span className="spinner spinner-lg" />
        </div>
      ) : current === null ? (
        <div className="card" style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="empty" style={{ minHeight: 0 }}>
            <div
              style={{
                fontFamily: 'var(--font-icon)',
                fontSize: 40,
                color: 'var(--text-tertiary)',
                lineHeight: 1
              }}
            >
              {String.fromCharCode(0xec3b)}
            </div>
            <div className="empty-title" style={{ fontSize: 16 }}>现在没有游戏在运行</div>
            <div className="empty-hint">去首页启动一个版本</div>
            <button className="btn btn-primary" onClick={props.onGoHome}>去首页</button>
          </div>
        </div>
      ) : (
        <>
          {diag !== null && (
            <div style={{ marginBottom: 12 }}>
              <InfoBar
                kind={diag.kind === 'success' ? 'success' : diag.kind === 'warning' ? 'warning' : 'error'}
                onDismiss={() => setDiag(null)}
              >
                <div style={{ whiteSpace: 'pre-wrap' }}>{diag.text}</div>
              </InfoBar>
            </div>
          )}

          {/* 运行卡（Win HeroCard） */}
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span className="chip chip-accent" style={{ height: 24, padding: '0 10px' }}>运行中</span>
              {rt.instances.length > 1 ? (
                <Select<string>
                  width={260}
                  value={String(current.pid)}
                  options={rt.instances.map((i) => ({
                    value: String(i.pid),
                    label: `${i.versionId}（pid ${i.pid}）`
                  }))}
                  onChange={selectInstance}
                />
              ) : (
                <span className="t-strong" style={{ fontSize: 15 }}>{current.versionId}</span>
              )}
              <span className="t-cap">已运行 {uptimeText}</span>
              {current.recovered && <span className="chip">上一轮启动器拉起</span>}
              {rt.samplingPaused && <span className="chip chip-danger">采样暂停</span>}
              <div style={{ flex: 1 }} />
              <button className="btn" onClick={props.onOpenLogs}>打开日志</button>
              <button className="btn" disabled={diagBusy} onClick={() => void diagnose()}>
                {diagBusy ? '诊断中…' : '诊断'}
              </button>
              <button
                className="btn"
                disabled={rt.commandLine === undefined || rt.commandLine === ''}
                title={rt.commandLine ?? '这是上一轮启动器启动的会话，拿不到命令行'}
                onClick={() => void copyCommand()}
              >
                {copied ? '已复制' : '复制命令'}
              </button>
              <button className="btn" onClick={() => setConfirmRestart(current)}>重启</button>
              <button
                className="btn"
                style={{ color: 'var(--danger)' }}
                onClick={() => setConfirmKill(current)}
              >
                结束进程
              </button>
            </div>

            <div style={{ display: 'flex', gap: 36, marginTop: 14, flexWrap: 'wrap' }}>
              <div>
                <div className="t-cap" style={{ fontSize: 11 }}>实例模式</div>
                <div className="t-body">
                  {ctx === undefined
                    ? '—'
                    : ctx.isolation === 'isolated'
                      ? '隔离实例'
                      : '共享 .minecraft'}
                </div>
              </div>
              <div>
                <div className="t-cap" style={{ fontSize: 11 }}>内存</div>
                <div className="t-body">{ctx === undefined ? '—' : `${ctx.max_memory_mb} MB`}</div>
              </div>
              <div>
                <div className="t-cap" style={{ fontSize: 11 }}>启动时间</div>
                <div className="t-body">{fmtStarted(current.startedAt)}</div>
              </div>
            </div>
          </div>

          {/* 性能三卡 */}
          <div style={{ display: 'flex', gap: 14, marginBottom: 14 }}>
            <StatCard
              title="处理器占用"
              value={`${current.cpuPercent.toFixed(1)}%`}
              sub={`${current.threadCount} 线程`}
              samples={rt.samples}
              pick={(s) => s.cpuPercent}
              fixed
              paused={rt.samplingPaused}
            />
            <StatCard
              title="内存占用"
              value={fmtBytes(current.workingSetBytes)}
              sub={`峰值 ${fmtBytes(current.peakWorkingSetBytes)} · ${current.threadCount} 线程`}
              samples={rt.samples}
              pick={(s) => s.workingSetBytes}
              paused={rt.samplingPaused}
            />
            <StatCard
              title="显卡占用"
              value={current.gpuPercent !== undefined ? `${current.gpuPercent.toFixed(1)}%` : '--'}
              sub={
                current.gpuPercent !== undefined
                  ? 'GPU 引擎占用'
                  : rt.collectGpu
                    ? '计数器不可用'
                    : '未采集 GPU'
              }
              samples={rt.samples}
              pick={(s) => s.gpuPercent}
              fixed
              paused={rt.samplingPaused}
            />
          </div>

          {/* 启动配置 + 内容与日志 */}
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div className="card" style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ width: 4, height: 16, borderRadius: 2, background: 'var(--accent)' }} />
                <span className="t-strong" style={{ fontSize: 15 }}>启动配置与 JVM</span>
                {rt.contextFallback && <span className="chip">按当前配置估算</span>}
              </div>
              <ConfigRow
                label="Java"
                value={ctx === undefined || ctx.java_path === '' ? '自动选择' : ctx.java_path}
                mono
              />
              <ConfigRow
                label="内存"
                value={ctx === undefined ? '—' : `-Xmx ${ctx.max_memory_mb} MB · -Xms ${ctx.min_memory_mb} MB`}
              />
              <ConfigRow
                label="窗口"
                value={
                  ctx === undefined
                    ? '—'
                    : ctx.fullscreen
                      ? '全屏'
                      : ctx.window_width > 0 && ctx.window_height > 0
                        ? `${ctx.window_width} × ${ctx.window_height}`
                        : '默认窗口'
                }
              />
              <ConfigRow
                label="实例模式"
                value={ctx === undefined ? '—' : ctx.isolation === 'isolated' ? '隔离实例' : '共享 .minecraft'}
              />
              <ConfigRow
                label="额外 JVM 参数"
                value={
                  ctx === undefined || ctx.extra_jvm_args.length === 0
                    ? '无'
                    : ctx.extra_jvm_args.join('\n')
                }
                mono
              />
            </div>

            <div className="card" style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ width: 4, height: 16, borderRadius: 2, background: 'var(--accent)' }} />
                <span className="t-strong" style={{ fontSize: 15 }}>内容与实时日志</span>
                <div style={{ flex: 1 }} />
                <span className="chip">Mod {ctx?.mod_count ?? 0}</span>
                <span className="chip">着色器 {ctx?.shader_pack_count ?? 0}</span>
                <span className="chip">资源包 {ctx?.resource_pack_count ?? 0}</span>
              </div>
              <div
                ref={logRef}
                className="log"
                style={{
                  height: 320,
                  overflowY: 'auto',
                  background: 'var(--surface-subtle)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 11.5
                }}
              >
                {logs.length === 0 ? (
                  <div className="t-cap">还没有日志输出。</div>
                ) : (
                  logs.map((line, i) => (
                    <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {line}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {sampleMenu.node}

      <Modal
        open={confirmKill !== null}
        title="结束游戏进程"
        onClose={() => setConfirmKill(null)}
        width={420}
        footer={
          <>
            <button className="btn" onClick={() => setConfirmKill(null)}>取消</button>
            <button
              className="btn"
              style={{ background: 'var(--danger)', color: '#fff' }}
              onClick={() => confirmKill !== null && void kill(confirmKill.pid)}
            >
              结束进程
            </button>
          </>
        }
      >
        将强制结束 {confirmKill?.versionId}（PID {confirmKill?.pid}），未保存的进度会丢失。
      </Modal>

      <Modal
        open={confirmRestart !== null}
        title="重启游戏"
        onClose={() => setConfirmRestart(null)}
        width={420}
        footer={
          <>
            <button className="btn" onClick={() => setConfirmRestart(null)}>取消</button>
            <button
              className="btn btn-primary"
              style={{ fontWeight: 600 }}
              onClick={() => confirmRestart !== null && void restart(confirmRestart)}
            >
              重启
            </button>
          </>
        }
      >
        将结束当前进程，并回到首页用 {confirmRestart?.versionId} 重新启动。
      </Modal>

      {host}
    </div>
  )
}

function ConfigRow(props: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', gap: 12, padding: '4px 0' }}>
      <span className="t-cap" style={{ fontSize: 12 }}>{props.label}</span>
      <span
        className="t-body"
        style={{
          fontFamily: props.mono === true ? 'var(--font-mono)' : undefined,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all'
        }}
      >
        {props.value}
      </span>
    </div>
  )
}
