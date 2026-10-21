/// 3D 皮肤小人（Win 端 SkinFigureView 的 CSS 3D 等价物）：
/// · 六个方块（头 8³ / 身 8×12×4 / 双臂 / 双腿）贴皮肤纹理，slim 版型臂宽 3；
/// · 走路步态与 Win 的 WalkAnimator 同一套参数：φ = 秒 × 7，
///   右腿 sin×30°、左腿 -sin×30°、右臂 -sin×25°、左臂 sin×25°、头 sin×3°、
///   上身（头/身/臂）随 |sin| 下沉 0.6 皮肤像素，腿钉在地上；
/// · 拖拽转视角（yaw 0.45°/px；往下拖看到头顶）、滚轮缩放 0.7–3.0；
/// · slim 判定同 Win：64×64 皮肤 (54,20) 处 alpha = 0 即细臂。
import { useEffect, useRef, useState } from 'react'

/** 皮肤像素 → 屏幕像素的基准倍率（高度 24+8 = 32 皮肤像素）。 */
const S = 6

type Rect = [number, number, number, number] // x, y, w, h（64 宽皮肤坐标）

interface PartSpec {
  key: string
  /** 宽（皮肤像素）：头/身 8，臂 4（slim 3），腿 4 */
  w: number
  h: number
  d: number
  /** 模型坐标：中心 x、底面 y（脚底 0，头 32） */
  cx: number
  y: number
  faces: Record<'front' | 'back' | 'left' | 'right' | 'top' | 'bottom', Rect>
  /** 摆动轴心（相对部件顶部的 y 偏移，皮肤像素） */
  pivotY?: number
  swing?: 'arm-l' | 'arm-r' | 'leg-l' | 'leg-r' | 'head'
  upper?: boolean
}

const HEAD_FACES = (legacy: boolean): PartSpec['faces'] => ({
  front: [8, 8, 8, 8],
  back: [24, 8, 8, 8],
  right: [0, 8, 8, 8],
  left: [16, 8, 8, 8],
  top: [8, 0, 8, 8],
  bottom: [16, 0, 8, 8],
  // legacy 参数仅为签名一致（头没有新旧版差异）
})

const BODY_FACES: PartSpec['faces'] = {
  front: [20, 20, 8, 12],
  back: [32, 20, 8, 12],
  right: [16, 20, 4, 12],
  left: [28, 20, 4, 12],
  top: [20, 16, 8, 4],
  bottom: [28, 16, 8, 4]
}

const ARM_R_FACES: PartSpec['faces'] = {
  front: [44, 20, 4, 12],
  back: [52, 20, 4, 12],
  right: [40, 20, 4, 12],
  left: [48, 20, 4, 12],
  top: [44, 16, 4, 4],
  bottom: [48, 16, 4, 4]
}

const ARM_L_FACES: PartSpec['faces'] = {
  front: [36, 52, 4, 12],
  back: [44, 52, 4, 12],
  right: [32, 52, 4, 12],
  left: [40, 52, 4, 12],
  top: [36, 48, 4, 4],
  bottom: [40, 48, 4, 4]
}

/** slim：臂宽 3，左右臂贴图各自按新版式取（右臂 44/40/47/51，左臂 35/31/39/43）。 */
const SLIM_ARM_R: PartSpec['faces'] = {
  front: [44, 20, 3, 12],
  back: [51, 20, 3, 12],
  right: [40, 20, 4, 12],
  left: [47, 20, 4, 12],
  top: [44, 16, 3, 4],
  bottom: [47, 16, 3, 4]
}
const SLIM_ARM_L: PartSpec['faces'] = {
  front: [35, 52, 3, 12],
  back: [42, 52, 3, 12],
  right: [31, 52, 4, 12],
  left: [39, 52, 4, 12],
  top: [35, 48, 3, 4],
  bottom: [39, 48, 3, 4]
}

const LEG_R_FACES: PartSpec['faces'] = {
  front: [4, 20, 4, 12],
  back: [12, 20, 4, 12],
  right: [0, 20, 4, 12],
  left: [8, 20, 4, 12],
  top: [4, 16, 4, 4],
  bottom: [8, 16, 4, 4]
}
const LEG_L_FACES: PartSpec['faces'] = {
  front: [20, 52, 4, 12],
  back: [28, 52, 4, 12],
  right: [16, 52, 4, 12],
  left: [24, 52, 4, 12],
  top: [20, 48, 4, 4],
  bottom: [24, 48, 4, 4]
}

