/// 窗口尺寸自适应档位。
///
/// ── 为什么需要这个 ──────────────────────────────────────────────────────
/// 平铺窗口管理器（niri 滚动布局、Hyprland dwindle/master、sway）不按"窗口
/// 偏好尺寸"摆放，而是把窗口塞进 WM 算出的格子里。用户在 niri 里把一列拉窄
/// 到 600px、或在 Hyprland 里 master-stack 半屏分栏，窗口实际宽度会远小于
/// 1360。此时界面里写死的 `width: 240` 侧栏、`width: 330` 分段控件就会互相
/// 挤压甚至溢出。
///
/// ── 三档 ────────────────────────────────────────────────────────────────
/// | 档位    | 宽度       | 处理                                        |
/// |---------|-----------|---------------------------------------------|
/// | wide    | > 1180    | 原样（对齐 Win 端 1360 设计稿）              |
/// | compact | ≤ 1180    | 侧栏收窄、内边距减小、导航强制收起            |
/// | narrow  | ≤ 900     | 两栏改纵向堆叠、弹层/抽屉贴边                |
///
/// 用 `useSyncExternalStore` 而不是每处各自 `useState + resize`：所有页面共享
/// 同一份快照，一次 resize 只触发一次重渲染，且不会出现"两个页面算出不同档位"
/// 的撕裂。resize 用 rAF 合并，拖动窗口边缘时不会每像素重渲染。
import { useSyncExternalStore } from 'react'

/** compact 档上限：再窄就放不下 240 侧栏 + 内容区最小可用宽度。 */
const COMPACT_MAX = 1180
/** narrow 档上限：两栏并排已不可用，改纵向堆叠。 */
const NARROW_MAX = 900

export interface LayoutInfo {
  /** 当前窗口内宽（CSS 像素）。 */
  width: number
  /** 窗口高度。niri 的滚动布局会给出很矮的窗口，纵向也需要收。 */
  height: number
  /** 紧凑档：侧栏收窄、内边距减小。 */
  compact: boolean
  /** 窄档：两栏布局改纵向堆叠，弹层贴边。 */
  narrow: boolean
  /** 极矮档：窗口高度不足，纵向间距收紧。 */
  short: boolean
}

function measure(): LayoutInfo {
  // SSR / 测试环境（tools/shot-themes.cjs 也是真实渲染，window 存在）
  const width = typeof window === 'undefined' ? 1440 : window.innerWidth
  const height = typeof window === 'undefined' ? 900 : window.innerHeight
  return {
    width,
    height,
    compact: width <= COMPACT_MAX,
    narrow: width <= NARROW_MAX,
    short: height <= 640
  }
}

let snapshot: LayoutInfo = measure()
const listeners = new Set<() => void>()
let frame = 0

function recompute(): void {
  frame = 0
  const next = measure()
  if (
    next.width === snapshot.width &&
    next.height === snapshot.height &&
    next.compact === snapshot.compact &&
    next.narrow === snapshot.narrow &&
    next.short === snapshot.short
  ) {
    return
  }
  snapshot = next
  for (const listener of listeners) listener()
}

function schedule(): void {
  if (frame !== 0) return
  frame = requestAnimationFrame(recompute)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    window.addEventListener('resize', schedule)
    // 平铺 WM 也可能通过其它途径改变尺寸（全屏切换、缩放比例变化）
    window.addEventListener('orientationchange', schedule)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      window.removeEventListener('resize', schedule)
      window.removeEventListener('orientationchange', schedule)
      if (frame !== 0) {
        cancelAnimationFrame(frame)
        frame = 0
      }
    }
  }
}

function getSnapshot(): LayoutInfo {
  // resize 事件可能在首帧前就被别的路径改了尺寸，这里补一次测量
  if (snapshot.width !== window.innerWidth || snapshot.height !== window.innerHeight) {
    snapshot = measure()
  }
  return snapshot
}

/** 订阅窗口尺寸档位。所有组件共享同一份快照。 */
export function useLayout(): LayoutInfo {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** 非组件场景（事件回调里算一次）读取当前档位。 */
export function readLayout(): LayoutInfo {
  return getSnapshot()
}
