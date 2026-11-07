# Starcloud Minecraft Launcher · Linux

Starcloud Minecraft 启动器的 **Linux 端**（Electron + React + TypeScript）。
界面按 WinUI 3 / Fluent Design 规范实现，运行在 Linux（X11 优先，Wayland 有已知问题）。
功能面对齐 Win 端 0.4.0（下载 / 启动 / 账户 / 好友与群聊 / 联机 / Nova / 实验室 / 皮肤站衣柜 …）。

> 内核（下载 / 安装 / 启动 / 账户 / 联机 / Nova …）在 C# 侧实现，本仓库通过
> `Starcloud.Bridge` 进程复用，**不重写一份 TS 后端**。
> 桥接源码在主仓库 [`Starcloud-Minecraft-Launcher`](https://github.com/xingmiaobjm/Starcloud-Minecraft-Launcher) 的 `dotnet/` 下。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 取得 C# 桥接（见下方「桥接」）
./scripts/fetch-bridge.sh

# 3. 开发（Vite + Electron，热更新）
npm run dev

# 4. 打包
npm run package        # deb + AppImage → release/
```

开发环境若在 WSL / 容器 / root 下运行，需要：

```bash
ELECTRON_DISABLE_SANDBOX=1 npm run dev
```

## 功能总览

导航页与能力（与 Win 端 0.4.0 一一对应）：

- **首页**：版本列表（右键菜单：问 Nova / 置顶 / 收藏 / 删除 …）、账户卡与启动
- **版本**：17 项右键操作（启动 / 文件夹 / 重命名 / 复制 / 导出·导入整合包 / 备份回档 …），
  整合包导入为方式选择弹窗（拖入文件 / 选择文件 / 从链接导入）
- **下载**：原版 / Mod / 整合包 / 数据包 / 资源包 / 光影，中文搜索翻译与一键安装
- **存档**：列表 / 备份 / 回档 / 复制到其他版本 / 分享包导入导出
- **好友**：申请与联机邀请、QQ 式两栏聊天、**群聊与文件传输**（图片 / 视频 / 文件气泡，
  实时推送 + 20s 轮询兜底）、创建群 / 群成员管理
- **实验室**：投影工坊（.litematic / 世吞模板）、彩色文字
- **投影管理**：全局与各版本投影扫描 / 复制 / 移动 / 删除
- **运行状态**：运行卡、CPU / 内存 / 显卡实时曲线、启动配置与 JVM、实时日志、采样设置
- **账户**：正版 / 外置 / 离线，账户详情内嵌**本地皮肤库**（3D 小人）与
  **皮肤站衣柜**（Blessing Skin 6：浏览器 OAuth 授权 → 皮肤 / 披风一键换装）
- **插件**：.mclplug 安装 / 启停 / 面板
- **Nova**：云端模型（Starcloud ID）或自接 OpenAI 兼容服务、游戏内浮窗、计划执行
- **设置**：游戏 / Java / 下载与资源 / 通用（主页版本列表、动效、背景）/ 跨设备
  （存档同步、传递优化、令牌加密）

暂未跟进而 Win 端已在开发分支（`feature/home-grid-and-perf`）的能力：游玩时长统计、
主页可编辑网格、7z / rar / tar.gz 整合包容器 —— 等该分支合入 main 后随桥接补齐。

## 桥接（Starcloud.Bridge）

界面本身可独立运行（缺桥接时会显示空列表并报「桥接进程未运行」），
但要让下载 / 启动生效，需要把 C# 桥接发布到 `bridge-linux-x64/`：

```bash
# 已有主仓库副本时（默认路径 ../starcloud-minecraft-launcher）
./scripts/fetch-bridge.sh

# 或手动指定主仓库路径
./scripts/fetch-bridge.sh /path/to/starcloud-minecraft-launcher

# 或让脚本克隆主仓库（较慢）
STARCLOUD_CLONE=1 ./scripts/fetch-bridge.sh
```

也可以直接用环境变量指定 DLL：

```bash
STARCLOUD_BRIDGE_DLL=/abs/path/Starcloud.Bridge.dll npm run dev
```

桥接以 stdio 行式 JSON 暴露约 140 个方法（`catalog.*` / `versions.*` / `launch.*` /
`runtime.*` / `friends.*`（含群聊与文件上传下载）/ `skins.*`（本地库 + BS6 衣柜）/
`saves.*` / `content.*` / `plugins.*` / `nova.*` / `lab.*` / `settings.*` …），
好友实时事件由桥接内建 SSE 循环转发为 `friends.event`；长任务走 `install.*` /
`modpack.progress` 等事件流。界面（`bridge.ts`）只做 DTO 映射，不重写后端逻辑。

## 工程结构

```
src/
  main/index.ts        主进程：窗口骨架（无边框 + 自绘标题栏）、C# 桥接进程管理、IPC
  preload/index.ts     contextBridge 暴露 bridge / bridgeEvents / theme / win
  renderer/
    index.html
    src/
      main.tsx         入口：先定主题再 render（避免首帧闪白）
      App.tsx          应用壳：标题栏 + 导航 + 内容区 + 主题
      nav.tsx          NavigationView（鸿蒙图标库字形 + 两个自绘 SVG）
      titlebar.tsx     Fluent 标题栏（最小化/最大化/关闭，Wayland 拖拽兜底）
      theme.ts         亮/暗/跟随系统 + 窗口底色同步
      winui.css        WinUI 3 视觉层（令牌、材质、控件、动效）
      bridge.ts        桥接客户端（浏览器调试时自动降级为 mock）
      ui.tsx           共用原子（Modal / Toast / Segmented / 右键菜单 …）
      pages/           18 个页面（含好友群聊、皮肤站衣柜、联机板块等子页）
      assets/          HarmonyOS Icons 字体、Inter、MC-Icons、品牌 SVG
tools/                 取证与截图脚本（非运行时依赖）
```

## 设计与移植说明

- **设计令牌**：取自 Win 端 `App.xaml` 与实际渲染值，见 [`DESIGN.md`](./DESIGN.md)。
  圆角 8/16、动效 `Pace=1.5`（进场 375ms / 退场 210ms / 悬停 300→450ms / 错峰 39ms）、
  四条缓动曲线（进场 / 退场 / 控件 / 明暗渐变）。
- **图标**：导航图标用**鸿蒙图标库字体**（与 Win 端同一份 ttf，码位一一对应）；
  「实验室」「投影管理」是**自绘 SVG**；版本行用仓库 `MC-Icons` 的等距方块图。
- **材质**：Linux 没有原生 Mica/Acrylic，用 `backdrop-filter` + 分层渐变模拟，
  `[data-blur="off"]` 可降级为纯色（软件渲染 / WSLg 下更稳）。

### Linux 平台已知问题

| 现象 | 原因 | 规避 |
|---|---|---|
| 窗口圆角被 WM 覆盖 | X11 下窗口形状由 WM 决定 | 窗口不透明，圆角交给 CSS |
| 首帧闪白 | 主题在 effect 里才写入，浏览器已合成一帧 | `main.tsx` 挂载前写入 `data-theme` |
| Wayland 下标题栏拖不动 | `-webkit-app-region` 依赖 X11 `_NET_WM_MOVERESIZE` | 标题栏内置 JS 拖拽兜底（IPC `win:moveBy`） |
| `backdrop-filter` 掉帧 | 软件渲染 / WSLg 无 GPU | 模糊只铺装饰层，可关 |
| 字体缺字 / 图标空白 | 依赖 CDN 字体 | 字体与图标字体全部本地打包 |
| root / 容器 / WSL 里起不来 | Chromium 沙箱不可用，且根检查早于 `app.commandLine` | **命令行**传 `--no-sandbox`（见下方 WSL 一节） |

## WSL 实机测试

WSL2 + WSLg（Ubuntu 24.04 已验证）可以直接跑起来，UI 与桥接都是真环境：

```bash
# 0) 仓库先拷出 /mnt/c（九宫格文件系统上 npm install 又慢又容易半途失败）
rsync -a --exclude node_modules --exclude out --exclude 'bridge-*-x64' \
  /mnt/c/<你的路径>/starcloud-launcher-linux/ ~/sc-linux/
cd ~/sc-linux

# 1) 依赖（国内网络用 Electron 镜像，否则二进制下载会卡住/失败）
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install

# 2) 桥接（WSL 里装 .NET SDK 8+；用主仓源码发布 linux-x64 产物）
dotnet publish /mnt/c/<你的路径>/starcloud-minecraft-launcher/dotnet/src/Starcloud.Bridge \
  -c Release -r linux-x64 --self-contained false -o bridge-linux-x64

# 3) 构建 + 启动（--no-sandbox 必须走命令行参数，写在 app 代码里来不及）
npm run build
./node_modules/.bin/electron . --no-sandbox --disable-gpu
```

截图取证（无窗口环境也能用，产物是 PNG）：

```bash
STARCLOUD_SCREENSHOT=/root/shot.png STARCLOUD_SCREENSHOT_PAGE=friends \
  ./node_modules/.bin/electron . --no-sandbox --disable-gpu
```

两个 WSL 特有的坑：

- **一次性 `wsl.exe` 命令结束后虚拟机就会停**，`/tmp` 是内存盘会被清空。
  产物放 `~`，并在同一条命令里 `cp` 到 `/mnt/c`，否则下一次调用就找不到了。
- 启动/退出瞬间的 `GPU process launch failed` / `GPU process isn't usable`
  是 WSLg 下 GPU 进程被回收的噪音；加 `--disable-gpu` 后 UI 由软件渲染正常显示。

## 打包

```bash
npm run package        # deb + AppImage
npm run package:dir    # 只出未压缩目录，便于排查
```

`electron-builder.yml` 会把 `../bridge-linux-x64` 作为 `extraResources` 打进包里
（**打包前先跑 `scripts/fetch-bridge.sh`**，否则安装包里没有桥接）。

产物在 `release/`：

- `starcloud-launcher-linux_x.y.z_amd64.deb`
- `Starcloud Launcher-x.y.z.AppImage`

## 提交规范

与主仓库一致的 conventional commits：`type(scope): 中文主题`，正文中文、一段话说清动机与验证。

常用 type：`feat` / `fix` / `perf` / `docs` / `chore` / `refactor` / `test`。
scope 按模块取：`home` / `versions` / `download` / `saves` / `friends`（群聊/文件传输）/
`lab` / `projections` / `running` / `accounts` / `skins` / `plugins` / `nova` / `settings` /
`logs` / `bridge`（与 C# 桥接的契约变化）/ `titlebar` / `theme`。

示例：`feat(friends): 群聊与附件气泡，实时事件替代轮询兜底`。

历史说明：`main` 上 2026-11-08 之前的提交未采用该格式（沿用早期的自由格式），
不做重写；自本文件起统一执行。

## 许可

AGPL-3.0，见 [LICENSE](./LICENSE)。
