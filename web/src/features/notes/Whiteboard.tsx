import { useEffect, useMemo, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { currentNoteSize, notesOnBoard, useNotes } from './store'
import { StickyNote } from './StickyNote'
import { setBoardViewport } from './viewport'
import { MORPH_LIMIT } from '../view'

const CANVAS_MARGIN = 480

/** 一块白板：收件箱（boardId 为 null）或某个看板 */
export function Whiteboard({ boardId }: { boardId: string | null }) {
  const allNotes = useNotes((s) => s.notes)
  const boards = useNotes((s) => s.boards)
  const notes = useMemo(() => notesOnBoard({ notes: allNotes, boards }, boardId), [allNotes, boards, boardId])
  const hydrated = useNotes((s) => s.hydrated)
  const morph = notes.length <= MORPH_LIMIT
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const pointer = useRef<{ x: number; y: number } | null>(null)

  // 画布大小随便利贴范围延伸，可以滚动到更远处
  const extent = useMemo(
    () => ({
      w: Math.max(...notes.map((n) => n.x + n.w), 0) + CANVAS_MARGIN,
      h: Math.max(...notes.map((n) => n.y + n.h), 0) + CANVAS_MARGIN,
    }),
    [notes],
  )

  useEffect(() => {
    // 让键盘快捷键（N、粘贴）知道当前可见区域，新建的便利贴落在视野里
    setBoardViewport(() => {
      const el = scrollRef.current
      if (!el) return null
      return {
        left: el.scrollLeft,
        top: el.scrollTop,
        width: el.clientWidth,
        height: el.clientHeight,
        pointer: pointer.current,
        scrollTo: (left: number, top: number) => el.scrollTo({ left, top, behavior: 'smooth' }),
      }
    })
    return () => setBoardViewport(null)
  }, [])

  // 换到另一块白板：回到左上角，取消选中
  useEffect(() => {
    scrollRef.current?.scrollTo({ left: 0, top: 0 })
    useNotes.getState().select(null)
  }, [boardId])

  const toCanvas = (clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: clientX - r.left, y: clientY - r.top }
  }

  const isEmptySpace = (target: EventTarget) =>
    target instanceof Element && !target.closest('[data-note], .no-drag')

  return (
    <div ref={scrollRef} className="board-surface relative h-full w-full overflow-auto">
      <div
        ref={canvasRef}
        className="relative"
        style={{ minWidth: '100%', minHeight: '100%', width: extent.w, height: extent.h }}
        onPointerMove={(e) => (pointer.current = toCanvas(e.clientX, e.clientY))}
        onPointerLeave={() => (pointer.current = null)}
        onPointerDown={(e) => {
          if (!isEmptySpace(e.target)) return
          useNotes.getState().select(null)
          ;(document.activeElement as HTMLElement | null)?.blur?.()
        }}
        onDoubleClick={(e) => {
          if (!isEmptySpace(e.target)) return
          const p = toCanvas(e.clientX, e.clientY)
          const { create, setEditing } = useNotes.getState()
          const id = create({
            x: Math.max(8, Math.round(p.x - currentNoteSize().w / 2)),
            y: Math.max(8, Math.round(p.y - 24)),
          })
          setEditing(id)
        }}
      >
        {/* 读完本地数据再挂载：首批便利贴不播放“贴上去”的入场动画 */}
        {hydrated && (
          <AnimatePresence initial={false}>
            {notes.map((n) => (
              <StickyNote key={n.id} note={n} morph={morph} />
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* 本地数据读出来之前不显示空状态，避免一闪而过 */}
      <AnimatePresence>{hydrated && notes.length === 0 && <EmptyState key={boardId ?? 'inbox'} boardId={boardId} />}</AnimatePresence>
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