function buildParts(slim: boolean, legacy: boolean): PartSpec[] {
  const armW = slim ? 3 : 4
  const armX = slim ? 5.5 : 6
  // 左臂/左腿：新版式有独立贴图，64×32 旧皮肤左右共用
  const armL = legacy ? ARM_R_FACES : slim ? SLIM_ARM_L : ARM_L_FACES
  const legL = legacy ? LEG_R_FACES : LEG_L_FACES
  const armR = slim && !legacy ? SLIM_ARM_R : ARM_R_FACES
  return [
    {
      key: 'head',
      w: 8,
      h: 8,
      d: 8,
      cx: 0,
      y: 24,
      faces: HEAD_FACES(legacy),
      swing: 'head',
      upper: true
    },
    { key: 'body', w: 8, h: 12, d: 4, cx: 0, y: 12, faces: BODY_FACES, upper: true },
    {
      key: 'arm-r',
      w: armW,
      h: 12,
      d: 4,
      cx: -armX,
      y: 12,
      faces: armR,
      pivotY: 2,
      swing: 'arm-r',
      upper: true
    },
    {
      key: 'arm-l',
      w: armW,
      h: 12,
      d: 4,
      cx: armX,
      y: 12,
      faces: armL,
      pivotY: 2,
      swing: 'arm-l',
      upper: true
    },
    { key: 'leg-r', w: 4, h: 12, d: 4, cx: -2, y: 0, faces: LEG_R_FACES, pivotY: 0, swing: 'leg-r' },
    { key: 'leg-l', w: 4, h: 12, d: 4, cx: 2, y: 0, faces: legL, pivotY: 0, swing: 'leg-l' }
  ]
}

/** 读 (54,20) 判定 slim（Win 同款：64×64 皮肤该像素透明 = 细臂）。 */
function detectSlim(texture: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        if (img.width < 64 || img.height < 32) {
          resolve(false)
          return
        }
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const ctx = c.getContext('2d')
        if (ctx === null) {
          resolve(false)
          return
        }
        ctx.drawImage(img, 0, 0)
        const unit = img.width / 64
        const px = ctx.getImageData(Math.round(54 * unit), Math.round(20 * unit), 1, 1).data
        resolve(px[3] === 0)
      } catch {
        resolve(false)
      }
    }
    img.onerror = () => resolve(false)
    img.src = texture
  })
}

function faceStyle(
  texture: string,
  rect: Rect,
  size: { w: number; h: number },
  transform: string
): React.CSSProperties {
  const [x, y] = rect
  return {
    position: 'absolute',
    width: `${size.w}px`,
    height: `${size.h}px`,
    backgroundImage: `url("${texture}")`,
    backgroundSize: `${64 * S}px ${64 * S}px`,
    backgroundPosition: `${-x * S}px ${-y * S}px`,
    imageRendering: 'pixelated',
    transform,
    backfaceVisibility: 'hidden'
  }
}

