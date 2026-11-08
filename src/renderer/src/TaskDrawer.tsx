/// 调度中心（Win 端 MainWindow 右侧任务抽屉的等价物，0.3.7 版式）：
/// 宽面板 ≈ 46% 窗宽；头部「图标 + 标题 + 副标题（N 个任务进行中 · M 条通知）+ 关闭」；
/// 调度队列（任务卡：黄点 + 标题 + 右侧状态/百分比 + 进度条 + 多源「各源贡献」分段带）；
/// 历史通知（时间 + 级别 + 消息，左边条三档配色，右上「清空通知」）；
/// 空队列时居中一个列表图标 + 「无」。
import { useEffect, useState } from 'react'

import { onBridgeEvent } from './bridge'
import { ProgressBar } from './ui'
import type { GameSessionApi } from './state/session'
import type { NotificationItem, TaskItem } from './state/tasks'

interface Entry {
  key: string
  title: string
  status?: string
  hint?: string
  progress?: number
  failed?: boolean
  done?: boolean
}

/** 多源竞速的单源贡献（Win 01#17：「各源贡献」分段带的数据源）。 */
interface SourceShare {
  name: string
  bytes: number
}

/**
 * 通知三档配色（Win 01#16：信息=Attention/警告=Caution 琥珀/错误=Critical →
 * 左边条与级别标签同色）。级别目前只有 信息/错误，警告档为未来事件预留。
 */
const NOTICE_TONE: Record<string, string> = {
  信息: 'var(--info)',
  警告: 'var(--warning)',
  错误: 'var(--danger)'
}

/**
 * install.progress 若带各源字节信息（params.sources）则解析成分段带数据；
 * 事件里没有 source 信息时返回空数组，分段带整体隐藏（桥接现状即如此）。
 */
function parseSourceShares(params: Record<string, unknown>): SourceShare[] {
  const raw = params.sources
  if (!Array.isArray(raw)) return []
  const out: SourceShare[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const o = item as Record<string, unknown>
    const name =
      typeof o.name === 'string' ? o.name : typeof o.source === 'string' ? o.source : ''
    const bytes =
      typeof o.bytes === 'number'
        ? o.bytes
        : typeof o.downloaded === 'number'
          ? o.downloaded
          : 0
    if (name !== '' && bytes > 0) out.push({ name, bytes })
  }
  return out
}

/** 分段带配色（Win 01#17）：领先源（第 0 位）accent 实心，其余中性色透明度 max(0.35, 0.85−名次×0.15)。 */
function segmentTone(index: number): React.CSSProperties {
  return {
    background: index === 0 ? 'var(--accent)' : 'var(--text-tertiary)',
    opacity: index === 0 ? 1 : Math.max(0.35, 0.85 - index * 0.15)
  }
}

