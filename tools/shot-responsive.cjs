// 自适应布局取证：把同一批页面在多个窗口尺寸下渲染并落盘。
//
// 平铺窗口管理器（niri 滚动布局 / Hyprland dwindle）不会给窗口它想要的尺寸，
// 而是由 WM 决定——所以必须在"真实会被分配到的宽度"下逐个档位验证，而不是
// 只看 1360×880 的设计稿。
//
// 用法：
//   npx electron-vite build && npx electron tools/shot-responsive.cjs
//   SHOT_PAGES=home,download SHOT_SIZES=1360x880,860x600 npx electron tools/shot-responsive.cjs
//
// 环境变量：
//   STARCLOUD_SHOT_DIR  输出目录（默认 .shots/responsive）
//   SHOT_SIZES          尺寸列表，逗号分隔的 WxH（默认覆盖四个断点档位）
//   SHOT_PAGES          页面列表（nav 的 data-key），逗号分隔（默认全量）
//   SHOT_THEME          dark | light（默认 dark）
//   SHOT_SETTLE         每次截图前等待毫秒（默认 900）
//   SHOT_CLICK          页面内再点一下指定文字的按钮（逗号分隔，如 SHOT_CLICK=皮肤）
//                       用于取证嵌在别的页面里的子视图（Skins 嵌在 Accounts 内）
//
// 产物：<page>@<W>x<H>.png + layout-report.json。
// layout-report.json 记录每张图渲染时的档位判定与溢出元素，可在 CI 里断言。
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron')
const fs = require('fs')
const path = require('path')

// 取证环境（容器 / 无 GPU 的 CI）里 Chromium 的 GPU 进程起不来，
// capturePage() 会返回空图或直接崩掉渲染进程。软件合成下像素结果一致。
app.disableHardwareAcceleration()

const OUT = process.env.STARCLOUD_SHOT_DIR || path.join(__dirname, '..', '.shots', 'responsive')

// 四个档位各取一个代表宽度（断点定义见 src/renderer/src/layout.ts）：
//   1360 wide / 1100 compact / 860 narrow / 600 tiny
const SIZES = (process.env.SHOT_SIZES || '1360x880,1100x760,860x600,600x900')
  .split(',')
  .map((s) => {
    const [w, h] = s.split('x').map(Number)
    return { width: w, height: h }
  })

