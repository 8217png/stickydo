import { Component, lazy, memo, type ReactNode, Suspense, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AnimatePresence, motion } from 'motion/react'
import { Rnd } from 'react-rnd'
import { NOTE_COLORS, noteColorVar } from '../../design/colors'
import { useSettings } from '../settings'
import { type Note, noteTilt, type Snapshot, sortedBoards, useNotes } from './store'
import { deleteWithUndo } from './actions'
import { boardOfNote, moveNoteWithUndo } from '../boards/actions'
import { cleanDoc, docIsEmpty, type NoteDoc, trimDoc } from './doc'
import { NoteRenderer, toggleTaskAt } from './NoteRenderer'
import { useLongPress } from './useLongPress'

/** 编辑器（Tiptap）单独打包，第一次编辑前加载；加载完之前显示原来的内容，看不出切换 */
export const loadNoteEditor = () => import('./NoteEditor')
const NoteEditorLazy = lazy(loadNoteEditor)

/**
 * 编辑器（第一次编辑时才加载）。加载出来、并且真正拿到焦点之前，盖一层原来的内容和一个看不见的
 * 输入框先接住打的字；编辑器拿到焦点时取走这些字接着写进去，再撤掉这一层。
 * 焦点交接中间没有空档，双击后马上打字不会丢字。
 */
