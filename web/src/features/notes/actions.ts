import { toast } from 'sonner'
import { type NoteSizeKey, useSettings } from '../settings'
import { gridLayout } from './layout'
import { NOTE_SIZES, noteTitle, sizeOf, type Snapshot, useNotes, visibleNotes } from './store'
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
 * 全局调整大小：把当前白板上的所有便利贴统一成某一档尺寸，再按阅读顺序自动排成网格。
 * 整体算一步撤销；提示条上的“撤销”精确恢复排列前每张便利贴的位置和大小。
 */
export function applyNoteSize(key: NoteSizeKey) {
  useSettings.getState().setNoteSize(key)
  const s = useNotes.getState()
  const notes = visibleNotes()
  if (notes.length === 0) return

  const size = sizeOf(key)
  const v = boardViewport()
  const positions = gridLayout(notes, size, v?.width ?? window.innerWidth)
  const before = new Map(notes.map((n) => [n.id, { x: n.x, y: n.y, w: n.w, h: n.h }]))
  const patches = new Map([...positions].map(([id, p]) => [id, { ...p, w: size.w, h: size.h }]))
  const changed = notes.some((n) => {
    const p = patches.get(n.id)!
    return p.x !== n.x || p.y !== n.y || p.w !== n.w || p.h !== n.h
  })
  v?.scrollTo(0, 0)
  if (!changed) return
  s.patchMany(patches)

  toast(`已统一为「${size.label}」并排列 ${notes.length} 张便利贴`, {
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

/** 全局尺寸放大 / 缩小一档（快捷键 = / -） */
export function stepNoteSize(dir: 1 | -1) {
  const i = NOTE_SIZES.findIndex((p) => p.key === useSettings.getState().noteSize)
  const next = NOTE_SIZES[i + dir]
  if (next) applyNoteSize(next.key)
}
