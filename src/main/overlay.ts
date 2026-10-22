/// Nova 游戏内浮窗（对齐 Win 端 NovaOverlayWindow）：
/// 游戏运行时贴在屏幕角落的置顶小窗，Nova 有话时冒一句提示；
/// 点它打开主窗口的 Nova 对话。开关默认关（开启即显式授权）。
///
/// 实现方式：Electron 第二个 BrowserWindow（透明 + 无边框 + 置顶），
/// 加载同一个渲染入口但走 ?overlay=1 分支，只渲染浮窗内容。
import { BrowserWindow, nativeTheme, screen } from 'electron'
import path from 'node:path'

let overlay: BrowserWindow | null = null

/** 浮窗当前显示的文案（空 = 隐藏）。 */
let currentText = ''
let onOpenChat: (() => void) | null = null

export function setOverlayOpenHandler(handler: () => void): void {
  onOpenChat = handler
}

function overlayBounds(): { x: number; y: number; width: number; height: number } {
  const area = screen.getPrimaryDisplay().workArea
  const width = 380
  const height = 132
  return {
    x: area.x + area.width - width - 24,
    y: area.y + area.height - height - 24,
    width,
    height
  }
}

/** 显示一条提示（5 秒后自动收起，Win 端同款）。 */
export function showOverlay(text: string): void {
  currentText = text
  if (overlay === null || overlay.isDestroyed()) {
    overlay = new BrowserWindow({
      ...overlayBounds(),
      frame: false,
      transparent: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f3f3f3',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })
    const devUrl = process.env.ELECTRON_RENDERER_URL
    const url = devUrl !== undefined ? `${devUrl}/overlay.html` : `file://${path.join(__dirname, '../renderer/overlay.html')}`
    // 页面加载完再推文案：loadURL 未完成时 send 会丢消息，浮窗就只有徽标没有正文
    overlay.webContents.once('did-finish-load', () => {
      if (overlay !== null && !overlay.isDestroyed() && currentText !== '') {
        overlay.webContents.send('overlay:text', currentText)
      }
    })
    void overlay.loadURL(url)
    overlay.on('closed', () => {
      overlay = null
    })
    overlay.setBounds(overlayBounds())
    overlay.showInactive()
    // 5 秒后自动收起（留时间读完）
    setTimeout(() => {
      if (overlay !== null && !overlay.isDestroyed() && currentText === text) overlay.hide()
    }, 5000)
    return
  }
  overlay.setBounds(overlayBounds())
  overlay.webContents.send('overlay:text', currentText)
  overlay.showInactive()
  // 5 秒后自动收起（留时间读完）
  setTimeout(() => {
    if (overlay !== null && !overlay.isDestroyed() && currentText === text) overlay.hide()
  }, 5000)
}

export function hideOverlay(): void {
  currentText = ''
  if (overlay !== null && !overlay.isDestroyed()) overlay.hide()
}

/** 浮窗被点击 → 打开主窗口的 Nova 对话。 */
export function overlayClicked(): void {
  onOpenChat?.()
  hideOverlay()
}

export function isOverlayOpen(): boolean {
  return overlay !== null && !overlay.isDestroyed() && overlay.isVisible()
}
