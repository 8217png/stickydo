import { memo, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Rnd } from 'react-rnd'
import { NOTE_COLORS, noteColorVar } from '../../design/colors'
import { useSettings } from '../settings'
import { NOTE_SIZES, type Note, presetOf, useNotes } from './store'
import { deleteWithUndo, resizeToPreset } from './actions'

const SPRING = { type: 'spring', stiffness: 520, damping: 32, mass: 0.8 } as const

interface Props {
  note: Note
  selected: boolean
  editing: boolean
}

export const StickyNote = memo(function StickyNote({ note, selected, editing }: Props) {
  const tiltOn = useSettings((s) => s.tilt)
  const { update, bringToFront, select, setEditing, checkpoint, discard } = useNotes.getState()
  const [lifted, setLifted] = useState(false)
  const [hovered, setHovered] = useState(false)
  const draggedRef = useRef(false)
  const resizingRef = useRef(false)

  // 尺寸不是用户拖出来的（预设按钮、快捷键、撤销）时，用过渡动画平滑变化
  const [sizeAnim, setSizeAnim] = useState(false)
  const prevSize = useRef({ w: note.w, h: note.h })
  useEffect(() => {
    const prev = prevSize.current
    prevSize.current = { w: note.w, h: note.h }
    if (resizingRef.current || (prev.w === note.w && prev.h === note.h)) return
    setSizeAnim(true)
    const t = setTimeout(() => setSizeAnim(false), 260)
    return () => clearTimeout(t)
  }, [note.w, note.h])

  const rotate = lifted || !tiltOn ? 0 : note.tilt

  return (
    <Rnd
      className="note-shell"
      data-note={note.id}
      data-selected={selected}
      position={{ x: note.x, y: note.y }}
      size={{ width: note.w, height: note.h }}
      style={{
        zIndex: note.z,
        transition: sizeAnim ? 'width 240ms var(--ease-out), height 240ms var(--ease-out)' : undefined,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      minWidth={140}
      minHeight={100}
      disableDragging={editing}
      cancel=".no-drag"
      enableResizing={{ right: true, bottom: true, bottomRight: true }}
      resizeHandleComponent={{ bottomRight: <ResizeGrip /> }}
      onDragStart={() => {
        draggedRef.current = false
        bringToFront(note.id)
        select(note.id)
      }}
      onDrag={() => {
        if (!draggedRef.current) {
          draggedRef.current = true
          setLifted(true)
        }
      }}
      onDragStop={(_e, d) => {
        setLifted(false)
        if (draggedRef.current && (d.x !== note.x || d.y !== note.y)) {
          update(note.id, { x: Math.round(d.x), y: Math.round(d.y) })
        }
      }}
      onResizeStart={() => {
        resizingRef.current = true
        bringToFront(note.id)
        select(note.id)
        setLifted(true)
      }}
      onResizeStop={(_e, _dir, el, _delta, pos) => {
        setLifted(false)
        // 等这次尺寸写入 store、effect 跑完之后再清标记，避免触发过渡动画
        requestAnimationFrame(() => (resizingRef.current = false))
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
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (!editing) setEditing(note.id)
        }}
      >
        {editing ? (
          <NoteEditor
            note={note}
            onDone={(content, snapshot) => {
              setEditing(null)
              if (!content.trim()) {
                // 新建后没写内容：直接丢弃，不打扰用户；原本有内容被清空：按删除处理，可撤销
                if (note.content.trim()) deleteWithUndo(note.id, snapshot)
                else discard(note.id)
                return
              }
              if (content !== note.content) {
                checkpoint(snapshot)
                update(note.id, { content }, { record: false })
              }
            }}
          />
        ) : (
          <NoteContent content={note.content} />
        )}
      </motion.div>
    </Rnd>
  )
})

function NoteContent({ content }: { content: string }) {
  const [first, ...rest] = content.split('\n')
  return (
    <div className="note-text h-full overflow-hidden px-4 pt-4 pb-3 select-none">
      <div className="font-semibold">{first}</div>
      {rest.length > 0 && <div className="mt-1 text-note-ink/85">{rest.join('\n')}</div>}
    </div>
  )
}

function NoteEditor({
  note,
  onDone,
}: {
  note: Note
  onDone: (content: string, snapshot: Note[]) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  // 进入编辑时的快照：编辑结束、内容确实变了才作为一步撤销记录
  const snapshot = useRef(useNotes.getState().notes)
  const [value, setValue] = useState(note.content)
  const done = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const finish = () => {
    if (done.current) return
    done.current = true
    onDone(value, snapshot.current)
  }

  return (
    <textarea
      ref={ref}
      className="no-drag note-text block h-full w-full resize-none bg-transparent px-4 pt-4 pb-3 outline-none placeholder:text-note-ink-muted"
      value={value}
      placeholder="写点什么…"
      onChange={(e) => setValue(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault()
          ref.current?.blur()
        }
      }}
    />
  )
}

function NoteToolbar({ note, visible }: { note: Note; visible: boolean }) {
  const update = useNotes((s) => s.update)
  return (
    <div
      className="no-drag absolute -top-11 left-0 flex items-center gap-1 rounded-ui border border-chrome-border bg-chrome p-1 shadow-chrome backdrop-blur-md transition-all duration-150"
      style={{
        opacity: visible ? 1 : 0,
        transform: `translateY(${visible ? 0 : 4}px)`,
        pointerEvents: visible ? 'auto' : 'none',
      }}
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
      <SizePicker note={note} />
      <span className="mx-1 h-4 w-px bg-chrome-border" />
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
    </div>
  )
}

function SizePicker({ note }: { note: Note }) {
  const current = presetOf(note)
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="大小">
      {NOTE_SIZES.map((p) => {
        const active = current?.key === p.key
        return (
          <button
            key={p.key}
            type="button"
            title={`${p.label}（${p.w}×${p.h}）· 快捷键 - / =`}
            aria-label={`大小：${p.label}`}
            aria-pressed={active}
            className={`grid h-6 min-w-6 place-items-center rounded-md px-1 text-[12px] transition-colors ${
              active ? 'bg-chrome-hover font-semibold text-ink' : 'text-ink-muted hover:bg-chrome-hover hover:text-ink'
            }`}
            onClick={() => resizeToPreset(note.id, p)}
          >
            {p.label}
          </button>
        )
      })}
    </div>
  )
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
