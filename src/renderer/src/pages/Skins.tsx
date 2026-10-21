/// 皮肤库页：多皮肤管理（导入 / 重命名 / 型号 / 删除 / 绑定到账户）。
///
/// 语义照 Win 端 AccountDetailPage 的「我的皮肤」区块：
/// · 衣柜（皮肤库）**在所有账户之间共用一份**，每个账户只记自己选了哪张；
/// · 本地皮肤库只对**离线 + 正版**账户开放，第三方（外置）账户的皮肤归皮肤站，
///   绑定入口因此对它们收起（见 supportsLocalSkins）。
/// · 缩略图：皮肤 PNG 是本地文件，渲染层读不到文件系统，主进程经
///   `skin:icon` IPC 读成 data URL 回传（不放开 file:// CSP）。
import { useCallback, useEffect, useMemo, useState } from 'react'

import { nativeApi, request } from '../bridge'
import type {
  AccountList,
  GameAccount,
  OkResult,
  SetSkinResult,
  SkinEntry,
  SkinModel,
  SkinResult
} from '../bridge'
import { EmptyState, Modal, Segmented, SkeletonList, Spinner, useToasts } from '../ui'
import { IconRefresh, IconUser, IconInfo } from '../icons'
import SkinFigure from '../SkinFigure'

/** 型号三档（与内核 SkinModels 的 auto / classic / slim 一一对应）。 */
const MODEL_OPTIONS: Array<{ value: SkinModel; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'classic', label: '经典' },
  { value: 'slim', label: '纤细' }
]

const MODEL_LABEL: Record<SkinModel, string> = {
  auto: '自动（按纹理判断）',
  classic: '经典（粗手臂）',
  slim: '纤细（细手臂）'
}

/** 来源标签（Win 端 SkinDetail 的三种来源文案）。 */
const SOURCE_LABEL: Record<string, string> = {
  file: '本地导入',
  url: '来自链接',
  preset: '启动器自带'
}

/** 本地皮肤库服务哪几类账户：离线 + 正版；第三方归皮肤站。 */
function supportsLocalSkins(a: GameAccount): boolean {
  return a.type !== 'external'
}

function normalizeModel(model: string): SkinModel {
  return model === 'classic' || model === 'slim' ? model : 'auto'
}

