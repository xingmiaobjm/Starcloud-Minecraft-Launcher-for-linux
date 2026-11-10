// 弹层自适应取证：Modal / Select 弹层 / TaskDrawer / Nova 面板在窄窗口下是否顶出屏幕。
// 这些只在交互后才挂载，shot-responsive.cjs 的逐页探针抓不到。
//
// 用法：
//   npx electron-vite build && npx electron tools/probe-overlays.cjs
// 环境变量：
//   PROBE_SIZES  默认 1360x880,860x600,480x800（宽 x 高，逗号分隔）
// 退出码：0 全部落在视口内；1 有越界（可直接挂 CI）
//
// 无 GPU 的机器同样适用：只做 DOM 度量，不截图。
// 隐藏窗口不跑合成器动画，带 both 填充的 keyframes 会卡在 from 帧，
// 所以每次度量前先 document.getAnimations().forEach(a => a.finish())。
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron')
const path = require('path')

app.disableHardwareAcceleration()

const SIZES = (process.env.PROBE_SIZES || '1360x880,860x600,480x800')
  .split(',')
  .map((s) => {
    const [w, h] = s.split('x').map(Number)
    return { width: w, height: h }
  })

const INSTALLED = [{ id: '1.20.4', sizeBytes: 24445539, isDefault: true }]
const MOCK = {
  'catalog.versions': () => ({ installed: INSTALLED, remote: [] }),
  'catalog.installed': () => ({ installed: INSTALLED }),
  'accounts.list': () => ({ accounts: [], current: null }),
  'settings.get': () => ({ gameDir: '/root/.minecraft', deviceName: 'x' }),
  'java.list': () => ({ runtimes: [] }),
  'projections.scan': () => ({ files: [], versions: [] }),
  'saves.list': () => ({ worlds: [] }),
  'skins.list': () => ({ skins: [] }),
  'plugins.list': () => ({ plugins: [] }),
  'friends.list': () => ({ friends: [], groups: [] }),
  'runtime.state': () => ({ running: false }),
  'multiplayer.state': () => ({ providers: [], activeId: null }),
  // 形状必须与 bridge 一致：NovaChatPanel 直接读 config.baseUrl.length，
  // 少字段会在面板打开瞬间白屏（mock 的坑，不是产品 bug）
  'nova.config.get': () => ({ baseUrl: '', apiKey: '', model: '', gatewayEnabled: false }),
  'starcloud.state': () => ({ loggedIn: false })
}

// 量一个选择器命中的元素是否完整落在视口内
const MEASURE = (sel) => `JSON.stringify((() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (el === null) return { found: false };
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    found: true,
    left: Math.round(r.left), right: Math.round(r.right),
    top: Math.round(r.top), bottom: Math.round(r.bottom),
    width: Math.round(r.width), height: Math.round(r.height),
    overflowX: r.right > window.innerWidth + 1 || r.left < -1,
    overflowY: r.bottom > window.innerHeight + 1 || r.top < -1,
    cssWidth: cs.width, cssMaxWidth: cs.maxWidth
  };
})())`