const PAGES = (
  process.env.SHOT_PAGES ||
  'home,versions,download,saves,friends,lab,projections,running,accounts,plugins,nova,logs,settings'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const THEME = process.env.SHOT_THEME === 'light' ? 'light' : 'dark'
const SETTLE = Number(process.env.SHOT_SETTLE || 900)
const SIGNED_IN = process.env.SHOT_SIGNED_IN === '1'
// 无 GPU 的容器里 capturePage() 返回空 buffer（拿不到像素），此时只跑度量探针。
// 布局问题本来就能靠 DOM 度量断言，截图只是给人看的辅助产物。
const CAPTURE = process.env.SHOT_NO_CAPTURE !== '1'
const CLICKS = (process.env.SHOT_CLICK || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// 稳定的示例数据（不依赖 C# 桥接，保证不同尺寸的截图可互相比较）
function iso(hoursAgo) {
  return new Date(Date.now() + hoursAgo * 36e5).toISOString()
}

const INSTALLED = [
  { id: 'neoforge-26.2.0.88', sizeBytes: 26843545, lastPlayedAt: iso(-4), isDefault: true },
  { id: 'fabric-loader-0.16.9-26.3', sizeBytes: 41210000, lastPlayedAt: iso(-50) },
  { id: '26.3-rc-3', sizeBytes: 39690000 },
  { id: '1.21.11', sizeBytes: 38040000, lastPlayedAt: iso(-120) },
  { id: '1.20.4', sizeBytes: 24445539, lastPlayedAt: iso(-26) }
]

const MOCK = {
  'catalog.versions': () => ({ installed: INSTALLED, remote: [] }),
  'catalog.installed': () => ({ installed: INSTALLED }),
  'accounts.list': () => ({
    accounts: [
      { uuid: 'a1', name: 'Notch', type: 'microsoft', hasSession: true },
      { uuid: 'c3', name: 'Steve', type: 'offline', hasSession: true }
    ],
    current: 'c3'
  }),
  'settings.get': () => ({
    gameDir: '/root/.minecraft',
    maxMemoryMb: 6144,
    downloadSource: 'auto',
    deviceName: 'starcloud-test'
  }),
  'java.list': () => ({ runtimes: [{ versionString: '17.0.20.1', majorVersion: 17 }] }),
  'projections.scan': () => ({
    files: [
      {
        filePath: '/root/.minecraft/schematics/tower.litematic',
        fileName: 'tower.litematic',
        sizeBytes: 564,
        modifiedAt: iso(0)
      },
      {
        filePath: '/root/.minecraft/versions/1.20.4/schematics/vault.schem',
        fileName: 'vault.schem',
        sizeBytes: 184320,
        modifiedAt: iso(-24),
        versionId: '1.20.4'
      }
    ],
    versions: ['1.20.4']
  }),
  'saves.list': () => ({
    worlds: [
      { name: '生存存档', versionId: '1.20.4', sizeBytes: 24117248, lastPlayedAt: iso(-3) },
      { name: '创造测试', versionId: '26.3-rc-3', sizeBytes: 8388608 }
    ]
  }),
  'skins.list': () => ({ skins: [] }),
  'plugins.list': () => ({ plugins: [] }),
  // SHOT_SIGNED_IN=1 时给好友页造两栏内容，否则它只会渲染"去登录"提示
  'friends.list': () =>
    SIGNED_IN
      ? {
          friends: [
            {
              user_id: 'u1',
              id: 'u1',
              display_name: 'A_very_long_display_name_to_stress_the_layout',
              since: iso(-24),
              unread: 3
            },
            { user_id: 'u2', id: 'u2', display_name: '小林', since: iso(-48), unread: 0 }
          ],
          groups: [
            { group_id: 'g1', name: '整合包联机', members: [] },
            { group_id: 'g2', name: '一个名字特别特别长的群组用来测试窄栏', members: [] }
          ]
        }
      : { friends: [], groups: [] },
  'runtime.state': () => ({ running: false }),
  'multiplayer.state': () => ({ providers: [], activeId: null }),
  // 形状必须与 bridge 一致：NovaChatPanel 直接读 config.baseUrl.length，
  // 少字段会在面板打开瞬间白屏（mock 的坑，不是产品 bug）
  'nova.config.get': () => ({ baseUrl: '', apiKey: '', model: '', gatewayEnabled: false }),
  'starcloud.state': () =>
    SIGNED_IN ? { loggedIn: true, userId: 'me', displayName: '我' } : { loggedIn: false }
}

// 探针：除了档位判定，还要找出"谁溢出了"。
// 只比 documentElement.scrollWidth 会误报——.bg-layer 有 transform:scale(1.05)，
// 且 body 是 overflow:hidden，真正的破版要看具体元素右边界是否越过视口。
const PROBE = `JSON.stringify((() => {
  const vw = window.innerWidth;
  const split = document.querySelector('.split');
  const aside = document.querySelector('.split-aside');
  const nav = document.querySelector('.nav');
  const content = document.querySelector('.content');
  const cs = split === null ? null : getComputedStyle(split);

  // 找出右边界越过视口、且自身没被 overflow:hidden 裁掉的元素
  const offenders = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= vw + 1) continue;
    // 被祖先裁掉的不算破版
    let clipped = false;
    for (let p = el.parentElement; p !== null; p = p.parentElement) {
      const o = getComputedStyle(p);
      if (o.overflowX === 'hidden' || o.overflowX === 'auto' || o.overflowX === 'scroll') {
        clipped = true;
        break;
      }
    }
    if (clipped) continue;
    offenders.push({
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60),
      right: Math.round(r.right),
      width: Math.round(r.width)
    });
    if (offenders.length >= 8) break;
  }

  // 硬宽残留：内联 style 里写死 >=100px 的宽度，说明这处没走自适应。
  // 只查内联 style —— CSS 里的首选宽都有 min()/clamp()/断点兜底，内联的没有。
  // 例外：被百分比 max-width 兜住的"首选宽"不算硬宽（它自己会收），
  // 例如 Select 的 width={220} + maxWidth:100%。
  const hardWidths = [];
  for (const el of document.querySelectorAll('[style]')) {
    const st = el.getAttribute('style') || '';
    const m = st.match(/(?:^|;)\\s*(?:min-|max-)?width\\s*:\\s*(\\d+)px/);
    if (m === null) continue;
    const px = Number(m[1]);
    if (px < 100) continue; // 图标/圆点/分隔线不算
    const cs3 = getComputedStyle(el);
    // 百分比/vw 的 max-width 会让它自己跟着容器收，属于"首选宽"不是硬约束
    const capped = cs3.maxWidth !== 'none' && /%|vw/.test(cs3.maxWidth);
    if (capped) continue;
    hardWidths.push({
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40),
      px,
      decl: m[0].replace(/^;/, '').trim()
    });
    if (hardWidths.length >= 10) break;
  }

  // 文字被裁：scrollWidth 超出但没配省略号，等于内容被悄悄吃掉。
  // 这是"小排版"最容易翻车的地方（11/12px 小字 + 中文长串）。
  const textClipped = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length > 0) continue; // 只看叶子文本节点
    const txt = (el.textContent || '').trim();
    if (txt.length === 0) continue;
    const cs2 = getComputedStyle(el);
    if (cs2.textOverflow === 'ellipsis') continue; // 有意省略
    if (cs2.overflowX === 'auto' || cs2.overflowX === 'scroll') continue;
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    if (el.clientWidth === 0) continue;
    textClipped.push({
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40),
      text: txt.slice(0, 24),
      scrollW: el.scrollWidth,
      clientW: el.clientWidth
    });
    if (textClipped.length >= 8) break;
  }

  return {
    innerWidth: vw,
    innerHeight: window.innerHeight,
    splitDir: cs === null ? null : cs.flexDirection,
    asideWidth: aside === null ? null : Math.round(aside.getBoundingClientRect().width),
    navWidth: nav === null ? null : Math.round(nav.getBoundingClientRect().width),
    navOpen: nav === null ? null : nav.classList.contains('nav-open'),
    contentPad: content === null ? null : Math.round(parseFloat(getComputedStyle(content).paddingTop)),
    contentScrollW: content === null ? null : content.scrollWidth,
    contentClientW: content === null ? null : content.clientWidth,
    offenders,
    hardWidths,
    textClipped
  };
})())`

function makeWindow(size) {
  const win = new BrowserWindow({
    width: size.width,
    height: size.height,
    show: false,
    frame: false,
    // 与主进程一致：minWidth/minHeight 在平铺 WM 下是硬约束，取证时也要放开
    minWidth: 480,
    minHeight: 420,
    webPreferences: {
      preload: path.join(__dirname, '..', 'out/preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[crash] ${size.width}x${size.height}: ${details.reason}`)
  })
  return win
}

// 每档位开/关一个窗口：默认 window-all-closed 会退出整个 app，
// 导致只跑完第一个尺寸就结束。
app.on('window-all-closed', () => undefined)

process.on('unhandledRejection', (e) => {
  console.error('[fatal] 未捕获的 Promise 拒绝：', e)
  app.exit(2)
})

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  nativeTheme.themeSource = THEME

  ipcMain.handle('bridge:request', async (_e, method) => {
    const fn = MOCK[method]
    return fn !== undefined ? fn() : {}
  })
  ipcMain.handle('app:version', () => '0.4.0')
  ipcMain.handle('app:theme', () => ({ dark: THEME === 'dark', source: THEME }))
  ipcMain.on('theme:set-background', () => undefined)
  ipcMain.on('win:action', () => undefined)
  ipcMain.on('win:state', (e) => {
    e.returnValue = { maximized: false, fullscreen: false, display: 0 }
  })
  ipcMain.on('win:moveBy', () => undefined)

  const report = []

  for (const size of SIZES) {
    console.log(`\n── ${size.width}x${size.height} ──`)
    // 每个尺寸开一个新窗口：setContentSize 反复改尺寸会让渲染进程在
    // 无 GPU 的软件合成路径下崩掉（"Object has been destroyed"）。
    const win = makeWindow(size)
    try {
      await win.loadFile(path.join(__dirname, '..', 'out/renderer/index.html'))
      // 与真实启动路径一致：先写主题/导航偏好再 reload
      await win.webContents.executeJavaScript(
        `localStorage.setItem('starcloud.theme', '${THEME}'); ` +
          `localStorage.setItem('starcloud.nav', 'collapsed'); location.reload()`
      )
      await new Promise((r) => setTimeout(r, 2500))
    } catch (e) {
      console.error(`[skip] ${size.width}x${size.height} 窗口准备失败：${e.message}`)
      if (!win.isDestroyed()) win.destroy()
      continue
    }

    for (const page of PAGES) {
      if (win.isDestroyed()) break
      const clicked = await win.webContents
        .executeJavaScript(
          `(() => {
            const el = document.querySelector('.nav-item[data-key="${page}"]');
            if (el === null) return false;
            el.click();
            return true;
          })()`
        )
        .catch(() => false)
      if (clicked !== true) {
        console.warn(`[skip] 找不到导航项 ${page}`)
        continue
      }
      // 先等首屏数据回来，否则二级点击找不到目标（列表还是空的）
      await new Promise((r) => setTimeout(r, CLICKS.length > 0 ? 1200 : 0))

      // 页面内的二级跳转（例如从「账户」进「皮肤」子视图）
      for (const text of CLICKS) {
        const hit = await win.webContents
          .executeJavaScript(
            `(() => {
              const t = ${JSON.stringify(text)};
              for (const el of document.querySelectorAll('button, [role=tab], .nav-item, .row')) {
                if ((el.textContent || '').trim().includes(t)) { el.click(); return true; }
              }
              return false;
            })()`
          )
          .catch(() => false)
        if (hit !== true) console.warn(`[skip] 找不到按钮「${text}」`)
        await new Promise((r) => setTimeout(r, 500))
      }

      await new Promise((r) => setTimeout(r, SETTLE))
      if (win.isDestroyed()) break

      // 隐藏窗口不跑合成器动画：带 both 填充的 keyframes 会卡在 from 帧，
      // 量出来是"整体偏移 24px"的假越界。先把动画推到终点再量。
      await win.webContents
        .executeJavaScript(
          `document.getAnimations().forEach(a => { try { a.finish(); } catch (e) {} })`
        )
        .catch(() => undefined)
      await new Promise((r) => setTimeout(r, 120))

      let probe
      try {
        probe = JSON.parse(await win.webContents.executeJavaScript(PROBE))
      } catch (e) {
        console.warn(`[skip] ${page}@${size.width}x${size.height}: 探针失败 ${e.message}`)
        continue
      }

      const name = `${page}@${size.width}x${size.height}.png`
      if (CAPTURE) {
        try {
          const png = (await win.webContents.capturePage()).toPNG()
          // 空 buffer = 这台机器没有可用的合成后端，落盘会得到 0 字节文件
          if (png.length > 0) fs.writeFileSync(path.join(OUT, name), png)
          else console.warn(`[warn] ${name}: 截图为空，跳过落盘（度量结果仍有效）`)
        } catch (e) {
          console.warn(`[warn] ${name}: 截图失败 ${e.message}`)
        }
      }

      const bad = probe.offenders.length > 0
      const hard = probe.hardWidths.length > 0
      const clipped = probe.textClipped.length > 0
      console.log(
        `[shot] ${name}  dir=${probe.splitDir} aside=${probe.asideWidth} ` +
          `nav=${probe.navWidth}${probe.navOpen ? '(open)' : ''} pad=${probe.contentPad}` +
          (bad ? ` ⚠ 溢出 ${probe.offenders.length} 处` : '') +
          (hard ? ` ⚠ 硬宽 ${probe.hardWidths.length} 处` : '') +
          (clipped ? ` ⚠ 文字被裁 ${probe.textClipped.length} 处` : '')
      )
      if (bad) {
        for (const o of probe.offenders) {
          console.log(`        ↳ 溢出 <${o.tag} class="${o.cls}"> right=${o.right} w=${o.width}`)
        }
      }
      if (hard) {
        for (const o of probe.hardWidths) {
          console.log(`        ↳ 硬宽 <${o.tag} class="${o.cls}"> ${o.decl}`)
        }
      }
      if (clipped) {
        for (const o of probe.textClipped) {
          console.log(
            `        ↳ 裁字 <${o.tag} class="${o.cls}"> "${o.text}" ${o.scrollW}>${o.clientW}`
          )
        }
      }
      report.push({ page, size, ...probe })
    }

    if (!win.isDestroyed()) win.destroy()
    await new Promise((r) => setTimeout(r, 200))
  }

  fs.writeFileSync(path.join(OUT, 'layout-report.json'), JSON.stringify(report, null, 2))

  const overflow = report.filter((r) => r.offenders.length > 0)
  const hardLeft = report.filter((r) => r.hardWidths.length > 0)
  const clippedLeft = report.filter((r) => r.textClipped.length > 0)

  if (overflow.length > 0) {
    console.error(`\n❌ ${overflow.length}/${report.length} 张截图有元素越过视口右边界`)
    for (const r of overflow) console.error(`   ${r.page}@${r.size.width}x${r.size.height}`)
  } else {
    console.log(`\n✅ ${report.length} 张截图均无横向溢出（${OUT}）`)
  }
  if (hardLeft.length > 0) {
    console.error(`❌ ${hardLeft.length}/${report.length} 张截图仍有内联硬宽`)
    for (const r of hardLeft) {
      const decls = [...new Set(r.hardWidths.map((h) => `${h.cls || h.tag}:${h.px}`))]
      console.error(`   ${r.page}@${r.size.width}x${r.size.height} → ${decls.join(', ')}`)
    }
  }
  if (clippedLeft.length > 0) {
    console.error(`❌ ${clippedLeft.length}/${report.length} 张截图有文字被裁`)
    for (const r of clippedLeft) {
      const txt = [...new Set(r.textClipped.map((t) => `"${t.text}"`))]
      console.error(`   ${r.page}@${r.size.width}x${r.size.height} → ${txt.join(', ')}`)
    }
  }

  const failed = overflow.length > 0 || hardLeft.length > 0 || clippedLeft.length > 0
  app.exit(failed ? 1 : 0)
})
