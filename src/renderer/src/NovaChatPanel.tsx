/// Nova 聊天面板（Win 端 NovaPopup 内嵌面板的等价物）。
/// 自带配置读取与流式订阅，三处共用：标题栏 Orb 弹层、Nova 页「打开 Nova 对话」、
/// 游戏内浮窗点击承接。配置（模型通道）在挂载时读取，消息只保留本次挂载的会话。
import { useEffect, useRef, useState } from 'react'

import { onBridgeEvent, request } from './bridge'
import type { NovaConfig, NovaPlanItem } from './bridge'
import { useToasts } from './ui'
import { IconSparkle } from './icons'

/** 最近一条带 plan 的消息 id（只有它能执行/放弃）。 */
interface PlanState {
  planId: string
  items: NovaPlanItem[]
  title?: string
}

interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  tool?: string
  streaming?: boolean
  plan?: NovaPlanItem[]
}

export default function NovaChatPanel(props: {
  /** 「问 Nova」等入口的预填文本（Win 端 NovaRuntime.RequestInput 的等价物）。 */
  seed?: string
  /** 面板标头齿轮：先关面板再去 Nova 页（许可层 / 模型设置）。 */
  onGoSettings?: () => void
}): JSX.Element {
  const { push, host } = useToasts()
  const [config, setConfig] = useState<NovaConfig>({ baseUrl: '', apiKey: '', model: '' })
  const [useCloud, setUseCloud] = useState(false)
  const [session, setSession] = useState<{ loggedIn: boolean; displayName?: string } | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [plan, setPlan] = useState<PlanState | null>(null)
  const [planBusy, setPlanBusy] = useState(false)
  const seq = useRef(1)
  const streamingId = useRef<number | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (props.seed !== undefined && props.seed !== '') setInput(props.seed)
  }, [props.seed])

  useEffect(() => {
    void request<NovaConfig>('nova.config.get')
      .then((value) => {
        setConfig(value)
        setUseCloud(value.gatewayEnabled !== false)
      })
      .catch(() => undefined)
    void request<{ loggedIn: boolean; displayName?: string }>('starcloud.state')
      .then((s) => setSession(s))
      .catch(() => setSession(null))
  }, [])

  const signedIn = session?.loggedIn === true
  const configured =
    (config.baseUrl.length > 0 && config.model.length > 0) || (signedIn && useCloud)

  // 流式事件（nova.chat 只回 accepted，正文走事件）
  useEffect(() => {
    onBridgeEvent((event, params) => {
      if (event === 'nova.delta') {
        const text = String(params.text ?? '')
        if (text === '') return
        const id = streamingId.current
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, content: m.content + text, streaming: true } : m))
        )
      } else if (event === 'nova.tool') {
        const tool = String(params.tool ?? '')
        const id = streamingId.current
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, tool } : m)))
      } else if (event === 'nova.done') {
        const text = String(params.text ?? '')
        const planItems = params.plan as NovaPlanItem[] | undefined
        if (planItems !== undefined && planItems.length > 0 && params.planId != null) {
          setPlan({
            planId: String(params.planId),
            items: planItems,
            title: params.planTitle != null ? String(params.planTitle) : undefined
          })
        }
        const id = streamingId.current
        streamingId.current = null
        setBusy(false)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id
              ? { ...m, content: text !== '' ? text : m.content, streaming: false, plan: planItems }
              : m
          )
        )
      } else if (event === 'nova.failed') {
        const error = String(params.error ?? '未知错误')
        const id = streamingId.current
        streamingId.current = null
        setBusy(false)
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, content: `请求失败：${error}`, streaming: false } : m))
        )
      }
    })
  }, [])

  useEffect(() => {
    if (bodyRef.current !== null) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [messages])

  async function send(): Promise<void> {
    const text = input.trim()
    if (text === '' || busy) return
    if (!configured) {
      push('info', '先在「模型设置」里填好 Base URL 与模型名，或登录 Starcloud ID 使用云端模型')
      return
    }
    setInput('')
    setBusy(true)
    const userId = seq.current++
    const assistantId = seq.current++
    streamingId.current = assistantId
    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', content: text },
      { id: assistantId, role: 'assistant', content: '', streaming: true }
    ])
    try {
      await request<{ accepted: boolean }>('nova.chat', { message: text })
    } catch (e) {
      streamingId.current = null
      setBusy(false)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: `请求失败：${String(e)}`, streaming: false } : m
        )
      )
    }
  }

  // 标头副标题：当前走的通道（Win 端这一行是云端额度，桥接暂未下发，先显示通道状态）
  const subtitle = !configured
    ? '未配置模型'
    : signedIn && useCloud
      ? `云端模型 · ${session?.displayName ?? 'Starcloud ID'}`
      : `自接模型 · ${config.model}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* 标头：头像 + 名字 + 通道副标题 + 去 Nova 页 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'var(--surface-subtle)',
            border: '1px solid var(--stroke-default)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}
        >
          <IconSparkle size={16} style={{ color: 'var(--accent)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t-strong">Nova</div>
          <div className="t-meta truncate">{subtitle}</div>
        </div>
        <button
          className="btn btn-sm"
          title="Nova 设置"
          aria-label="Nova 设置"
          onClick={() => props.onGoSettings?.()}
        >
          <span style={{ fontFamily: 'var(--font-icon)', fontSize: 13, lineHeight: 1 }}>
            {String.fromCharCode(0xec04)}
          </span>
        </button>
      </div>

      {/* 消息区 */}
      <div
        ref={bodyRef}
        style={{
          flex: 1,
          minHeight: 120,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: '2px 2px'
        }}
      >
        {messages.length === 0 && (
          <div className="t-cap" style={{ padding: '12px 0' }}>
            {configured
              ? '问点什么吧：查版本、算配置、写指令都可以。'
              : '先在「模型设置」里填好 Base URL 与模型名，或登录 Starcloud ID 使用云端模型。'}
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '78%',
              padding: '8px 12px',
              borderRadius: 12,
              background: m.role === 'user' ? 'var(--accent)' : 'var(--surface-subtle)',
              color: m.role === 'user' ? 'var(--text-on-accent)' : 'var(--text-primary)',
              border: m.role === 'user' ? 'none' : '1px solid var(--stroke-subtle)',
              whiteSpace: 'pre-wrap',
              fontSize: 13,
              animation: m.streaming ? 'pulse 1.5s infinite' : undefined
            }}
          >
            {m.tool !== undefined && (
              <div className="t-meta" style={{ marginBottom: 4, opacity: 0.8 }}>
                正在调用：{m.tool}
              </div>
            )}
            {m.content}
            {m.plan !== undefined && m.plan.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {m.plan.map((p) => (
                  <div
                    key={p.title}
                    className="t-meta"
                    style={{ padding: '6px 8px', borderRadius: 8, background: 'var(--surface-hover)' }}
                  >
                    <b>{p.title}</b>
                    {p.detail !== '' ? ` — ${p.detail}` : ''}
                  </div>
                ))}
                {plan !== null && plan.items === m.plan && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={planBusy}
                      onClick={async () => {
                        setPlanBusy(true)
                        try {
                          const r = await request<{ ok: boolean; message?: string }>(
                            'nova.plan.execute',
                            { id: plan.planId }
                          )
                          push('success', r.message ?? '已应用')
                          setPlan(null)
                        } catch (e) {
                          push('error', String(e))
                        } finally {
                          setPlanBusy(false)
                        }
                      }}
                    >
                      {planBusy ? '执行中…' : '执行'}
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={planBusy}
                      onClick={async () => {
                        try {
                          await request('nova.plan.discard', { id: plan.planId })
                        } catch {
                          /* 忽略 */
                        }
                        setPlan(null)
                      }}
                    >
                      放弃
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 输入行 */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          value={input}
          placeholder="给 Nova 发消息…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) void send()
          }}
        />
        <button
          className="btn btn-primary"
          disabled={busy || input.trim() === ''}
          onClick={() => void send()}
        >
          {busy ? '回复中…' : '发送'}
        </button>
      </div>
      {host}
    </div>
  )
}