/** 加入时间文案（对齐 Home.tsx / Saves.tsx 的 lastPlayed 口径）。 */
function addedText(iso?: string): string {
  if (iso === undefined || iso === null || iso === '') return '未知'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '未知'
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

/** 只接受 http/https，避免把 javascript: 之类塞给下载引擎。 */
function isHttpUrl(raw: string): boolean {
  return /^https?:\/\/\S+$/i.test(raw.trim())
}

/**
 * 皮肤纹理 → 正面小人立绘（Win 端 SkinThumbnails 的等价物，2D 拼装版）。
 * 64×64：头(8,8) 帽(40,8) 身(20,20) 右臂(44,20) 左臂(36,52) 右腿(4,20) 左腿(20,52)；
 * 64×32（旧版式）：四肢左右共用右臂/右腿的贴图。
 * 画不出来（跨域图片环境异常等）时返回 null，调用方回落原始纹理。
 */
function renderFigure(dataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const w = img.width
        const old = w <= 64 * 1.01 && img.height <= 32 * 1.01 // 64×32 及其放大
        const unit = w / 64 // 等比放大的皮肤都归一到 64 宽
        const px = (n: number): number => Math.round(n * unit)
        const canvas = document.createElement('canvas')
        const scale = 4
        canvas.width = 24 * px(1) * scale
        canvas.height = 32 * px(1) * scale
        const ctx = canvas.getContext('2d')
        if (ctx === null) {
          resolve(null)
          return
        }
        ctx.imageSmoothingEnabled = false
        const put = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number): void => {
          ctx.drawImage(img, px(sx), px(sy), px(sw), px(sh), dx * px(1) * scale, dy * px(1) * scale, sw * px(1) * scale, sh * px(1) * scale)
        }
        // 布局：头 8×8 居中（x=8），身 8×12（x=8,y=8），臂 4×12（x=0 / x=16），腿 4×12（x=4 / x=12）
        put(8, 8, 8, 8, 8, 0) // 头正面
        put(40, 8, 8, 8, 8, 0) // 帽层
        put(20, 20, 8, 12, 8, 8) // 身体正面
        put(44, 20, 4, 12, 4, 8) // 右臂
        if (!old) put(36, 52, 4, 12, 16, 8) // 左臂
        else put(44, 20, 4, 12, 16, 8)
        put(4, 20, 4, 12, 8, 20) // 右腿
        if (!old) put(20, 52, 4, 12, 12, 20) // 左腿
        else put(4, 20, 4, 12, 12, 20)
        resolve(canvas.toDataURL('image/png'))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

export default function SkinsPage(props: {
  /** 焦点账户（账户详情页嵌入时传）：绑定列表里把它排在最前。 */
  accountUuid?: string
  /** 嵌入模式：不渲染页面大标题（账户详情页里只留工具按钮）。 */
  embedded?: boolean
}): JSX.Element {
  const { push, host } = useToasts()
  const [skins, setSkins] = useState<SkinEntry[]>([])
  const [accounts, setAccounts] = useState<GameAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [icons, setIcons] = useState<Record<string, string>>({})
  /** 原始皮肤纹理（3D 小人要用整张 PDF 纹理，不能用拼好的立绘图） */
  const [rawIcons, setRawIcons] = useState<Record<string, string>>({})
  const [iconFailed, setIconFailed] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 导入本地文件
  const [importOpen, setImportOpen] = useState(false)
  const [importPathDraft, setImportPathDraft] = useState('')
  // 从 URL 导入
  const [urlOpen, setUrlOpen] = useState(false)
  const [urlValue, setUrlValue] = useState('')
  const [urlName, setUrlName] = useState('')
  // 重命名
  const [renameTarget, setRenameTarget] = useState<SkinEntry | null>(null)
  const [renameValue, setRenameValue] = useState('')
  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<SkinEntry | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const data = await request<{ skins: SkinEntry[] }>('skins.list')
      setSkins(data.skins)
      setSelectedId((prev) =>
        prev !== null && data.skins.some((s) => s.id === prev)
          ? prev
          : (data.skins[0]?.id ?? null)
      )
      // 缩略图逐张取（数量有限；失败就保持占位块）
      for (const s of data.skins) {
        if (s.path === '') continue
        const api = nativeApi()
        if (api === null) continue
        void api
          .skinIcon(s.path)
          .then(async (dataUrl) => {
            setRawIcons((prev) => ({ ...prev, [s.id]: dataUrl }))
            // 原始纹理 → 正面小人立绘（失败回落原始 PNG）
            const figure = await renderFigure(dataUrl)
            setIcons((prev) => ({ ...prev, [s.id]: figure ?? dataUrl }))
          })
          .catch(() => setIconFailed((prev) => new Set(prev).add(s.id)))
      }
    } catch (e) {
      push('error', `读取皮肤库失败：${String(e)}`)
    }
    try {
      const list = await request<AccountList>('accounts.list')
      setAccounts(list.accounts)
    } catch (e) {
      push('error', `读取账户失败：${String(e)}`)
    }
    setLoading(false)
  }, [push])

  useEffect(() => {
    void load()
  }, [load])

  const selected = useMemo(
    () => skins.find((s) => s.id === selectedId) ?? null,
    [skins, selectedId]
  )

  /** 某账户正在用哪张皮肤（uuid → skinId）。 */
  const boundBy = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of accounts) {
      if (a.skinId !== undefined && a.skinId !== '') map.set(a.uuid, a.skinId)
    }
    return map
  }, [accounts])

  const bindableAccounts = useMemo(() => {
    const list = accounts.filter(supportsLocalSkins)
    // 焦点账户（从账户详情进来时）排最前，一眼看到「应用到它」
    const focus = props.accountUuid
    if (focus === undefined) return list
    return [...list].sort((a, b) => (a.uuid === focus ? -1 : b.uuid === focus ? 1 : 0))
  }, [accounts, props.accountUuid])

  async function importPath(): Promise<void> {
    const path = importPathDraft.trim()
    if (path === '') return
    setBusy(true)
    try {
      const r = await request<SkinResult>('skins.importPath', { path })
      push('success', `已导入「${r.skin.name}」`)
      setImportPathDraft('')
      setImportOpen(false)
      await load()
    } catch (e) {
      // 内核校验失败原因（不是 PNG / 尺寸不对 / 超过 4MB）原文带回来
      push('error', `导入失败：${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  /** 用系统文件选择框填路径（拿不到文件选择器时退化为手输）。 */
  async function browseFile(): Promise<void> {
    const api = nativeApi()
    if (api === null) {
      push('info', '当前环境没有文件选择框，请直接粘贴皮肤文件的路径')
      return
    }
    try {
      const picked = await api.pickFile('选择皮肤 PNG')
      if (picked !== null) setImportPathDraft(picked)
    } catch (e) {
      push('error', `选择文件失败：${String(e)}`)
    }
  }

  async function importUrl(): Promise<void> {
    const url = urlValue.trim()
    if (!isHttpUrl(url)) return
    setBusy(true)
    try {
      const name = urlName.trim()
      const r = await request<SkinResult>('skins.importUrl', {
        url,
        ...(name === '' ? {} : { name })
      })
      push('success', `已导入「${r.skin.name}」`)
      setUrlValue('')
      setUrlName('')
      setUrlOpen(false)
      await load()
    } catch (e) {
      push('error', `导入失败：${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function rename(): Promise<void> {
    const target = renameTarget
    const name = renameValue.trim()
    if (target === null || name === '') return
    setBusy(true)
    try {
      await request<SkinResult>('skins.rename', { id: target.id, name })
      push('success', `已重命名为「${name}」`)
      setRenameTarget(null)
      await load()
    } catch (e) {
      push('error', `重命名失败：${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function setModel(model: SkinModel): Promise<void> {
    const target = selected
    if (target === null || normalizeModel(target.model) === model) return
    setBusy(true)
    try {
      await request<SkinResult>('skins.setModel', { id: target.id, model })
      push('success', `「${target.name}」型号已改为${MODEL_LABEL[model]}`)
      await load()
    } catch (e) {
      push('error', `切换型号失败：${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function remove(): Promise<void> {
    const target = deleteTarget
    if (target === null) return
    setBusy(true)
    try {
      await request<OkResult>('skins.delete', { id: target.id })
      // 桥接会顺手清掉账户上指向这张皮肤的引用（与 Windows 端一致）
      push('success', `已删除「${target.name}」`)
      setDeleteTarget(null)
      await load()
    } catch (e) {
      push('error', `删除失败：${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  /** 绑定到账户；skinId 空串 = 恢复账号默认形象（内核按空引用清空）。 */
  async function bind(account: GameAccount, skinId: string | null): Promise<void> {
    setBusy(true)
    try {
      const model = selected === null ? 'auto' : normalizeModel(selected.model)
      await request<SetSkinResult>('accounts.setSkin', {
        uuid: account.uuid,
        skinId: skinId ?? '',
        model
      })
      push(
        'success',
        skinId === null
          ? `${account.name} 已恢复默认形象`
          : `${account.name} 已绑定「${selected?.name ?? skinId}」`
      )
      await load()
    } catch (e) {
      push('error', `绑定失败：${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  /** 焦点账户（从账户详情进来时）：左栏的「应用到」直接对着它 */
  const focusAccount = accounts.find((a) => a.uuid === props.accountUuid)

  return (
    <div className="page">
      {!props.embedded && (
        <div className="page-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="page-title">皮肤库</h1>
            <div className="page-sub">
              所有账户共用一份衣柜，每个账户只记自己选了哪张；本机注入，下次启动游戏生效
            </div>
          </div>
          <button
            className="btn"
            onClick={() => {
              setImportPathDraft('')
              setImportOpen(true)
            }}
            disabled={busy}
          >
            导入本地文件…
          </button>
          <button className="btn" onClick={() => setUrlOpen(true)} disabled={busy}>
            从链接导入…
          </button>
          <button className="btn btn-primary" onClick={() => void load()} disabled={loading}>
            <IconRefresh size={15} /> 刷新
          </button>
        </div>
      )}
      {props.embedded && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexShrink: 0 }}>
          <button
            className="btn"
            onClick={() => {
              setImportPathDraft('')
              setImportOpen(true)
            }}
            disabled={busy}
          >
            导入本地文件…
          </button>
          <button className="btn" onClick={() => setUrlOpen(true)} disabled={busy}>
            从链接导入…
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => void load()} disabled={loading}>
            <IconRefresh size={15} /> 刷新
          </button>
        </div>
      )}

      <div className="page-body">
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
          {/* ── 左：3D 形象 + 当前皮肤信息与操作（Win 端 SkinPanel 左栏） ── */}
          <div style={{ width: 340, minWidth: 340, flexShrink: 0 }}>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <SkinFigure
                texture={selected === null ? undefined : rawIcons[selected.id]}
                height={300}
              />
              <div
                style={{
                  padding: '2px 18px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10
                }}
              >
                <div>
                  <div className="t-strong truncate" style={{ fontSize: 16 }}>
                    {selected === null ? '还没有选中皮肤' : selected.name}
                  </div>
                  <div className="t-cap">
                    {selected === null
                      ? '在右侧衣柜里挑一张，小人会实时换装'
                      : `${selected.width}×${selected.height} · ${MODEL_LABEL[normalizeModel(selected.model)]} · ${SOURCE_LABEL[selected.source] ?? selected.source}`}
                  </div>
                </div>

                {selected !== null && focusAccount !== undefined && (
                  <div className="t-cap">
                    {boundBy.get(focusAccount.uuid) === selected.id
                      ? `${focusAccount.name} 正在使用这张皮肤`
                      : `应用到 ${focusAccount.name} 后，下次启动游戏生效`}
                  </div>
                )}

                {selected !== null && (
                  <>
                    <div>
                      <div className="t-cap" style={{ marginBottom: 4 }}>
                        型号
                      </div>
                      <Segmented<SkinModel>
                        value={normalizeModel(selected.model)}
                        options={MODEL_OPTIONS}
                        disabled={busy}
                        onChange={(v) => void setModel(v)}
                      />
                    </div>

                    {/* 应用到该账户（Win：正版账户同样是本机注入，不动微软官方皮肤） */}
                    {focusAccount !== undefined ? (
                      boundBy.get(focusAccount.uuid) === selected.id ? (
                        <button
                          className="btn"
                          disabled={busy}
                          onClick={() => void bind(focusAccount, null)}
                        >
                          取消绑定（恢复默认形象）
                        </button>
                      ) : (
                        <button
                          className="btn btn-primary"
                          style={{ fontWeight: 600 }}
                          disabled={busy}
                          onClick={() => void bind(focusAccount, selected.id)}
                        >
                          应用到 {focusAccount.name}
                        </button>
                      )
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div className="t-cap">绑定到账户</div>
                        {bindableAccounts.length === 0 && (
                          <div className="t-cap">
                            还没有支持本地皮肤的账户（离线 / 微软账户）。
                          </div>
                        )}
                        {bindableAccounts.map((acc) => {
                          const bound = boundBy.get(acc.uuid) === selected.id
                          return (
                            <div
                              key={acc.uuid}
                              className="row row-static"
                              style={{ minHeight: 0, padding: '6px 0' }}
                            >
                              <span className="t-body truncate" style={{ flex: 1 }}>
                                {acc.name}
                              </span>
                              {bound ? (
                                <>
                                  <span className="chip chip-accent">使用中</span>
                                  <button
                                    className="btn btn-subtle btn-sm"
                                    disabled={busy}
                                    onClick={() => void bind(acc, null)}
                                  >
                                    取消绑定
                                  </button>
                                </>
                              ) : (
                                <button
                                  className="btn btn-sm"
                                  disabled={busy}
                                  onClick={() => void bind(acc, selected.id)}
                                >
                                  应用
                                </button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn"
                        style={{ flex: 1 }}
                        onClick={() => {
                          setRenameTarget(selected)
                          setRenameValue(selected.name)
                        }}
                      >
                        重命名
                      </button>
                      <button className="btn btn-danger" onClick={() => setDeleteTarget(selected)}>
                        删除
                      </button>
                    </div>
                  </>
                )}

                <div className="t-cap" style={{ fontSize: 11 }}>
                  拖拽小人转视角，滚轮缩放。本机注入：只改你本机看到的形象，
                  不会修改或上传微软账号上的官方皮肤；游戏内 1.19.3 起客户端要求签名属性，
                  本机注入不保证生效。
                </div>
              </div>
            </div>

            {focusAccount !== undefined && focusAccount.type === 'external' && (
              <div className="info info-info" style={{ marginTop: 12 }}>
                <IconInfo size={14} />
                <div className="info-body">
                  外置（第三方）账户的皮肤由皮肤站决定，本地皮肤库对它们不生效 ——
                  在皮肤站更换即可。
                </div>
              </div>
            )}
          </div>

          {/* ── 右：我的皮肤（Win 卡片网格；首格「添加皮肤」，支持拖入 PNG 见下） ── */}
          <div className="card card-flush" style={{ flex: 1, minWidth: 0 }}>
            <div className="card-head">
              <span className="card-title">我的皮肤</span>
              <span className="chip">{skins.length} 张</span>
              <div style={{ flex: 1 }} />
              <span className="t-cap">点卡片试穿，再「应用」到账户</span>
            </div>
            <div style={{ padding: '0 14px 14px' }}>
              {loading && <SkeletonList rows={3} avatar />}
              {!loading && (
                <div className="skin-grid">
                  {/* 添加皮肤占位卡（Win 首格） */}
                  <button
                    className="skin-card skin-add"
                    onClick={() => {
                      setImportPathDraft('')
                      setImportOpen(true)
                    }}
                    disabled={busy}
                    title="导入本地皮肤"
                  >
                    <span style={{ fontSize: 26, opacity: 0.55, lineHeight: 1 }}>＋</span>
                    <span className="t-cap">添加皮肤</span>
                  </button>
                  {skins.map((skin) => {
                    const icon = icons[skin.id]
                    const usedBy = accounts.filter((acc) => boundBy.get(acc.uuid) === skin.id)
                    return (
                      <button
                        key={skin.id}
                        className={`skin-card${skin.id === selectedId ? ' skin-card-active' : ''}`}
                        onClick={() => setSelectedId(skin.id)}
                        title={skin.name}
                      >
                        <span className="skin-card-fig">
                          {icon !== undefined ? (
                            <img
                              src={icon}
                              alt=""
                              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            />
                          ) : iconFailed.has(skin.id) ? (
                            <IconUser size={22} style={{ opacity: 0.45 }} />
                          ) : (
                            <span className="spinner" />
                          )}
                        </span>
                        <span
                          className="t-strong truncate"
                          style={{ fontSize: 12, maxWidth: '100%' }}
                        >
                          {skin.name}
                        </span>
                        <span
                          style={{
                            display: 'flex',
                            gap: 4,
                            flexWrap: 'wrap',
                            justifyContent: 'center'
                          }}
                        >
                          {normalizeModel(skin.model) === 'slim' && (
                            <span className="chip" style={{ height: 16, fontSize: 10 }}>
                              纤细
                            </span>
                          )}
                          {usedBy.length > 0 && (
                            <span className="chip chip-accent" style={{ height: 16, fontSize: 10 }}>
                              {usedBy.map((acc) => acc.name).join(' · ')}
                            </span>
                          )}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 导入本地文件 */}
      <Modal
        open={importOpen}
        title="导入本地皮肤"
        onClose={() => setImportOpen(false)}
        footer={
          <>
            <button className="btn" onClick={() => setImportOpen(false)}>
              取消
            </button>
            <button
              className="btn btn-primary"
              disabled={importPathDraft.trim() === '' || busy}
              onClick={() => void importPath()}
            >
              {busy ? '导入中…' : '导入'}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="t-cap">皮肤文件路径（64×32 / 64×64 或其等比放大的 PNG）</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input"
              autoFocus
              value={importPathDraft}
              placeholder="/home/user/Downloads/skin.png"
              onChange={(e) => setImportPathDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && importPathDraft.trim() !== '') void importPath()
              }}
            />
            <button className="btn" onClick={() => void browseFile()}>
              浏览…
            </button>
          </div>
        </div>
      </Modal>

      {/* 从链接导入 */}
      <Modal
        open={urlOpen}
        title="从链接导入皮肤"
        onClose={() => setUrlOpen(false)}
        footer={
          <>
            <button className="btn" onClick={() => setUrlOpen(false)}>
              取消
            </button>
            <button
              className="btn btn-primary"
              disabled={!isHttpUrl(urlValue) || busy}
              onClick={() => void importUrl()}
            >
              {busy ? '下载中…' : '导入'}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="t-cap">皮肤图片链接（http / https）</span>
            <input
              className="input"
              autoFocus
              value={urlValue}
              placeholder="https://littleskin.cn/skin/xxxx.png"
              onChange={(e) => setUrlValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isHttpUrl(urlValue)) void importUrl()
              }}
            />
          </label>
          {urlValue.trim() !== '' && !isHttpUrl(urlValue) && (
            <span className="t-cap" style={{ color: 'var(--danger)' }}>
              只支持 http / https 链接
            </span>
          )}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="t-cap">名称（留空则用文件名）</span>
            <input
              className="input"
              value={urlName}
              onChange={(e) => setUrlName(e.target.value)}
            />
          </label>
        </div>
      </Modal>

      {/* 重命名 */}
      <Modal
        open={renameTarget !== null}
        title="重命名皮肤"
        onClose={() => setRenameTarget(null)}
        footer={
          <>
            <button className="btn" onClick={() => setRenameTarget(null)}>
              取消
            </button>
            <button
              className="btn btn-primary"
              disabled={renameValue.trim() === '' || busy}
              onClick={() => void rename()}
            >
              保存
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="t-cap">新名字</span>
          <input
            className="input"
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && renameValue.trim() !== '') void rename()
            }}
          />
        </div>
      </Modal>

      {/* 删除确认 */}
      <Modal
        open={deleteTarget !== null}
        title="删除皮肤？"
        onClose={() => setDeleteTarget(null)}
        footer={
          <>
            <button className="btn" onClick={() => setDeleteTarget(null)}>
              取消
            </button>
            <button
              className="btn btn-primary"
              style={{ background: 'var(--danger)', color: 'var(--text-on-accent)' }}
              onClick={() => void remove()}
            >
              删除
            </button>
          </>
        }
      >
        <div className="dialog-body">
          将删除皮肤 <b>{deleteTarget?.name}</b> 及其纹理文件。
          正在使用它的账户会自动恢复默认形象。
        </div>
      </Modal>

      {busy && (
        <div className="toast-host">
          <div className="card toast info info-info">
            <Spinner />
            <div className="info-body">处理中…</div>
          </div>
        </div>
      )}
      {host}
    </div>
  )
}