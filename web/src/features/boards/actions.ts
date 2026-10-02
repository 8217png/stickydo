import { toast } from 'sonner'
import { noteBoardId, noteTitle, useNotes } from '../notes/store'
import { INBOX, setView, useView } from '../view'
import { scrollNoteIntoView } from '../notes/viewport'

/** 看板名称（收件箱为 null） */
export function boardName(boardId: string | null): string {
  if (!boardId) return '收件箱'
  return useNotes.getState().boards.find((b) => b.id === boardId)?.name ?? '收件箱'
}

/** 便利贴实际所在的看板 */
export function boardOfNote(id: string): string | null {
  const s = useNotes.getState()
  const note = s.notes.find((n) => n.id === id)
  return note ? noteBoardId(note, new Set(s.boards.map((b) => b.id))) : null
}

/** 打开便利贴所在的白板，选中它并滚动到可见处（从待办列表、搜索跳过去时用） */
export function openNote(id: string, opts: { edit?: boolean } = {}) {
  const boardId = boardOfNote(id)
  const v = useView.getState().view
  if (v.kind !== 'board' || v.boardId !== boardId) setView({ kind: 'board', boardId })
  // 等白板换好再选中，否则会被“换白板时取消选中”覆盖
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const s = useNotes.getState()
      if (opts.edit) s.setEditing(id)
      else s.select(id)
      scrollNoteIntoView(id)
    }),
  )
}

/** 把便利贴移到另一个看板，提示条可撤销 */
export function moveNoteWithUndo(id: string, boardId: string | null) {
  const s = useNotes.getState()
  const note = s.notes.find((n) => n.id === id)
  if (!note) return
  const from = boardOfNote(id)
  if (from === boardId) return
  s.moveToBoard(id, boardId)
  toast(`已把「${noteTitle(note)}」移到「${boardName(boardId)}」`, {
    id: `move-${id}`,
    action: { label: '撤销', onClick: () => useNotes.getState().moveToBoard(id, from) },
  })
}

/** 删除看板（连同其中的便利贴），立即生效，提示条可撤销 */
export function deleteBoardWithUndo(id: string) {
  const removed = useNotes.getState().deleteBoard(id)
  if (!removed) return
  const v = useView.getState().view
  if (v.kind === 'board' && v.boardId === id) setView(INBOX)
  const count = removed.notes.length
  toast(`已删除看板「${removed.board.name}」${count ? `和其中 ${count} 张便利贴` : ''}`, {
    id: `delete-board-${id}`,
    action: {
      label: '撤销',
      onClick: () => {
        useNotes.getState().restoreBoard(removed.board, removed.notes)
        setView({ kind: 'board', boardId: id })
      },
    },
  })
}

/** 新建看板并打开 */
export function createBoardAndOpen(name: string) {
  const id = useNotes.getState().createBoard(name, nextBoardColor())
  setView({ kind: 'board', boardId: id })
  return id
}

const BOARD_COLORS = ['sky', 'mint', 'peach', 'lavender', 'blossom', 'lemon', 'sand'] as const

/** 新看板轮流使用不同的颜色 */
function nextBoardColor() {
  return BOARD_COLORS[useNotes.getState().boards.length % BOARD_COLORS.length]
}
