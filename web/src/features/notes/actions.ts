import { toast } from 'sonner'
import { flowLayout } from './layout'
import { noteTitle, type Snapshot, useNotes, visibleNotes } from './store'
import { boardViewport } from './viewport'

/** 零确认删除：立即生效，底部提示条提供撤销（docs/frontend-design.md §2.3） */
export function deleteWithUndo(id: string, snapshot?: Snapshot) {
  const s = useNotes.getState()
  const note = (snapshot?.notes ?? s.notes).find((n) => n.id === id)
  if (!note) return
  if (snapshot) s.checkpoint(snapshot)
  s.remove(id, { record: !snapshot })
  toast(`已删除「${noteTitle(note)}」`, {
    id: `delete-${id}`,
    action: { label: '撤销', onClick: () => useNotes.getState().restore(note) },
  })
}


/**
 * 重新排列当前白板：大小不变，按阅读顺序排成一行行（见 layout.ts flowLayout），画布回到原点。
 * 整体算一步撤销；提示条上的“撤销”精确恢复排列前每张便利贴的位置。调用前由界面二次确认（ArrangeButton）
 */
export function arrangeNotes() {
  const s = useNotes.getState()
  const notes = visibleNotes()
  if (notes.length === 0) return
  const v = boardViewport()
  const positions = flowLayout(notes, v?.width ?? window.innerWidth)
  const before = new Map(notes.map((n) => [n.id, { x: n.x, y: n.y }]))
  const changed = notes.some((n) => {
    const p = positions.get(n.id)!
    return p.x !== n.x || p.y !== n.y
  })
  v?.scrollTo(0, 0)
  if (!changed) return
  s.patchMany(positions)

  toast(`已重新排列 ${notes.length} 张便利贴`, {
    id: 'arrange',
    action: {
      label: '撤销',
      onClick: () => {
        const cur = useNotes.getState().notes
        useNotes.getState().patchMany(new Map([...before].filter(([id]) => cur.some((n) => n.id === id))))
      },
    },
  })
}
