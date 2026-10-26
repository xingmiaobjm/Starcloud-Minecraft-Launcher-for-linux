/// Nova 页：对齐 Win 端 NovaPage —— 这是**模型设置页**，不是聊天页。
/// 卡片顺序：Nova 账户 → 云端模型 → 模型设置 → 游戏内辅助浮窗。
/// 对话在共用面板 NovaChatPanel 里：页内 Modal 与标题栏 Orb 弹层走同一份。
import { useCallback, useEffect, useState } from 'react'

import { nativeApi, onBridgeEvent, request } from '../bridge'
import type { NovaConfig } from '../bridge'
import { Modal, Toggle, useToasts } from '../ui'
import { IconSparkle } from '../icons'
import NovaChatPanel from '../NovaChatPanel'

/** 分组卡标题（黄色竖条 + 标题 + 右侧附加操作）。 */
function SectionCard(props: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span
          style={{ width: 4, height: 16, borderRadius: 2, background: 'var(--accent)', flexShrink: 0 }}
        />
        <span className="t-strong" style={{ fontSize: 15 }}>
          {props.title}
        </span>
        <div style={{ flex: 1 }} />
        {props.action}
      </div>
      {props.children}
    </div>
  )
}

/** 最近一条带 plan 的消息在共用面板内部管理；页面只管配置与入口。 */
export default function NovaPage(props: { seed?: string; onGoLogin?: () => void }): JSX.Element {
  const { push, host } = useToasts()
  const [config, setConfig] = useState<NovaConfig>({ baseUrl: '', apiKey: '', model: '' })
  const [draft, setDraft] = useState<NovaConfig>({ baseUrl: '', apiKey: '', model: '' })
  const [useCloud, setUseCloud] = useState(false)
  const [session, setSession] = useState<{ loggedIn: boolean; displayName?: string; userId?: string } | null>(null)
  const signedIn = session?.loggedIn === true
  /** 游戏内浮窗开关（落盘到 novaOverlayEnabled） */
  const [overlay, setOverlay] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)

  const loadConfig = useCallback(async (): Promise<void> => {
    try {
      const value = await request<NovaConfig>('nova.config.get')
      setConfig(value)
      setDraft(value)
      setUseCloud(value.gatewayEnabled !== false)
    } catch (e) {
      push('error', `读取模型配置失败：${String(e)}`)
    }
  }, [push])

  useEffect(() => {
    void loadConfig()
    void request<{ loggedIn: boolean; displayName?: string; userId?: string }>('starcloud.state')
      .then((s) => setSession(s))
      .catch(() => setSession(null))
    // 浮窗开关：与设置页共用同一份（内核 novaOverlayEnabled）
    void request<{ novaOverlayEnabled?: boolean }>('settings.get')
      .then((snap) => setOverlay(snap.novaOverlayEnabled === true))
      .catch(() => undefined)
  }, [loadConfig])

  /** 游戏运行时弹一下游戏内浮窗（Win 同款：只在游戏跑着时提示）。 */
  useEffect(() => {
    const onOutput = (event: string, params: Record<string, unknown>): void => {
      if (event !== 'game.output') return
      const api = nativeApi()
      if (api === null) return
      void api.showOverlay('Nova 有一条新消息，点开查看').catch(() => undefined)
    }
    onBridgeEvent(onOutput)
  }, [])
  /** 写回浮窗开关（落盘 novaOverlayEnabled）。 */
  const applyOverlay = useCallback(
    (enabled: boolean): void => {
      setOverlay(enabled)
      void request('settings.apply', { novaOverlayEnabled: enabled })
        .then(() => push('success', enabled ? '已开启游戏内浮窗' : '已关闭游戏内浮窗'))
        .catch((e) => push('error', `保存失败：${String(e)}`))
    },
    [push]
  )

  // 可用通道：自接模型，或已登录且开了云端中转（Starcloud ID 下发的 Key）
  const configured =
    (config.baseUrl.length > 0 && config.model.length > 0) || (signedIn && useCloud)
  // 本地没配完整、走的是云端通道时，「当前使用」卡片显示云端而非空模型名
  const useCloudChannel =
    signedIn && useCloud && !(config.baseUrl.length > 0 && config.model.length > 0)

  async function saveConfig(): Promise<void> {
    try {
      const value = await request<NovaConfig>('nova.config.set', {
        baseUrl: draft.baseUrl.trim(),
        apiKey: draft.apiKey.trim(),
        model: draft.model.trim()
      })
      setConfig(value)
      const ok = value.baseUrl.length > 0 && value.model.length > 0
      push(ok ? 'success' : 'info', ok ? '模型配置已保存。' : '已清除模型配置。')
    } catch (e) {
      push('error', String(e))
    }
  }

  return (
    <div className="page">
      <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Nova 账户 */}
        <SectionCard
          title="Nova 账户"
          action={
            signedIn ? undefined : (
              <button className="btn btn-sm" onClick={() => props.onGoLogin?.()}>
                登录
              </button>
            )
          }
        >
          <div className="t-cap" style={{ marginBottom: 10 }}>
            登录后可用云端模型与邀请、时刻等在线能力；凭据只保存在本机。
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <IconSparkle size={18} style={{ color: 'var(--accent)' }} />
            <div style={{ flex: 1 }}>
              <div className="t-body">{signedIn ? session?.displayName ?? '已登录' : '未登录'}</div>
              <div className="t-meta">
                {signedIn
                  ? session?.userId ?? ''
                  : '当前使用下面接入的本地模型'}
              </div>
            </div>
          </div>
        </SectionCard>

        {/* 云端模型 */}
        <SectionCard
          title="云端模型"
          action={
            <button className="btn btn-sm" onClick={() => void loadConfig()}>
              刷新
            </button>
          }
        >
          <div className="t-cap" style={{ marginBottom: 10 }}>
            登录 Starcloud ID 后 Nova 默认走云端模型，不用自己填 Key；用量记在账号上。
          </div>
          <div className="t-body" style={{ marginBottom: 6 }}>
            使用云端模型
          </div>
          <Toggle
            checked={useCloud}
            disabled={!signedIn}
            label="使用云端模型"
            onChange={(v) => {
              setUseCloud(v)
              // 写回设置（NovaGatewayEnabled）：决定 Nova 走云端中转还是自接模型
              void request<NovaConfig>('nova.config.set', {
                baseUrl: config.baseUrl,
                apiKey: config.apiKey,
                model: config.model,
                gatewayEnabled: v
              })
                .then((r) => setConfig(r))
                .catch((e) => push('error', `保存云端开关失败：${String(e)}`))
            }}
          />
          <div className="t-cap" style={{ marginTop: 10 }}>
            未登录时不可用；关掉后 Nova 只用下面接入的模型。
          </div>
        </SectionCard>

        {/* 模型设置 */}
        <SectionCard
          title="模型设置"
          action={
            <button className="btn btn-sm" onClick={() => void saveConfig()}>
              保存
            </button>
          }
        >
          <div className="t-cap" style={{ marginBottom: 12 }}>
            接入任意 OpenAI 兼容服务：填 Base URL、Key 与模型名。Key 只保存在本机。
          </div>

          {configured && (
            <div
              className="row row-static"
              style={{ background: 'var(--surface-subtle)', marginBottom: 12 }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="t-strong truncate">
                    {useCloudChannel ? '云端模型（Starcloud ID）' : config.model}
                  </span>
                  <span className="chip chip-accent">当前使用</span>
                </div>
                <div className="t-meta truncate">
                  {useCloudChannel
                    ? '由账号下发的云端通道，无需本机 Key'
                    : `${config.baseUrl} · Key ${config.apiKey === '' ? '未设置' : config.apiKey.slice(0, 8) + '…'}`}
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="t-cap">Base URL</span>
              <input
                className="input"
                value={draft.baseUrl}
                placeholder="例如 https://api.example.com/v1"
                onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="t-cap">API Key</span>
              <input
                className="input"
                type="password"
                value={draft.apiKey}
                placeholder="sk-…"
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="t-cap">模型名</span>
              <input
                className="input"
                value={draft.model}
                placeholder="例如 gpt-4o-mini / deepseek-chat"
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              />
            </label>
          </div>

          <div style={{ marginTop: 14 }}>
            <button className="btn btn-primary" onClick={() => setChatOpen(true)}>
              打开 Nova 对话
            </button>
          </div>
        </SectionCard>

        {/* 游戏内辅助浮窗 */}
        <SectionCard title="游戏内辅助浮窗">
          <div className="t-cap" style={{ marginBottom: 10 }}>
            启动游戏时自动弹出浮窗，游戏内随时查资料；与顶栏 Nova 共用同一份对话。
          </div>
          <Toggle
            checked={overlay}
            onChange={(v) => applyOverlay(v)}
            label="游戏内辅助浮窗"
          />
        </SectionCard>
      </div>

      {/* Nova 对话浮层（内容与标题栏 Orb 弹层共用同一面板） */}
      <Modal open={chatOpen} title="Nova" onClose={() => setChatOpen(false)} width={560}>
        <NovaChatPanel seed={props.seed} />
      </Modal>

      {host}
    </div>
  )
}