export default function SkinFigure(props: {
  /** 原始皮肤纹理（data URL）。空 = 只画一个淡色占位方块。 */
  texture?: string
  /** 走路动画开关（设置 → 账号走路动画）。 */
  walking?: boolean
  /** 控件高度（px）。 */
  height?: number
}): JSX.Element {
  const height = props.height ?? 300
  const [slim, setSlim] = useState(false)
  const [legacy, setLegacy] = useState(false)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const upperRef = useRef<HTMLDivElement | null>(null)
  const partsRef = useRef<Record<string, HTMLDivElement | null>>({})
  const drag = useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 })
  const view = useRef({ yaw: -22, pitch: 6, zoom: 1 })

  // 纹理变化：识别 slim / 旧版式
  useEffect(() => {
    const texture = props.texture
    if (texture === undefined || texture === '') {
      setSlim(false)
      setLegacy(false)
      return
    }
    let alive = true
    void detectSlim(texture).then((s) => {
      if (alive) setSlim(s)
    })
    const img = new Image()
    img.onload = () => {
      if (!alive) return
      const unit = img.width / 64
      setLegacy(Math.round(img.height / unit) <= 32)
    }
    img.src = texture
    return () => {
      alive = false
    }
  }, [props.texture])

  // 相机姿态应用
  const applyView = (): void => {
    if (stageRef.current !== null) {
      stageRef.current.style.transform = `scale(${view.current.zoom}) rotateX(${-view.current.pitch}deg) rotateY(${view.current.yaw}deg)`
    }
  }

  // 走路动画：φ = 秒 × 7（Win WalkAnimator.At 同参数）
  useEffect(() => {
    let raf = 0
    const swingOf = (key: string, s: number): number => {
      switch (key) {
        case 'leg-r':
          return s * 30
        case 'leg-l':
          return -s * 30
        case 'arm-r':
          return -s * 25
        case 'arm-l':
          return s * 25
        case 'head':
          return s * 3
        default:
          return 0
      }
    }
    const tick = (): void => {
      const s = Math.sin((performance.now() / 1000) * 7)
      if (props.walking !== false) {
        for (const key of ['leg-r', 'leg-l', 'arm-r', 'arm-l', 'head']) {
          const node = partsRef.current[key]
          if (node === null || node === undefined) continue
          node.style.transform = `rotateX(${swingOf(key, s)}deg)`
        }
        if (upperRef.current !== null) {
          upperRef.current.style.transform = `translateY(${Math.abs(s) * 0.6 * S}px)`
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [props.walking])

  const parts = buildParts(slim, legacy)
  const modelH = 32 * S

  return (
    <div
      style={{
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        perspective: '900px',
        cursor: 'grab',
        userSelect: 'none',
        touchAction: 'none'
      }}
      onPointerDown={(e) => {
        drag.current = { active: true, x: e.clientX, y: e.clientY }
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        ;(e.currentTarget as HTMLElement).style.cursor = 'grabbing'
      }}
      onPointerMove={(e) => {
        if (!drag.current.active) return
        const dx = e.clientX - drag.current.x
        const dy = e.clientY - drag.current.y
        drag.current.x = e.clientX
        drag.current.y = e.clientY
        view.current.yaw += dx * 0.45
        // Win 约定：往下拖 = 抓着模型把正面往下压 = 看到头顶
        view.current.pitch = Math.max(-80, Math.min(80, view.current.pitch + dy * 0.45))
        applyView()
      }}
      onPointerUp={(e) => {
        drag.current.active = false
        ;(e.currentTarget as HTMLElement).style.cursor = 'grab'
        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      }}
      onWheel={(e) => {
        view.current.zoom = Math.max(0.7, Math.min(3, view.current.zoom * (e.deltaY < 0 ? 1.1 : 0.9)))
        applyView()
      }}
    >
      <div
        ref={stageRef}
        style={{
          width: `${24 * S}px`,
          height: `${modelH}px`,
          transformStyle: 'preserve-3d',
          transform: `scale(1) rotateX(-6deg) rotateY(-22deg)`,
          position: 'relative'
        }}
      >
        {/* 上身（头 / 身 / 双臂）：走路时随 |sin| 上下起伏 */}
        <div
          ref={upperRef}
          style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d' }}
        >
          {parts
            .filter((p) => p.upper === true)
            .map((part) => (
              <SkinPart
                key={part.key}
                part={part}
                texture={props.texture}
                modelH={modelH}
                register={(node) => {
                  partsRef.current[part.key] = node
                }}
              />
            ))}
        </div>
        {parts
          .filter((p) => p.upper !== true)
          .map((part) => (
            <SkinPart
              key={part.key}
              part={part}
              texture={props.texture}
              modelH={modelH}
              register={(node) => {
                partsRef.current[part.key] = node
              }}
            />
          ))}
      </div>
    </div>
  )
}

function SkinPart(props: {
  part: PartSpec
  texture?: string
  modelH: number
  register: (node: HTMLDivElement | null) => void
}): JSX.Element {
  const { part, modelH } = props
  const w = part.w * S
  const h = part.h * S
  const d = part.d * S
  const left = (12 + part.cx - part.w / 2) * S
  const top = modelH - (part.y + part.h) * S
  const texture = props.texture ?? ''
  const hasTexture = texture !== ''
  const tint = 'rgba(160,160,160,0.35)'

  const face = (
    rect: Rect,
    fw: number,
    fh: number,
    transform: string
  ): React.CSSProperties => {
    if (!hasTexture) {
      return {
        position: 'absolute',
        width: `${fw}px`,
        height: `${fh}px`,
        background: tint,
        transform
      }
    }
    return faceStyle(texture, rect, { w: fw, h: fh }, transform)
  }

  return (
    <div
      ref={props.register}
      style={{
        position: 'absolute',
        left: `${left}px`,
        top: `${top}px`,
        width: `${w}px`,
        height: `${h}px`,
        transformStyle: 'preserve-3d',
        transformOrigin: `50% ${(part.pivotY ?? 0) * S}px`
      }}
    >
      <div style={face(part.faces.front, w, h, `translateZ(${d / 2}px)`)} />
      <div style={face(part.faces.back, w, h, `rotateY(180deg) translateZ(${d / 2}px)`)} />
      <div style={face(part.faces.right, d, h, `rotateY(90deg) translateZ(${w / 2}px)`)} />
      <div style={face(part.faces.left, d, h, `rotateY(-90deg) translateZ(${w / 2}px)`)} />
      <div style={face(part.faces.top, w, d, `rotateX(90deg) translateZ(${h / 2}px)`)} />
      <div style={face(part.faces.bottom, w, d, `rotateX(-90deg) translateZ(${h / 2}px)`)} />
    </div>
  )
}
