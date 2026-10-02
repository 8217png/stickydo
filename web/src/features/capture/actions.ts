import { toast } from 'sonner'
import { captureToDoc } from '@stickydo/core/capture'
import { parseCapture } from '@stickydo/core/capture/parse'
import { useNotes } from '../notes/store'
import { nextNotePosition } from '../notes/viewport'

/**
 * 按快速记录的规则创建便利贴：普通文字是便利贴，[] 开头是一条待办（带时间、优先级、标签）。
 * 新便利贴放在可见区域中央并选中；可以撤销。返回新便利贴的 id，内容为空时返回 null。
 */
export function createFromCapture(text: string, opts: { reveal?: boolean } = {}): string | null {
  const c = parseCapture(text)
  if (!c.title && !c.due && c.tags.length === 0) return null
  const s = useNotes.getState()
  const pos = nextNotePosition({ preferCenter: true })
  const id = s.create({ ...pos, content: captureToDoc(c) })
  if (opts.reveal !== false) revealNote(id)
  const title = Array.from(c.title || '空白便利贴')
  const short = title.length > 16 ? `${title.slice(0, 16).join('')}…` : title.join('')
  toast(c.kind === 'todo' ? `已记录待办「${short}」` : `已记录「${short}」`, {
    id: `capture-${id}`,
    action: { label: '撤销', onClick: () => useNotes.getState().remove(id) },
  })
  return id
}

/** 选中一张便利贴并滚动到可见范围 */
export function revealNote(id: string) {
  useNotes.getState().select(id)
  requestAnimationFrame(() => {
    document.querySelector(`[data-note="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  })
}
