import type { JSONContent, NoteDoc } from '../notes/doc'
import { docFromText } from '../notes/doc'
import { type Due, dueFromAttr, dueToAttr, type Priority } from './due'
import type { Capture } from './parse'

/**
 * 待办就是便利贴里的待办项（Tiptap 的 taskItem），时间、优先级、标签是它的属性：
 *   { type: 'taskItem', attrs: { checked, due: '2026-10-03T15:00', priority: 3, tags: ['生活'] }, content: [...] }
 * 见 docs/architecture.md「待办」。
 */

export interface TodoMeta {
  due?: Due
  priority: Priority
  tags: string[]
}

/** 从 taskItem 的属性里读出待办信息（容错：不认识的值当作没有） */
export function todoMeta(attrs: Record<string, unknown> | undefined): TodoMeta {
  const p = Number(attrs?.priority)
  const tags = Array.isArray(attrs?.tags) ? attrs.tags.filter((t): t is string => typeof t === 'string' && t !== '') : []
  return {
    due: dueFromAttr(attrs?.due),
    priority: (p === 1 || p === 2 || p === 3 ? p : 0) as Priority,
    tags,
  }
}

export const hasTodoMeta = (m: TodoMeta) => !!m.due || m.priority > 0 || m.tags.length > 0

/** 快速记录的结果 → 便利贴正文：待办是一条待办项，普通文字每行一段 */
export function captureToDoc(c: Capture): NoteDoc {
  if (c.kind === 'note') return docFromText(c.title)
  const attrs: Record<string, unknown> = { checked: false }
  if (c.due) attrs.due = dueToAttr(c.due)
  if (c.priority) attrs.priority = c.priority
  if (c.tags.length) attrs.tags = c.tags
  const para: JSONContent = c.title ? { type: 'paragraph', content: [{ type: 'text', text: c.title }] } : { type: 'paragraph' }
  return { type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs, content: [para] }] }] }
}
