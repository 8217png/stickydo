import { useEffect, useMemo, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { currentNoteSize, notesOnBoard, useNotes } from './store'
import { StickyNote } from './StickyNote'
import { setBoardViewport } from './viewport'
import { GRID } from './layout'
import { clampZoom, nextZoomStep, setCanvasZoom, setZoomControls, useZoom } from './zoom'
import { MORPH_LIMIT } from '../view'
import { load, save } from '../../lib/storage'

/** 拖动超过这个距离才算平移画布，否则仍是单击（取消选中）和双击（新建） */
const PAN_THRESHOLD = 3
/** 点阵底纹的间距（100% 时）；缩小后太密就隔一个画一个 */
const DOT_GAP = 24

/** 镜头：可见区域左上角对应的画布坐标，和缩放比例 */
type Camera = { x: number; y: number; z: number }

/** 每块白板看到的位置和比例，记在本机，刷新后回到原处 */
const CAMERA_KEY = 'stickydo.camera'
const cameras = new Map<string, Camera>(
  Object.entries(load<Record<string, Partial<Camera>>>(CAMERA_KEY) ?? {}).map(([k, c]) => [
    k,
    { x: Number(c.x) || 0, y: Number(c.y) || 0, z: clampZoom(Number(c.z) || 1) },
  ]),
)
let saveTimer: ReturnType<typeof setTimeout> | undefined
function rememberCamera(key: string, cam: Camera) {
  cameras.set(key, cam)
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => save(CAMERA_KEY, Object.fromEntries(cameras)), 300)
}

/** 镜头对应的画布图层 transform 和点阵底纹；平移、缩放时直接写到 DOM，换白板时也用于首次渲染 */
function cameraStyles(c: Camera) {
  const tx = Math.round(-c.x * c.z)
  const ty = Math.round(-c.y * c.z)
  let gap = DOT_GAP * c.z
  while (gap < 12) gap *= 2
  return {
    canvas: { transform: `translate(${tx}px, ${ty}px) scale(${c.z})` },
    surface: { backgroundSize: `${gap}px ${gap}px`, backgroundPosition: `${tx}px ${ty}px` },
  }
}

const savedCamera = (key: string): Camera => cameras.get(key) ?? { x: 0, y: 0, z: 1 }

/** 焦点在输入框里（编辑器除外）：Shift+1 之类的单键不生效 */
const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null
  return e.isComposing || (!!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))
}

/**
 * 一块白板：收件箱（boardId 为 null）或某个看板。
 * 画布没有边界：便利贴可以放在任何位置（包括负坐标），在空白处按住拖动、或用滚轮 / 触控板平移整块画布。
 * 可以缩放（25%–200%）：Ctrl / ⌘ + 滚轮、触控板双指捏合、触屏双指缩放、右下角的控件和快捷键。
 * 平移、缩放只改画布图层的 transform（不触发 React 渲染），便利贴再多也跟手。
 */
