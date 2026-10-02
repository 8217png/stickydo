import { useEffect, useMemo, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { currentNoteSize, notesOnBoard, useNotes } from './store'
import { StickyNote } from './StickyNote'
import { setBoardViewport } from './viewport'
import { GRID } from './layout'
import { MORPH_LIMIT } from '../view'
import { load, save } from '../../lib/storage'

/** 拖动超过这个距离才算平移画布，否则仍是单击（取消选中）和双击（新建） */
const PAN_THRESHOLD = 3

type Camera = { x: number; y: number }

/** 每块白板看到的位置（可见区域左上角对应的画布坐标），记在本机，刷新后回到原处 */
const CAMERA_KEY = 'stickydo.camera'
const cameras = new Map<string, Camera>(Object.entries(load<Record<string, Camera>>(CAMERA_KEY) ?? {}))
let saveTimer: ReturnType<typeof setTimeout> | undefined
function rememberCamera(key: string, cam: Camera) {
  cameras.set(key, cam)
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => save(CAMERA_KEY, Object.fromEntries(cameras)), 300)
}

/**
 * 一块白板：收件箱（boardId 为 null）或某个看板。
 * 画布没有边界：便利贴可以放在任何位置（包括负坐标），在空白处按住拖动、或用滚轮 / 触控板平移整块画布。
 * 平移只改画布图层的 transform（不触发 React 渲染），便利贴再多也跟手。
 */
export function Whiteboard({ boardId }: { boardId: string | null }) {
  const allNotes = useNotes((s) => s.notes)
  const boards = useNotes((s) => s.boards)
  const notes = useMemo(() => notesOnBoard({ notes: allNotes, boards }, boardId), [allNotes, boards, boardId])
  const hydrated = useNotes((s) => s.hydrated)
  const morph = notes.length <= MORPH_LIMIT
  const surfaceRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const grabRef = useRef<HTMLDivElement>(null)
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const cam = useRef<Camera>({ x: 0, y: 0 })
  const anim = useRef(0)
  const boardKey = boardId ?? 'inbox'
  const keyRef = useRef(boardKey)
  keyRef.current = boardKey

  /** 移动镜头：直接改 transform 和点阵底纹的位置，取整避免文字发虚 */
  const moveCamera = (x: number, y: number, remember = true) => {
    const c = { x: Math.round(x), y: Math.round(y) }
    cam.current = c
    if (canvasRef.current) canvasRef.current.style.transform = `translate(${-c.x}px, ${-c.y}px)`
    if (surfaceRef.current) surfaceRef.current.style.backgroundPosition = `${-c.x}px ${-c.y}px`
    if (remember) rememberCamera(keyRef.current, c)
  }

  const stopAnimation = () => cancelAnimationFrame(anim.current)

  /** 平滑移到某处（自动排列后回到原点、跳到某张便利贴） */
  const glideTo = (x: number, y: number) => {
    stopAnimation()
    const from = { ...cam.current }
    const t0 = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 380)
      const e = 1 - Math.pow(1 - t, 3)
      moveCamera(from.x + (x - from.x) * e, from.y + (y - from.y) * e, t === 1)
      if (t < 1) anim.current = requestAnimationFrame(step)
    }
    anim.current = requestAnimationFrame(step)
  }

  useEffect(() => {
    // 让键盘快捷键（N、粘贴）知道当前可见区域，新建的便利贴落在视野里
    setBoardViewport(() => {
      const el = surfaceRef.current
      if (!el) return null
      return {
        left: cam.current.x,
        top: cam.current.y,
        width: el.clientWidth,
        height: el.clientHeight,
        pointer: pointer.current,
        scrollTo: glideTo,
      }
    })
    return () => {
      setBoardViewport(null)
      stopAnimation()
    }
  }, [])

  // 换到另一块白板：回到这块白板上次看的位置；第一次打开时，便利贴都不在视野里就移到它们那里。取消选中
  useEffect(() => {
    stopAnimation()
    const saved = cameras.get(boardKey)
    moveCamera(saved?.x ?? 0, saved?.y ?? 0, false)
    useNotes.getState().select(null)
  }, [boardKey])

  useEffect(() => {
    if (!hydrated || cameras.has(boardKey) || notes.length === 0) return
    const el = surfaceRef.current
    if (!el) return
    const { x, y } = cam.current
    const inView = notes.some((n) => n.x + n.w > x && n.x < x + el.clientWidth && n.y + n.h > y && n.y < y + el.clientHeight)
    if (!inView) {
      moveCamera(Math.min(...notes.map((n) => n.x)) - GRID.side, Math.min(...notes.map((n) => n.y)) - GRID.top, false)
    }
    // 只在打开白板、读完本地数据时看一次
  }, [hydrated, boardKey])

  // 滚轮 / 触控板平移（Ctrl + 滚轮留给浏览器缩放）；要能 preventDefault，所以不用 React 的 onWheel
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return
      // 正在编辑的便利贴、菜单里自己滚动
      if (e.target instanceof Element && e.target.closest('[data-editing="true"], [role="menu"]')) return
      e.preventDefault()
      stopAnimation()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1
      let dx = e.deltaX * unit
      let dy = e.deltaY * unit
      // 鼠标滚轮按住 Shift 横向移动
      if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0]
      moveCamera(cam.current.x + dx, cam.current.y + dy)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /** 屏幕坐标 → 画布坐标 */
  const toCanvas = (clientX: number, clientY: number) => {
    const r = surfaceRef.current!.getBoundingClientRect()
    return { x: clientX - r.left + cam.current.x, y: clientY - r.top + cam.current.y }
  }

  const isEmptySpace = (target: EventTarget) =>
    target instanceof Element && !target.closest('[data-note], .no-drag')

  // 按住空白处拖动：平移画布（中键在哪里按都可以）
  const pan = useRef<{ id: number; x: number; y: number; cam: Camera; moved: boolean } | null>(null)

  return (
    <div
      ref={surfaceRef}
      className="board-surface relative h-full w-full touch-none overflow-hidden"
      data-board-canvas
      onPointerMove={(e) => {
        pointer.current = toCanvas(e.clientX, e.clientY)
        const p = pan.current
        if (!p || p.id !== e.pointerId) return
        const dx = e.clientX - p.x
        const dy = e.clientY - p.y
        if (!p.moved) {
          if (Math.hypot(dx, dy) < PAN_THRESHOLD) return
          p.moved = true
          e.currentTarget.setPointerCapture(e.pointerId)
          grabRef.current!.hidden = false
        }
        moveCamera(p.cam.x - dx, p.cam.y - dy)
      }}
      onPointerLeave={() => (pointer.current = null)}
      onPointerDown={(e) => {
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
      {/* 画布图层：没有大小，便利贴按自己的坐标摆放；平移时整体移动 */}
      <div ref={canvasRef} className="absolute top-0 left-0 size-0 will-change-transform">
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

  function endPan(el: HTMLElement, pointerId: number) {
    if (pan.current?.id !== pointerId) return
    pan.current = null
    grabRef.current!.hidden = true
    if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId)
  }
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
