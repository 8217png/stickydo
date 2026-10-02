import { useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import type { TrashItem } from '@stickydo/core/storage'
import { TRASH_RETENTION_MS } from '@stickydo/core/storage'
import { noteColorVar } from '../../design/colors'
import { NoteRenderer } from '../notes/NoteRenderer'
import { noteTitle, useNotes } from '../notes/store'
import { boardName, openNote } from '../boards/actions'
import { useNow } from '../todos/useTodos'

const DAY = 24 * 60 * 60 * 1000

/**
 * 回收站（docs/frontend-design.md §2.9）：删除的便利贴在这里保留 30 天。
 * 恢复后回到原来的看板（看板不在了就回收件箱）；彻底删除只清理本机的回收站。
 */
export function TrashView() {
  const trash = useNotes((s) => s.trash)
  const now = useNow()
  const items = useMemo(() => [...trash].sort((a, b) => b.deletedAt - a.deletedAt), [trash])

  const emptyAll = () => {
    const removed = useNotes.getState().deleteForever(items.map((t) => t.id))
    toast(`已清空回收站（${removed.length} 张）`, {
      id: 'empty-trash',
      action: { label: '撤销', onClick: () => useNotes.getState().putBackToTrash(removed) },
    })
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[880px] px-5 pt-20 pb-24 sm:px-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight text-ink">回收站</h1>
            <p className="mt-1 text-[13px] text-ink-muted">删除的便利贴保留 30 天，之后自动清除</p>
          </div>
          {items.length > 0 && (
            <button
              type="button"
              onClick={emptyAll}
              className="rounded-lg px-3 py-1.5 text-[13px] text-danger transition-colors hover:bg-danger-soft"
            >
              清空回收站
            </button>
          )}
        </header>

        {items.length === 0 ? (
          <motion.div
            className="mt-16 flex flex-col items-center gap-4 text-center"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: { delay: 0.1 } }}
          >
            <svg width="88" height="80" viewBox="0 0 88 80" fill="none" aria-hidden>
              <path d="M22 26h44l-4 44a4 4 0 01-4 4H30a4 4 0 01-4-4z" fill="var(--note-sand)" />
              <path d="M18 26h52M36 26v-6h16v6" stroke="var(--ink-faint)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M38 38v24M50 38v24" stroke="var(--note-ink-muted)" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <div>
              <p className="text-[15px] font-medium text-ink">回收站是空的</p>
              <p className="mt-1.5 text-[13px] text-ink-muted">删除的便利贴会在这里保留 30 天</p>
            </div>
          </motion.div>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5">
            <AnimatePresence initial={false}>
              {items.map((t) => (
                <TrashCard key={t.id} item={t} now={now.getTime()} />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </div>
  )
}

function TrashCard({ item, now }: { item: TrashItem; now: number }) {
  const days = Math.floor((now - item.deletedAt) / DAY)
  const left = Math.max(1, Math.ceil((TRASH_RETENTION_MS - (now - item.deletedAt)) / DAY))
  const when = days === 0 ? '今天删除' : `${days} 天前删除`

  const restore = () => {
    const to = useNotes.getState().restoreFromTrash(item.id)
    if (to === undefined) return
    toast(`已恢复「${noteTitle(item.note)}」到「${boardName(to)}」`, {
      id: `restore-${item.id}`,
      action: { label: '查看', onClick: () => openNote(item.id) },
    })
  }
  const remove = () => {
    const removed = useNotes.getState().deleteForever([item.id])
    toast(`已彻底删除「${noteTitle(item.note)}」`, {
      id: `forever-${item.id}`,
      action: { label: '撤销', onClick: () => useNotes.getState().putBackToTrash(removed) },
    })
  }

  return (
    <motion.li
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.18 } }}
      className="flex flex-col gap-2"
      data-trash={noteTitle(item.note)}
    >
      <div className="note-paper relative h-[150px] overflow-hidden opacity-90" style={{ backgroundColor: noteColorVar(item.note.color) }}>
        <div className="note-text note-text-clip pointer-events-none h-full overflow-hidden px-4 pt-4 pb-3 select-none">
          <NoteRenderer doc={item.note.content} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 px-0.5">
        <div className="min-w-0 text-[12px] leading-snug text-ink-faint">
          <div className="truncate">
            {when}
            {item.boardName ? ` · 来自「${item.boardName}」` : ''}
          </div>
          <div>{left} 天后清除</div>
        </div>
        <div className="flex flex-none gap-1">
          <button
            type="button"
            onClick={restore}
            className="rounded-lg px-2.5 py-1 text-[13px] font-medium text-ink transition-colors hover:bg-chrome-hover"
          >
            恢复
          </button>
          <button
            type="button"
            onClick={remove}
            title="彻底删除"
            aria-label={`彻底删除「${noteTitle(item.note)}」`}
            className="rounded-lg px-2 py-1 text-[13px] text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger"
          >
            彻底删除
          </button>
        </div>
      </div>
    </motion.li>
  )
}
