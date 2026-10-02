import { useEffect, useMemo, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { readingOrder } from './layout'
import { notesOnBoard, useNotes } from './store'
import { ListNote } from './StickyNote'
import { nextNotePosition } from './viewport'
import { MORPH_LIMIT } from '../view'

/**
 * 列表视图（docs/frontend-design.md §2.8）：当前看板的便利贴按阅读顺序（先上后下、先左后右）排成一列，
 * 内容不裁切。编辑、改色、移动、删除和白板上一样；位置还是白板上的位置，切回白板时原样回去。
 */
export function NoteList({ boardId }: { boardId: string | null }) {
  const allNotes = useNotes((s) => s.notes)
  const boards = useNotes((s) => s.boards)
  const hydrated = useNotes((s) => s.hydrated)
  const notes = useMemo(() => readingOrder(notesOnBoard({ notes: allNotes, boards }, boardId)), [allNotes, boards, boardId])
  const scrollRef = useRef<HTMLDivElement>(null)
  const small = notes.length <= MORPH_LIMIT

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
    useNotes.getState().select(null)
  }, [boardId])

  const createNote = () => {
    const { create, setEditing } = useNotes.getState()
    setEditing(create(nextNotePosition({ preferCenter: true })))
  }

  return (
    <div
      ref={scrollRef}
      className="board-surface h-full overflow-y-auto"
      onPointerDown={(e) => {
        if (e.target instanceof Element && e.target.closest('[data-note], .no-drag, button')) return
        useNotes.getState().select(null)
      }}
    >
      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-5 px-5 pt-20 pb-28 sm:px-8" data-testid="note-list">
        {hydrated && (
          <AnimatePresence initial={false} mode="popLayout">
            {notes.map((n) => (
              <ListNote key={n.id} note={n} morph={small} animateLayout={small} />
            ))}
          </AnimatePresence>
        )}
        {hydrated && notes.length === 0 && (
          <motion.div
            className="mt-16 flex flex-col items-center gap-3 text-center"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: { delay: 0.1 } }}
          >
            <p className="text-[15px] font-medium text-ink">这里还没有便利贴</p>
            <p className="text-[13px] text-ink-muted">
              按 <kbd>N</kbd> 新建，或者切回白板双击空白处
            </p>
          </motion.div>
        )}
        {hydrated && (
          <button
            type="button"
            onClick={createNote}
            className="self-start rounded-lg px-3 py-2 text-[13.5px] text-ink-muted transition-colors hover:bg-chrome-hover hover:text-ink"
          >
            + 新建便利贴
          </button>
        )}
      </div>
    </div>
  )
}
