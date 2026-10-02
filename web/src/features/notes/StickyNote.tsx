import { memo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Rnd } from 'react-rnd'
import { EditorContent, useEditor } from '@tiptap/react'
import { NOTE_COLORS, noteColorVar } from '../../design/colors'
import { useSettings } from '../settings'
import { type Note, noteTilt, useNotes } from './store'
import { deleteWithUndo } from './actions'
import { docIsEmpty, type NoteDoc, trimDoc } from './doc'
import { noteExtensions } from './extensions'
import { NoteRenderer, toggleTaskAt } from './NoteRenderer'

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
  // 用户正按着拖动/缩放时关闭过渡，跟手；其余的位置和尺寸变化（自动排列、撤销）都平滑过渡
  const [interacting, setInteracting] = useState(false)

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
      cancel=".no-drag"
      enableResizing={{ right: true, bottom: true, bottomRight: true }}
      resizeHandleComponent={{ bottomRight: <ResizeGrip /> }}
      onDragStart={() => {
        draggedRef.current = false
        setInteracting(true)
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
        setInteracting(false)
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
              if (docIsEmpty(content)) {
                // 新建后没写内容：直接丢弃，不打扰用户；原本有内容被清空：按删除处理，可撤销
                if (!docIsEmpty(note.content)) deleteWithUndo(note.id, snapshot)
                else discard(note.id)
                return
              }
              if (JSON.stringify(content) !== JSON.stringify(trimDoc(note.content))) {
                checkpoint(snapshot)
                update(note.id, { content }, { record: false })
              }
            }}
          />
        ) : (
          <NoteContent note={note} />
        )}
      </motion.div>
    </Rnd>
  )
})

function NoteContent({ note }: { note: Note }) {
  return (
    <div className="note-text note-text-clip h-full overflow-hidden px-4 pt-4 pb-3 select-none">
      <NoteRenderer
        doc={note.content}
        onToggleTask={(path) => useNotes.getState().update(note.id, { content: toggleTaskAt(note.content, path) })}
      />
    </div>
  )
}

/**
 * 原地编辑：Tiptap 所见即所得编辑器。Markdown 写法会即时变成格式（# 标题、- 列表、[] 待办、**粗体** 等）。
 * Esc 或 Ctrl/⌘+Enter 结束编辑；点到别处也会结束。
 */
function NoteEditor({ note, onDone }: { note: Note; onDone: (content: NoteDoc, snapshot: Note[]) => void }) {
  // 进入编辑时的快照：编辑结束、内容确实变了才作为一步撤销记录
  const snapshot = useRef(useNotes.getState().notes)
  const done = useRef(false)
  const finish = (doc: NoteDoc) => {
    if (done.current) return
    done.current = true
    onDone(doc, snapshot.current)
  }

  const editor = useEditor({
    extensions: noteExtensions({ placeholder: '写点什么…' }),
    content: note.content,
    autofocus: 'end',
    editorProps: {
      attributes: { class: 'note-md note-editor outline-none', spellcheck: 'false' },
      handleKeyDown: (view, e) => {
        if (e.isComposing) return false
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault()
          ;(view.dom as HTMLElement).blur()
          return true
        }
        return false
      },
    },
    onBlur: ({ editor }) => finish(trimDoc(editor.getJSON() as NoteDoc)),
  })

  return (
    <EditorContent
      editor={editor}
      className="no-drag note-text h-full cursor-text overflow-y-auto px-4 pt-4 pb-3"
      onPointerDown={(e) => e.stopPropagation()}
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

function ResizeGrip() {
  return (
    <div className="note-resize-grip absolute right-1 bottom-1 text-note-ink-muted">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
        <path d="M9 3L3 9M9 6.5L6.5 9" />
      </svg>
    </div>
  )
}
