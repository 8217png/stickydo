/**
 * 便利贴正文：Tiptap 文档 JSON 的读写工具。
 * 不依赖 Tiptap（移动端没有 DOM），只按 JSON 结构处理；类型与 Tiptap 的 JSONContent 兼容。
 */

/** 文档节点（与 @tiptap/core 的 JSONContent 结构相同） */
export interface JSONContent {
  type?: string
  attrs?: Record<string, any>
  content?: JSONContent[]
  marks?: { type: string; attrs?: Record<string, any>; [key: string]: any }[]
  text?: string
  [key: string]: any
}

/** 便利贴正文：Tiptap 文档 JSON */
export type NoteDoc = JSONContent & { type: 'doc' }

export const emptyDoc = (): NoteDoc => ({ type: 'doc', content: [{ type: 'paragraph' }] })

const paragraph = (text: string): JSONContent =>
  text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' }

/** 纯文本 → 文档：每行一个段落（粘贴文字新建便利贴时用） */
export function docFromText(text: string): NoteDoc {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  // 合并连续空行
  const kept = lines.filter((l, i) => l.trim() !== '' || (i > 0 && lines[i - 1].trim() !== ''))
  return { type: 'doc', content: kept.length ? kept.map((l) => paragraph(l.trimEnd())) : [{ type: 'paragraph' }] }
}

/** 文档里的纯文本，按块用换行连接 */
export function docText(node: JSONContent | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  const inner = (node.content ?? []).map(docText)
  const isBlockContainer = node.type === 'doc' || node.type?.endsWith('List') || node.type === 'listItem' || node.type === 'taskItem' || node.type === 'blockquote'
  return inner.join(isBlockContainer ? '\n' : '')
}

/** 第一行有字的文本，用作提示条里的标题 */
export function docTitle(d: NoteDoc): string {
  return docText(d).split('\n').find((l) => l.trim())?.trim() ?? ''
}

export const docIsEmpty = (d: NoteDoc) => docText(d).trim() === ''

/** 去掉末尾的空段落（至少保留一个块），保存前调用，避免内容出现无意义的差异 */
export function trimDoc(d: NoteDoc): NoteDoc {
  const blocks = d.content ?? []
  let end = blocks.length
  while (end > 1 && blocks[end - 1].type === 'paragraph' && !blocks[end - 1].content?.length) end--
  return end === blocks.length ? d : { ...d, content: blocks.slice(0, end) }
}

export function isNoteDoc(v: unknown): v is NoteDoc {
  return !!v && typeof v === 'object' && (v as { type?: unknown }).type === 'doc'
}
