import { toast } from 'sonner'
import { type Note, type NoteSize, noteTitle, useNotes } from './store'

/** 零确认删除：立即生效，底部提示条提供撤销（docs/frontend-design.md §2.3） */
export function deleteWithUndo(id: string, snapshot?: Note[]) {
  const s = useNotes.getState()
  const note = (snapshot ?? s.notes).find((n) => n.id === id)
  if (!note) return
  if (snapshot) s.checkpoint(snapshot)
  s.remove(id, { record: !snapshot })
  toast(`已删除「${noteTitle(note)}」`, {
    id: `delete-${id}`,
    action: { label: '撤销', onClick: () => useNotes.getState().restore(note) },
  })
}

/** 一键调整到预设尺寸；左上角不动 */
export function resizeToPreset(id: string, size: NoteSize) {
  const s = useNotes.getState()
  const note = s.notes.find((n) => n.id === id)
  if (!note || (note.w === size.w && note.h === size.h)) return
  s.update(id, { w: size.w, h: size.h })
}