function NoteEditor(props: { note: Note; onDone: (content: NoteDoc, snapshot: Snapshot) => void; fit?: boolean }) {
  const [ready, setReady] = useState(false)
  const typed = useRef<HTMLTextAreaElement>(null)
  const takeOver = () => {
    const text = typed.current?.value ?? ''
    setReady(true)
    return text
  }
  return (
    <div className={`relative ${props.fit ? '' : 'h-full'}`} style={{ backgroundColor: 'inherit', borderRadius: 'inherit' }}>
      <EditorBoundary note={props.note}>
        <Suspense fallback={null}>
          <NoteEditorLazy {...props} takeOver={takeOver} />
        </Suspense>
      </EditorBoundary>
      {!ready && (
        <div className="absolute inset-0 z-[1] overflow-hidden" style={{ backgroundColor: 'inherit', borderRadius: 'inherit' }}>
          <NoteContent note={props.note} fit={props.fit} />
          <textarea
            ref={typed}
            autoFocus
            aria-label="正在打开编辑器"
            className="no-drag absolute inset-0 resize-none opacity-0"
            onPointerDown={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}

/** 编辑器出错（或加载失败，例如离线时第一次编辑）：退出编辑、保留原内容，不影响整个页面 */
class EditorBoundary extends Component<{ note: Note; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    console.error('[editor] 编辑器出错', err)
    toast.error('编辑器没能打开，请稍后再试')
    if (useNotes.getState().editingId === this.props.note.id) useNotes.getState().setEditing(null)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

const SPRING = { type: 'spring', stiffness: 520, damping: 32, mass: 0.8 } as const

interface Props {
  note: Note
  /** 白板 / 列表切换时的共享元素过渡（layoutId）；便利贴多时关掉，见 MORPH_LIMIT */
  morph?: boolean
  /** 列表视图：增删时其他便利贴平滑让位（便利贴多时关掉，见 MORPH_LIMIT） */
  animateLayout?: boolean
}

/**
 * 选中、编辑状态由每张便利贴自己订阅：换选中时只有这两张重新渲染，白板不用整体重渲染
 * （整体重渲染会让 AnimatePresence 给所有便利贴传一遍上下文，便利贴一多就卡）
 */
const useNoteState = (id: string) => ({
  selected: useNotes((s) => s.selectedId === id),
  editing: useNotes((s) => s.editingId === id),
})

export const StickyNote = memo(function StickyNote({ note, morph }: Props) {
  const { selected, editing } = useNoteState(note.id)
  const tiltOn = useSettings((s) => s.tilt)
  const { update, bringToFront, select, setEditing } = useNotes.getState()
  const [lifted, setLifted] = useState(false)
  const [hovered, setHovered] = useState(false)
  const draggedRef = useRef(false)
  // 用户正按着拖动/缩放时关闭过渡，跟手；其余的位置和尺寸变化（自动排列、撤销）都平滑过渡
  const [interacting, setInteracting] = useState(false)

  // 长按（不移动）2 秒进入编辑，等同于双击
  const longPress = useLongPress(() => setEditing(note.id), !editing)

  const rotate = lifted || !tiltOn ? 0 : noteTilt(note.id)

  return (
    <Rnd
      className="note-shell"
      data-note={note.id}
      data-selected={selected}
      position={{ x: note.x, y: note.y }}
      size={{ width: note.w, height: note.h }}
      style={{
        zIndex: note.z,
        transition: interacting
          ? undefined
          : 'transform 420ms var(--ease-out), width 420ms var(--ease-out), height 420ms var(--ease-out)',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      minWidth={140}
      minHeight={100}
      disableDragging={editing}
      // 不在拖动时给 body 加类名来禁止选中文字：便利贴自己已经禁止选中，
      // 而改 body 的类名会让整页重新计算样式，便利贴一多每次点击都会卡一下
      enableUserSelectHack={false}
      cancel=".no-drag"
      enableResizing={{ right: true, bottom: true, bottomRight: true }}
      resizeHandleComponent={{ bottomRight: <ResizeGrip /> }}
      onDragStart={() => {
        draggedRef.current = false
        setInteracting(true)
        bringToFront(note.id)
        select(note.id)
      }}
      onDrag={(e) => {
        if (!draggedRef.current) {
          draggedRef.current = true
          setLifted(true)
        }
        highlightDropTarget(dropTargetAt(e))
      }}
      onDragStop={(e, d) => {
        setLifted(false)
        setInteracting(false)
        const target = dropTargetAt(e)
        highlightDropTarget(null)
        const boardId = target ? target.dataset.dropBoard || null : undefined
        if (draggedRef.current && boardId !== undefined && boardId !== boardOfNote(note.id)) {
          // 拖到侧边栏的另一个看板上：移过去，位置不变
          moveNoteWithUndo(note.id, boardId)
          return
        }
        if (draggedRef.current && (d.x !== note.x || d.y !== note.y)) {
          update(note.id, { x: Math.round(d.x), y: Math.round(d.y) })
        }
      }}
      onResizeStart={() => {
        setInteracting(true)
        bringToFront(note.id)
        select(note.id)
        setLifted(true)
      }}
      onResizeStop={(_e, _dir, el, _delta, pos) => {
        setLifted(false)
        setInteracting(false)
        update(note.id, {
          w: el.offsetWidth,
          h: el.offsetHeight,
          x: Math.round(pos.x),
          y: Math.round(pos.y),
        })
      }}
    >
      {/* 悬停/选中时出现的快捷操作栏，不随纸面倾斜 */}
      <NoteToolbar note={note} visible={(selected || hovered) && !lifted} />

      <motion.div
        layoutId={morph ? `paper-${note.id}` : undefined}
        className="note-paper h-full w-full"
        data-lifted={lifted}
        style={{
          backgroundColor: noteColorVar(note.color),
          outline: selected ? '2px solid var(--focus-ring)' : '2px solid transparent',
          outlineOffset: 3,
        }}
        initial={{ scale: 0.6, opacity: 0, rotate: rotate - 8, y: -12 }}
        animate={{ scale: lifted ? 1.035 : 1, opacity: 1, rotate, y: 0 }}
        exit={{ scale: 0.85, opacity: 0, transition: { duration: 0.18, ease: 'easeIn' } }}
        transition={SPRING}
        onPointerDown={longPress.onPointerDown}
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (!editing) setEditing(note.id)
        }}
      >
        {editing ? <NoteEditor note={note} onDone={(content, snapshot) => finishEditing(note, content, snapshot)} /> : <NoteContent note={note} />}
      </motion.div>
    </Rnd>
  )
})

/**
 * 列表视图里的一张便利贴（docs/frontend-design.md §2.8）：占满一行，高度随内容，不裁切。
 * 和白板上的同一张共用 layoutId，切换视图时从原来的位置平滑移过去。
 */
export const ListNote = memo(function ListNote({ note, morph, animateLayout }: Props) {
  const { selected, editing } = useNoteState(note.id)
  const [hovered, setHovered] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const longPress = useLongPress(() => useNotes.getState().setEditing(note.id), !editing)
  useEffect(() => {
    if (editing) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [editing])
  return (
    <motion.div
      ref={ref}
      layout={animateLayout ? 'position' : false}
      className="relative"
      // 选中或悬停时盖住下一张，操作栏的菜单不会被挡住
      style={{ zIndex: selected || hovered || editing ? 2 : undefined }}
      data-note={note.id}
      data-selected={selected}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onPointerDown={() => useNotes.getState().select(note.id)}
    >
      <NoteToolbar note={note} visible={selected || hovered} />
      <motion.div
        layoutId={morph ? `paper-${note.id}` : undefined}
        className="note-paper w-full"
        style={{
          backgroundColor: noteColorVar(note.color),
          outline: selected ? '2px solid var(--focus-ring)' : '2px solid transparent',
          outlineOffset: 3,
        }}
        transition={SPRING}
        onPointerDown={longPress.onPointerDown}
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (!editing) useNotes.getState().setEditing(note.id)
        }}
      >
        {editing ? (
          <NoteEditor note={note} onDone={(content, snapshot) => finishEditing(note, content, snapshot)} fit />
        ) : (
          <NoteContent note={note} fit />
        )}
      </motion.div>
    </motion.div>
  )
})

/** 结束编辑：内容没变不算编辑；清空了按删除处理（可撤销）；新建后没写内容直接丢弃 */
function finishEditing(note: Note, content: NoteDoc, snapshot: Snapshot) {
  const { setEditing, discard, checkpoint, update } = useNotes.getState()
  setEditing(null)
  if (docIsEmpty(content)) {
    if (!docIsEmpty(note.content)) deleteWithUndo(note.id, snapshot)
    else discard(note.id)
    return
  }
  if (JSON.stringify(content) !== JSON.stringify(cleanDoc(trimDoc(note.content)))) {
    checkpoint(snapshot)
    update(note.id, { content }, { record: false })
  }
}

/** fit：高度随内容（列表视图），否则按便利贴大小裁切 */
function NoteContent({ note, fit }: { note: Note; fit?: boolean }) {
  return (
    <div className={`note-text px-4 pt-4 pb-3 select-none ${fit ? 'min-h-[72px]' : 'note-text-clip h-full overflow-hidden'}`}>
      <NoteRenderer
        doc={note.content}
        onToggleTask={(path) => useNotes.getState().update(note.id, { content: toggleTaskAt(note.content, path) })}
      />
    </div>
  )
}

/** 操作栏只在显示时挂载：每张便利贴都常驻一个毛玻璃操作栏，便利贴一多绘制很慢 */
function NoteToolbar({ note, visible }: { note: Note; visible: boolean }) {
  return <AnimatePresence>{visible && <NoteToolbarInner key="toolbar" note={note} />}</AnimatePresence>
}

function NoteToolbarInner({ note }: { note: Note }) {
  const update = useNotes((s) => s.update)
  return (
    <motion.div
      className="no-drag absolute -top-11 left-0 flex items-center gap-1 rounded-ui border border-chrome-border bg-chrome p-1 shadow-chrome backdrop-blur-md"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.15 }}
      onPointerDown={(e) => {
        // 不触发拖拽，但点操作栏也算选中这张便利贴，后续快捷键作用于它
        e.stopPropagation()
        useNotes.getState().select(note.id)
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {NOTE_COLORS.map((c, i) => (
        <button
          key={c.key}
          type="button"
          title={`${c.name}（${i + 1}）`}
          aria-label={c.name}
          className="grid size-6 place-items-center rounded-full transition-transform hover:scale-110"
          onClick={() => note.color !== c.key && update(note.id, { color: c.key })}
        >
          <span
            className="size-4 rounded-full border border-black/10"
            style={{
              backgroundColor: noteColorVar(c.key),
              boxShadow: note.color === c.key ? '0 0 0 2px var(--chrome-bg), 0 0 0 3.5px var(--ink-muted)' : undefined,
            }}
          />
        </button>
      ))}
      <span className="mx-1 h-4 w-px bg-chrome-border" />
      <MoveMenu note={note} />
      <button
        type="button"
        title="删除（Delete）"
        aria-label="删除"
        className="grid size-6 place-items-center rounded-md text-ink-muted transition-colors hover:bg-chrome-hover hover:text-ink"
        onClick={() => deleteWithUndo(note.id)}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
        </svg>
      </button>
    </motion.div>
  )
}

/** 操作栏上的“移到看板”：列出收件箱和所有看板 */
function MoveMenu({ note }: { note: Note }) {
  const [open, setOpen] = useState(false)
  const boards = useNotes((s) => s.boards)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', away)
    return () => window.removeEventListener('pointerdown', away)
  }, [open])
  const current = boardOfNote(note.id)
  const targets = [null, ...sortedBoards(boards).map((b) => b.id)].filter((id) => id !== current)
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="移到看板（也可以拖到侧边栏的看板上）"
        aria-label="移到看板"
        aria-expanded={open}
        className="grid size-6 place-items-center rounded-md text-ink-muted transition-colors hover:bg-chrome-hover hover:text-ink aria-expanded:bg-chrome-hover"
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 8h9M9 5l3 3-3 3" />
          <path d="M13.5 3v10" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute top-8 left-0 z-10 max-h-64 w-44 overflow-y-auto rounded-ui border border-chrome-border bg-surface p-1 shadow-chrome">
          <p className="px-2.5 pt-1 pb-1.5 text-[11.5px] text-ink-faint">移到…</p>
          {targets.length === 1 && boards.length === 0 && (
            <p className="px-2.5 pb-1.5 text-[12px] leading-snug text-ink-faint">在侧边栏新建看板后，可以把便利贴分开放</p>
          )}
          {targets.map((id) => {
            const b = id ? boards.find((x) => x.id === id) : undefined
            return (
              <button
                key={id ?? 'inbox'}
                type="button"
                role="menuitem"
                className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-ink transition-colors hover:bg-chrome-hover"
                onClick={() => {
                  setOpen(false)
                  moveNoteWithUndo(note.id, id)
                }}
              >
                <span
                  className="size-2.5 shrink-0 rounded-full border border-black/10"
                  style={{ background: b ? noteColorVar(b.color) : 'transparent' }}
                />
                <span className="truncate">{b?.name ?? '收件箱'}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** 拖动时指针下方的侧边栏看板（data-drop-board） */
function dropTargetAt(e: MouseEvent | TouchEvent): HTMLElement | null {
  const p = 'touches' in e ? (e.touches[0] ?? e.changedTouches[0]) : e
  if (!p) return null
  for (const el of document.elementsFromPoint(p.clientX, p.clientY)) {
    const t = (el as HTMLElement).closest?.('[data-drop-board]')
    if (t) return t as HTMLElement
  }
  return null
}

let dropHighlighted: HTMLElement | null = null
function highlightDropTarget(el: HTMLElement | null) {
  if (el === dropHighlighted) return
  dropHighlighted?.removeAttribute('data-drop-active')
  el?.setAttribute('data-drop-active', 'true')
  dropHighlighted = el
}

function ResizeGrip() {
  return (
    <div className="note-resize-grip absolute right-1 bottom-1 text-note-ink-muted">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
        <path d="M9 3L3 9M9 6.5L6.5 9" />
      </svg>
    </div>
  )
}