export default function TaskDrawer(props: {
  open: boolean
  tasks: TaskItem[]
  notifications: NotificationItem[]
  session: GameSessionApi
  onClearNotifications: () => void
  onClose: () => void
}): JSX.Element | null {
  // 各源贡献快照（任务 id → 源列表）：install.progress 事件若带 sources 才记录，
  // 抽屉关着也收（打开时立刻有带可画）；事件无 source 信息则永远为空 → 分段带隐藏。
  const [sourceShares, setSourceShares] = useState<Record<string, SourceShare[]>>({})
  useEffect(() => {
    onBridgeEvent((event, params) => {
      if (event !== 'install.progress') return
      const id = String(params.versionId ?? params.projectId ?? '')
      if (id === '') return
      const shares = parseSourceShares(params)
      if (shares.length === 0) return
      setSourceShares((prev) => ({ ...prev, [id]: shares }))
    })
  }, [])

  useEffect(() => {
    if (!props.open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.open, props])

  if (!props.open) return null

  const s = props.session
  const running = s.pid !== undefined && s.pid > 0

  // 调度队列：游戏会话 + 下载安装
  const queue: Entry[] = []
  if (s.launching === true) {
    queue.push({
      key: 'game-launching',
      title: `启动游戏${s.launchVersion !== undefined ? ` ${s.launchVersion}` : ''}`,
      status: `${Math.round(s.progress ?? 0)}%`,
      hint: s.stage,
      progress: s.progress
    })
  } else if (running) {
    queue.push({
      key: 'game-running',
      title: `游戏运行中${s.launchVersion !== undefined ? ` · ${s.launchVersion}` : ''}`,
      hint: `pid ${s.pid}`
    })
  }
  for (const t of props.tasks) {
    queue.push({
      key: t.id,
      title: t.title,
      status: t.progress !== undefined ? `${Math.round(t.progress)}%` : undefined,
      hint: t.status,
      progress: t.progress,
      failed: t.failed === true,
      done: t.finished === true
    })
  }

  const activeCount = queue.filter((t) => !t.done && !t.failed).length

  return (
    <>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 850,
          background: 'rgba(0,0,0,0.35)',
          animation: 'fadeIn 150ms cubic-bezier(0.33,0,0.67,1) both'
        }}
        onClick={props.onClose}
      />
      <div
        className="acrylic"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(720px, 52vw)',
          minWidth: 420,
          zIndex: 851,
          borderLeft: '1px solid var(--stroke-default)',
          boxShadow: 'var(--shadow-16)',
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideInRight 240ms cubic-bezier(0.1,0.9,0.2,1) both'
        }}
      >
        {/* 头部：图标 + 标题 + 副标题 + 关闭 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '18px 20px 10px'
          }}
        >
          {/* Win 端同字形：U+EC89，accent 色 15px（MainWindow 抽屉标题行） */}
          <span
            style={{
              color: 'var(--accent)',
              fontFamily: 'var(--font-icon)',
              fontSize: 15,
              lineHeight: 1,
              marginTop: 4
            }}
            aria-hidden
          >
            {String.fromCharCode(0xec89)}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 600 }}>调度中心</div>
            <div className="t-cap">
              {activeCount > 0 && `${activeCount} 个任务进行中`}
              {activeCount > 0 && props.notifications.length > 0 && ' · '}
              {props.notifications.length} 条通知
            </div>
          </div>
          <button
            className="btn btn-subtle btn-sm"
            title="关闭"
            aria-label="关闭调度中心"
            onClick={props.onClose}
          >
            {/* Win 端同字形：U+EA86（ChromeClose 的小号鴻蒙变体） */}
            <span
              style={{
                fontFamily: 'var(--font-icon)',
                fontSize: 13,
                lineHeight: 1,
                color: 'var(--text-secondary)',
                display: 'inline-flex'
              }}
              aria-hidden
            >
              {String.fromCharCode(0xea86)}
            </span>
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 20px 16px' }}>
          {/* 调度队列 */}
          <div className="t-strong" style={{ fontSize: 15, marginBottom: 10 }}>
            调度队列
          </div>

          {queue.length === 0 ? (
            <div
              style={{
                padding: '40px 0',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                color: 'var(--text-tertiary)'
              }}
            >
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
                <path d="M4 6.5h16M4 12h16M4 17.5h16" />
              </svg>
              <div style={{ fontSize: 14 }}>无</div>
            </div>
          ) : (
            queue.map((t) => {
              // 各源贡献（Win 01#17）：取前 6 源；单源或无数据时不显示分段带
              const shares = (sourceShares[t.key] ?? []).slice(0, 6)
              const totalBytes = shares.reduce((sum, s) => sum + s.bytes, 0)
              const showShares = shares.length > 1 && totalBytes > 0
              return (
                <div
                  key={t.key}
                  className="card"
                  style={{ marginBottom: 10, padding: '12px 14px' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      className="dot"
                      style={{
                        background: t.failed
                          ? 'var(--danger)'
                          : t.done
                            ? 'var(--success)'
                            : 'var(--accent)',
                        flexShrink: 0
                      }}
                    />
                    <span className="t-strong truncate" style={{ flex: 1 }}>
                      {t.title}
                    </span>
                    {t.status !== undefined && (
                      <span className="t-body" style={{ color: 'var(--text-secondary)' }}>
                        {t.status}
                      </span>
                    )}
                  </div>
                  {t.hint !== undefined && t.hint !== t.status && (
                    <div className="t-cap" style={{ marginTop: 4 }}>
                      {t.hint}
                    </div>
                  )}
                  {/* 进度槽常驻（Win 01#15：行按 Id 复用防抖动）：未完结的任务恒画进度条，
                      拿不到确定进度就画流动的不确定态，行高不随事件增减而跳 */}
                  {!t.done && !t.failed && (
                    <div style={{ marginTop: 8 }}>
                      {t.progress !== undefined ? (
                        <ProgressBar value={t.progress} />
                      ) : (
                        <ProgressBar indeterminate />
                      )}
                    </div>
                  )}
                  {showShares && (
                    <div style={{ marginTop: 8 }}>
                      <div className="t-meta" style={{ fontSize: 11, marginBottom: 4 }}>
                        各源贡献
                      </div>
                      {/* 6px 高分段贡献带：领先源 accent 实心、其余中性色按名次递减透明度 */}
                      <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden' }}>
                        {shares.map((s, i) => (
                          <div key={`${i}-${s.name}`} style={{ width: `${(s.bytes / totalBytes) * 100}%`, ...segmentTone(i) }} />
                        ))}
                      </div>
                      {/* 图例行：6×6 色点 + 源名 + {F1} MB · {F0}% */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                        {shares.map((s, i) => (
                          <div
                            key={`${i}-${s.name}`}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              fontSize: 11,
                              color: 'var(--text-secondary)'
                            }}
                          >
                            <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, ...segmentTone(i) }} />
                            <span className="truncate" style={{ minWidth: 0 }}>
                              {s.name}
                            </span>
                            <span style={{ flexShrink: 0, color: 'var(--text-tertiary)' }}>
                              {(s.bytes / 1048576).toFixed(1)} MB · {Math.round((s.bytes / totalBytes) * 100)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}

          {/* 历史通知 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              margin: '16px 0 10px'
            }}
          >
            <span className="t-strong" style={{ fontSize: 15 }}>
              历史通知
            </span>
            <div style={{ flex: 1 }} />
            {props.notifications.length > 0 && (
              <button className="btn btn-subtle btn-sm" onClick={props.onClearNotifications}>
                清空通知
              </button>
            )}
          </div>

          {props.notifications.length === 0 ? (
            <div className="t-cap">暂无通知。</div>
          ) : (
            props.notifications.map((n) => (
              <div
                key={n.id}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 8,
                  // 三档左边条（Win 01#16：信息/警告/错误 → attention/caution/critical 同源配色）
                  padding: '3px 0 3px 8px',
                  borderLeft: `3px solid ${NOTICE_TONE[n.level] ?? 'var(--accent)'}`,
                  marginBottom: 2
                }}
              >
                <span className="t-meta" style={{ flexShrink: 0 }}>
                  {n.time}
                </span>
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 12,
                    color: NOTICE_TONE[n.level] ?? 'var(--accent)'
                  }}
                >
                  {n.level}
                </span>
                <span className="t-body truncate" style={{ minWidth: 0 }} title={n.message}>
                  {n.message}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}