app.on('window-all-closed', () => undefined)

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark'
  ipcMain.handle('bridge:request', async (_e, method) => {
    const fn = MOCK[method]
    return fn !== undefined ? fn() : {}
  })
  ipcMain.handle('app:version', () => '0.4.0')
  ipcMain.handle('app:theme', () => ({ dark: true, source: 'dark' }))
  ipcMain.on('theme:set-background', () => undefined)
  ipcMain.on('win:action', () => undefined)
  ipcMain.on('win:state', (e) => {
    e.returnValue = { maximized: false, fullscreen: false, display: 0 }
  })
  ipcMain.on('win:moveBy', () => undefined)

  const rows = []

  for (const size of SIZES) {
    console.log(`\n── ${size.width}x${size.height} ──`)
    const win = new BrowserWindow({
      ...size,
      show: false,
      frame: false,
      minWidth: 480,
      minHeight: 420,
      webPreferences: {
        preload: path.join(__dirname, '..', 'out/preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    await win.loadFile(path.join(__dirname, '..', 'out/renderer/index.html'))
    await win.webContents.executeJavaScript(
      `localStorage.setItem('starcloud.theme','dark'); localStorage.setItem('starcloud.nav','collapsed'); location.reload()`
    )
    await new Promise((r) => setTimeout(r, 2500))

    const check = async (label, sel, openJs) => {
      if (openJs !== undefined) {
        await win.webContents.executeJavaScript(openJs).catch(() => false)
        await new Promise((r) => setTimeout(r, 400))
      }
      // 隐藏窗口（show:false）里合成器不跑动画，带 `both` 填充的 keyframes 会卡在
      // from 帧（translateX(24px)），量出来就是"越界 24px"。先强制把动画推到终点。
      await win.webContents
        .executeJavaScript(
          `document.getAnimations().forEach(a => { try { a.finish(); } catch (e) {} })`
        )
        .catch(() => undefined)
      await new Promise((r) => setTimeout(r, 120))
      const m = JSON.parse(await win.webContents.executeJavaScript(MEASURE(sel)))
      if (!m.found) {
        console.log(`  [miss] ${label} 未挂载`)
        return
      }
      const bad = m.overflowX || m.overflowY
      console.log(
        `  [${bad ? 'BAD' : 'ok '}] ${label}  ${m.width}x${m.height} @ (${m.left},${m.top})` +
          ` css=${m.cssWidth} max=${m.cssMaxWidth}` +
          (m.overflowX ? '  ⚠ 横向越界' : '') +
          (m.overflowY ? '  ⚠ 纵向越界' : '')
      )
      rows.push({ size, label, ...m })
    }

    // 1) 版本页 → 删除确认 Modal
    await win.webContents.executeJavaScript(
      `document.querySelector('.nav-item[data-key="versions"]').click()`
    )
    await new Promise((r) => setTimeout(r, 1200))
    await check(
      'dialog（删除确认）',
      '.dialog',
      `(() => {
        const btn = [...document.querySelectorAll('button')].find(b => (b.title || '').includes('删除'));
        if (btn === undefined) return false;
        btn.click();
        return true;
      })()`
    )
    await win.webContents.executeJavaScript(
      `(() => { const b = [...document.querySelectorAll('.dialog button')].find(x => (x.textContent||'').includes('取消')); if (b) b.click(); })()`
    )
    await new Promise((r) => setTimeout(r, 400))

    // 2) 设置页 → Select 根与弹层
    await win.webContents.executeJavaScript(
      `document.querySelector('.nav-item[data-key="settings"]').click()`
    )
    await new Promise((r) => setTimeout(r, 1500))
    // 设置页默认停在「游戏」段，Select 在「下载与资源」段
    await win.webContents.executeJavaScript(
      `(() => {
        const b = [...document.querySelectorAll('.split-aside button')].find(x => (x.textContent||'').trim() === '下载与资源');
        if (b !== undefined) b.click();
      })()`
    )
    await new Promise((r) => setTimeout(r, 700))
    await check(
      'Select 根（下载源，首选 360）',
      'div:has(> button.input)'
    )
    await check(
      'Select 弹层',
      '.flyout',
      `(() => {
        const b = [...document.querySelectorAll('button.input')].find(x => (x.title||'').includes('自动'));
        if (b === undefined) return false;
        b.click();
        return true;
      })()`
    )
    await win.webContents.executeJavaScript(
      `document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'}))`
    )
    await new Promise((r) => setTimeout(r, 400))

    // 3) Nova 面板
    await check(
      'Nova 面板',
      '.nova-flyout',
      `(() => {
        const b = document.querySelector('.tb-action-btn[title="Nova 助手"]');
        if (b === null) return false;
        b.click();
        return true;
      })()`
    )
    await win.webContents.executeJavaScript(
      `(() => { const b = document.querySelector('.tb-action-btn[title="Nova 助手"]'); if (b) b.click(); })()`
    )
    await new Promise((r) => setTimeout(r, 400))

    // 4) 任务抽屉
    await check(
      '任务抽屉',
      '[style*="slideInRight"]',
      `(() => {
        const b = document.querySelector('.tb-action-btn[title="调度中心"]');
        if (b === null) return false;
        b.click();
        return true;
      })()`
    )

    if (!win.isDestroyed()) win.destroy()
    await new Promise((r) => setTimeout(r, 200))
  }

  const bad = rows.filter((r) => r.overflowX || r.overflowY)
  console.log(
    bad.length === 0
      ? `\n✅ 弹层全部落在视口内（${rows.length} 项）`
      : `\n❌ ${bad.length}/${rows.length} 项越界：` +
        bad.map((b) => `${b.label}@${b.size.width}`).join(', ')
  )
  app.exit(bad.length === 0 ? 0 : 1)
})
