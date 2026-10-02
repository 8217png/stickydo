import type { JSONContent } from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'
import { noteExtensions } from './extensions'

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

// ---------- 旧版 Markdown 便利贴的迁移 ----------

let markdown: MarkdownManager | null = null

const BLOCK = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~|\||---\s*$|\*\*\*\s*$|\[[ xX]?\]\s)/

/**
 * M0/M1 的便利贴是 Markdown 文本，且“换行即换行”、第一行是标题。
 * 迁移时让连续的普通文字行各成一段，标题因此单独成为第一段（样式上仍加粗）。
 */
export function markdownToDoc(md: string): NoteDoc {
  if (!md.trim()) return emptyDoc()
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let fence = false
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    out.push(line)
    const next = lines[i + 1]
    const plain = (l: string) => l.trim() !== '' && !BLOCK.test(l)
    // 普通行后面跟着普通行：中间补一个空行，变成两个段落
    if (!fence && next !== undefined && plain(line) && plain(next)) out.push('')
    // 普通行后面紧跟列表等块：也断开，避免被并进上一段
    else if (!fence && next !== undefined && plain(line) && next.trim() !== '' && BLOCK.test(next)) out.push('')
  })
  // 行首 [] / [ ] 是我们自己的待办写法，转成标准 GFM
  const normalized = out.join('\n').replace(/^(\s*)\[( |x|X)?\](\s)/gm, (_, s, x, sp) => `${s}- [${x ?? ' '}]${sp}`)
  try {
    markdown ??= new MarkdownManager({ extensions: noteExtensions() })
    const parsed = markdown.parse(normalized)
    return isNoteDoc(parsed) ? parsed : docFromText(md)
  } catch {
    return docFromText(md)
  }
}