export function Whiteboard({ boardId }: { boardId: string | null }) {
  const allNotes = useNotes((s) => s.notes)
  const boards = useNotes((s) => s.boards)
  const notes = useMemo(() => notesOnBoard({ notes: allNotes, boards }, boardId), [allNotes, boards, boardId])
  const notesRef = useRef(notes)
  notesRef.current = notes
  const hydrated = useNotes((s) => s.hydrated)
  const morph = notes.length <= MORPH_LIMIT
  const surfaceRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const grabRef = useRef<HTMLDivElement>(null)
  const pointer = useRef<{ x: number; y: number } | null>(null)
  // 这块白板打开时的镜头：首次渲染就写进画布的 style（便利贴挂载时画布已经是这个比例，见 zoom.ts canvasZoom）。
  // 之后的平移、缩放直接改 DOM；这里的值只在换白板时变化，React 不会覆盖
  const initialCamera = useMemo(() => savedCamera(boardId ?? 'inbox'), [boardId])
  const initialStyles = useMemo(() => cameraStyles(initialCamera), [initialCamera])
  const renderedBoard = useRef<string | null>(null)
  if (renderedBoard.current !== (boardId ?? 'inbox')) {
    renderedBoard.current = boardId ?? 'inbox'
    setCanvasZoom(initialCamera.z)
  }
  const cam = useRef<Camera>(initialCamera)
  const anim = useRef(0)
  const settleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const boardKey = boardId ?? 'inbox'
  const keyRef = useRef(boardKey)
  keyRef.current = boardKey

  /**
   * 移动镜头：直接改画布图层的 transform 和点阵底纹。
   * 移动期间把图层提升为合成层（will-change），停下 200ms 后撤掉，让浏览器按新比例重新绘制，文字不发虚
   */
  const moveCamera = (x: number, y: number, z = cam.current.z, remember = true) => {
    const c = { x, y, z: clampZoom(z) }
    cam.current = c
    const st = cameraStyles(c)
    const canvas = canvasRef.current
    if (canvas) {
      canvas.style.willChange = 'transform'
      canvas.style.transform = st.canvas.transform
    }
    const surface = surfaceRef.current
    if (surface) Object.assign(surface.style, st.surface)
    setCanvasZoom(c.z)
    if (useZoom.getState().zoom !== c.z) useZoom.setState({ zoom: c.z })
    clearTimeout(settleTimer.current)
    settleTimer.current = setTimeout(() => {
      if (canvasRef.current) canvasRef.current.style.willChange = ''
    }, 200)
    if (remember) rememberCamera(keyRef.current, c)
  }

  /** 以屏幕上的某一点（相对白板左上角）为中心缩放：这一点下面的画布内容不动 */
  const zoomAround = (z: number, sx: number, sy: number, from: Camera = cam.current): Camera => {
    const nz = clampZoom(z)
    return { x: from.x + sx / from.z - sx / nz, y: from.y + sy / from.z - sy / nz, z: nz }
  }

  const stopAnimation = () => cancelAnimationFrame(anim.current)

  /** 平滑过渡到另一个镜头；anchor 给出时，缩放过程中这一点保持不动（按钮、快捷键缩放） */
  const glide = (to: Camera, anchor?: { x: number; y: number }) => {
    stopAnimation()
    const from = { ...cam.current }
    const t0 = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 380)
      const e = 1 - Math.pow(1 - t, 3)
      // 比例按对数插值，放大缩小的速度看起来均匀
      const z = from.z * Math.pow(to.z / from.z, e)
      if (anchor) {
        const c = zoomAround(z, anchor.x, anchor.y, from)
        moveCamera(c.x, c.y, c.z, t === 1)
      } else moveCamera(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e, z, t === 1)
      if (t < 1) anim.current = requestAnimationFrame(step)
    }
    anim.current = requestAnimationFrame(step)
  }

  const viewSize = () => {
    const el = surfaceRef.current
    return { w: el?.clientWidth ?? window.innerWidth, h: el?.clientHeight ?? window.innerHeight }
  }

  /** 以可见区域中央为中心缩放到 z */
  const zoomToCenter = (z: number) => {
    const { w, h } = viewSize()
    glide(zoomAround(z, w / 2, h / 2), { x: w / 2, y: h / 2 })
  }

  /** 显示全部便利贴：缩放到刚好装下（最多 100%），并居中 */
  const fitAll = () => {
    const list = notesRef.current
    if (!list.length) return glide({ x: 0, y: 0, z: 1 })
    const { w, h } = viewSize()
    const minX = Math.min(...list.map((n) => n.x))
    const minY = Math.min(...list.map((n) => n.y))
    const maxX = Math.max(...list.map((n) => n.x + n.w))
    const maxY = Math.max(...list.map((n) => n.y + n.h))
    // 四周留出顶栏、右下角控件和操作栏的位置
    const pad = { x: GRID.side, top: GRID.top, bottom: 72 }
    const z = clampZoom(Math.min(1, (w - pad.x * 2) / (maxX - minX), (h - pad.top - pad.bottom) / (maxY - minY)))
    glide({
      x: (minX + maxX) / 2 - w / 2 / z,
      y: (minY + maxY) / 2 - (pad.top + (h - pad.top - pad.bottom) / 2) / z,
      z,
    })
  }

  useEffect(() => {
    // 让键盘快捷键（N、粘贴）知道当前可见区域，新建的便利贴落在视野里
    setBoardViewport(() => {
      const el = surfaceRef.current
      if (!el) return null
      const { x, y, z } = cam.current
      return {
        left: x,
        top: y,
        width: el.clientWidth / z,
        height: el.clientHeight / z,
        zoom: z,
        pointer: pointer.current,
        scrollTo: (left: number, top: number) => glide({ x: left, y: top, z: cam.current.z }),
      }
    })
    setZoomControls({
      step: (dir) => zoomToCenter(nextZoomStep(cam.current.z, dir)),
      zoomTo: zoomToCenter,
      fit: fitAll,
    })
    return () => {
      setBoardViewport(null)
      setZoomControls(null)
      stopAnimation()
      clearTimeout(settleTimer.current)
    }
  }, [])

  // 换到另一块白板：回到这块白板上次看的位置和比例；第一次打开时，便利贴都不在视野里就移到它们那里。取消选中
  useEffect(() => {
    stopAnimation()
    moveCamera(initialCamera.x, initialCamera.y, initialCamera.z, false)
    useNotes.getState().select(null)
  }, [boardKey])

  useEffect(() => {
    if (!hydrated || cameras.has(boardKey) || notes.length === 0) return
    const el = surfaceRef.current
    if (!el) return
    const { x, y, z } = cam.current
    const w = el.clientWidth / z
    const h = el.clientHeight / z
    const inView = notes.some((n) => n.x + n.w > x && n.x < x + w && n.y + n.h > y && n.y < y + h)
    if (!inView) {
      moveCamera(Math.min(...notes.map((n) => n.x)) - GRID.side, Math.min(...notes.map((n) => n.y)) - GRID.top, 1, false)
    }
    // 只在打开白板、读完本地数据时看一次
  }, [hydrated, boardKey])

  // 滚轮 / 触控板：平移；Ctrl / ⌘ + 滚轮（触控板双指捏合也是这个事件）以鼠标为中心缩放。
  // 要能 preventDefault（不让浏览器缩放整页），所以不用 React 的 onWheel
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const zoom = e.ctrlKey || e.metaKey
      // 正在编辑的便利贴、菜单里自己滚动
      if (!zoom && e.target instanceof Element && e.target.closest('[data-editing="true"], [role="menu"]')) return
      e.preventDefault()
      stopAnimation()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1
      const { x, y, z } = cam.current
      if (zoom) {
        // 鼠标滚轮一格约 ±100，触控板捏合每次只有几；限幅后按指数缩放，两种都顺手
        const d = Math.max(-40, Math.min(40, e.deltaY * unit))
        const r = el.getBoundingClientRect()
        const c = zoomAround(z * Math.exp(-d * 0.008), e.clientX - r.left, e.clientY - r.top)
        moveCamera(c.x, c.y, c.z)
        return
      }
      let dx = e.deltaX * unit
      let dy = e.deltaY * unit
      // 鼠标滚轮按住 Shift 横向移动
      if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0]
      moveCamera(x + dx / z, y + dy / z)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // 快捷键：Ctrl / ⌘ + = / - 放大缩小，Ctrl / ⌘ + 0 回到 100%，Shift + 1 显示全部便利贴。
  // 在白板上时接管浏览器自己的整页缩放（编辑便利贴时也一样）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && !e.altKey && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
        e.preventDefault()
        if (e.key === '0') zoomToCenter(1)
        else zoomToCenter(nextZoomStep(cam.current.z, e.key === '-' ? -1 : 1))
        return
      }
      if (!mod && !e.altKey && e.shiftKey && e.code === 'Digit1' && !isTyping(e)) {
        e.preventDefault()
        fitAll()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /** 屏幕坐标 → 画布坐标 */
  const toCanvas = (clientX: number, clientY: number) => {
    const r = surfaceRef.current!.getBoundingClientRect()
    const { x, y, z } = cam.current
    return { x: (clientX - r.left) / z + x, y: (clientY - r.top) / z + y }
  }

  const isEmptySpace = (target: EventTarget) =>
    target instanceof Element && !target.closest('[data-note], .no-drag')

  // 按住空白处拖动：平移画布（中键在哪里按都可以）
  const pan = useRef<{ id: number; x: number; y: number; cam: Camera; moved: boolean } | null>(null)
  // 触屏双指缩放：两根手指之间的距离决定比例，中点的移动同时平移
  const pinch = useRef<{ d0: number; mid0: { x: number; y: number }; cam: Camera } | null>(null)

  function endPan(el: HTMLElement, pointerId: number) {
    if (pan.current?.id !== pointerId) return
    pan.current = null
    grabRef.current!.hidden = true
    if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId)
  }

  // 双指缩放用 touch 事件：第二根手指落下时开始，之后两根手指的移动都归缩放，
  // 不再交给便利贴的拖动（第一根手指可能按在便利贴上）。在 window 的捕获阶段拦下，便利贴的拖动收不到
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    let blocked = false // 捏合过：直到所有手指离开，剩下的那根手指也不再拖动东西
    const two = (t: TouchList) => {
      const r = el.getBoundingClientRect()
      const a = { x: t[0].clientX - r.left, y: t[0].clientY - r.top }
      const b = { x: t[1].clientX - r.left, y: t[1].clientY - r.top }
      return { d: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
    }
    const onStart = (e: TouchEvent) => {
      if (e.touches.length < 2) return
      e.preventDefault()
      e.stopPropagation()
      stopAnimation()
      if (pan.current) endPan(el, pan.current.id)
      const { d, mid } = two(e.touches)
      pinch.current = { d0: Math.max(d, 1), mid0: mid, cam: { ...cam.current } }
      blocked = true
    }
    const onMove = (e: TouchEvent) => {
      if (!blocked) return
      e.stopPropagation()
      e.preventDefault()
      const p = pinch.current
      if (!p || e.touches.length < 2) return
      const { d, mid } = two(e.touches)
      // 捏合开始时中点下面的画布内容，跟着手指走到现在的中点
      const z = clampZoom(p.cam.z * (d / p.d0))
      const ax = p.cam.x + p.mid0.x / p.cam.z
      const ay = p.cam.y + p.mid0.y / p.cam.z
      moveCamera(ax - mid.x / z, ay - mid.y / z, z)
    }
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch.current = null
      if (e.touches.length === 0) blocked = false
    }
    el.addEventListener('touchstart', onStart, { capture: true, passive: false })
    window.addEventListener('touchmove', onMove, { capture: true, passive: false })
    window.addEventListener('touchend', onEnd, { capture: true })
    window.addEventListener('touchcancel', onEnd, { capture: true })
    return () => {
      el.removeEventListener('touchstart', onStart, { capture: true })
      window.removeEventListener('touchmove', onMove, { capture: true })
      window.removeEventListener('touchend', onEnd, { capture: true })
      window.removeEventListener('touchcancel', onEnd, { capture: true })
    }
  }, [])

  return (
    <div
      ref={surfaceRef}
      className="board-surface relative h-full w-full touch-none overflow-hidden"
      style={initialStyles.surface}
      data-board-canvas
      onPointerMove={(e) => {
        pointer.current = toCanvas(e.clientX, e.clientY)
        const p = pan.current
        if (!p || p.id !== e.pointerId || pinch.current) return
        const dx = e.clientX - p.x
        const dy = e.clientY - p.y
        if (!p.moved) {
          if (Math.hypot(dx, dy) < PAN_THRESHOLD) return
          p.moved = true
          e.currentTarget.setPointerCapture(e.pointerId)
          grabRef.current!.hidden = false
        }
        moveCamera(p.cam.x - dx / p.cam.z, p.cam.y - dy / p.cam.z)
      }}
      onPointerLeave={() => (pointer.current = null)}
      onPointerDown={(e) => {
        if (pinch.current) return
        const middle = e.button === 1
        if (!middle && (e.button !== 0 || !isEmptySpace(e.target))) return
        if (middle) e.preventDefault() // 不进入浏览器的自动滚动
        else {
          useNotes.getState().select(null)
          ;(document.activeElement as HTMLElement | null)?.blur?.()
        }
        stopAnimation()
        pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY, cam: { ...cam.current }, moved: false }
      }}
      onPointerUp={(e) => endPan(e.currentTarget, e.pointerId)}
      onPointerCancel={(e) => endPan(e.currentTarget, e.pointerId)}
      onDoubleClick={(e) => {
        if (!isEmptySpace(e.target)) return
        const p = toCanvas(e.clientX, e.clientY)
        const { create, setEditing } = useNotes.getState()
        const id = create({
          x: Math.round(p.x - currentNoteSize().w / 2),
          y: Math.round(p.y - 24),
        })
        setEditing(id)
      }}
    >
      {/* 画布图层：没有大小，便利贴按自己的坐标摆放；平移、缩放时整体变换 */}
      <div ref={canvasRef} className="absolute top-0 left-0 size-0 origin-top-left" style={initialStyles.canvas}>
        {/* 读完本地数据再挂载：首批便利贴不播放“贴上去”的入场动画 */}
        {hydrated && (
          <AnimatePresence initial={false}>
            {notes.map((n) => (
              <StickyNote key={n.id} note={n} morph={morph} />
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* 平移时盖住便利贴：显示抓手光标，经过的便利贴也不会出现悬停效果。
          不用给白板加属性再用后代选择器改光标：那样每次开始、结束平移都要重算所有便利贴的样式 */}
      <div ref={grabRef} hidden className="absolute inset-0 cursor-grabbing" data-panning />

      {/* 本地数据读出来之前不显示空状态，避免一闪而过 */}
      <AnimatePresence>{hydrated && notes.length === 0 && <EmptyState key={boardKey} boardId={boardId} />}</AnimatePresence>
    </div>
  )
}

function EmptyState({ boardId }: { boardId: string | null }) {
  const board = useNotes((s) => s.boards.find((b) => b.id === boardId))
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 grid place-items-center"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: { delay: 0.25, duration: 0.4 } }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
    >
      <div className="flex flex-col items-center gap-5 text-center">
        <svg width="132" height="104" viewBox="0 0 132 104" fill="none" aria-hidden>
          <rect x="18" y="14" width="64" height="64" rx="3" transform="rotate(-6 18 14)" fill="var(--note-sky)" />
          <rect x="52" y="22" width="64" height="64" rx="3" transform="rotate(4 52 22)" fill="var(--note-lemon)" />
          <path d="M64 44h30M64 54h22" stroke="var(--note-ink-muted)" strokeWidth="2.5" strokeLinecap="round" transform="rotate(4 52 22)" />
          <path d="M108 8l3 6M118 18l-6 2M114 10l-4 4" stroke="var(--ink-faint)" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <div>
          <p className="text-[15px] font-medium text-ink">
            {board ? `「${board.name}」还是空的，双击任意位置贴上第一张` : '双击任意位置，贴上第一张便利贴'}
          </p>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            或者按 <kbd>N</kbd> 新建，<kbd>Ctrl</kbd> <kbd>V</kbd> 粘贴文字
          </p>
        </div>
      </div>
    </motion.div>
  )
}
