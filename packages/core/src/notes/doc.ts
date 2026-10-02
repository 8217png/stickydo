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
  const isBlockContainer =
    node.type === 'doc' || node.type?.endsWith('List') || node.type === 'listItem' || node.type === 'taskItem' || node.type === 'blockquote' || node.type === 'table'
  // 表格：一行一行，同一行的格子用制表符隔开；格子里的多段用空格连接
  const sep = isBlockContainer ? '\n' : node.type === 'tableRow' ? '\t' : node.type === 'tableCell' || node.type === 'tableHeader' ? ' ' : ''
  return inner.join(sep)
}

// ---------- Markdown 表格 ----------

/** 按没有转义的 | 拆开一行 */
function splitRow(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '\\' && line[i + 1] === '|') {
      cur += '|'
      i++
    } else if (c === '|') {
      cells.push(cur.trim())
      cur = ''
    } else cur += c
  }
  cells.push(cur.trim())
  return cells
}

const SEPARATOR_CELL = /^:?-+:?$/

/**
 * Markdown 表格的一行（`| 姓名 | 电话 |`，两边都要有 |）拆成格子；不是表格行、或者是分隔行（`|---|---|`）时返回 null。
 * 编辑器里在这样一行末尾回车，就把它变成表格的表头。
 */
export function markdownTableRow(line: string): string[] | null {
  const t = line.trim()
  if (t.length < 3 || !t.startsWith('|') || !t.endsWith('|') || t.endsWith('\\|')) return null
  const cells = splitRow(t.slice(1, -1))
  if (cells.every((c) => c === '')) return null
  if (cells.every((c) => SEPARATOR_CELL.test(c))) return null
  return cells
}

/** 文字里有没有 Markdown 表格（表头行后面紧跟分隔行），粘贴时用来决定要不要按 Markdown 解析 */
export function hasMarkdownTable(text: string): boolean {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  return lines.some((line, i) => {
    const next = lines[i + 1]?.trim()
    if (!next || !line.includes('|') || !next.includes('|')) return false
    const sep = splitRow(next.replace(/^\|/, '').replace(/\|$/, ''))
    return sep.length > 0 && sep.every((c) => SEPARATOR_CELL.test(c)) && splitRow(line.trim().replace(/^\|/, '').replace(/\|$/, '')).length === sep.length
  })
}

/** 第一行有字的文本，用作提示条里的标题（表格的一行显示成“姓名 · 电话”） */
export function docTitle(d: NoteDoc): string {
  const line = docText(d).split('\n').find((l) => l.trim()) ?? ''
  return line.split('\t').map((c) => c.trim()).filter(Boolean).join(' · ')
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

/**
 * 去掉待办项属性里的默认值（due: null、priority: 0、tags: []）。
 * 编辑器会给每个待办项补上这些默认值；保存前去掉，内容才不会因为“打开又关上”而变化。
 */
export function cleanDoc<T extends JSONContent>(node: T): T {
  let changed = false
  let attrs = node.attrs
  if (node.type === 'taskItem' && attrs) {
    const { due, priority, tags, ...rest } = attrs
    const next: Record<string, any> = { ...rest }
    if (due != null && due !== '') next.due = due
    if (priority) next.priority = priority
    if (Array.isArray(tags) && tags.length) next.tags = tags
    if (Object.keys(next).length !== Object.keys(attrs).length) {
      attrs = next
      changed = true
    }
  }
  let content = node.content
  if (content) {
    const cleaned = content.map(cleanDoc)
    if (cleaned.some((c, i) => c !== content![i])) {
      content = cleaned
      changed = true
    }
  }
  return changed ? { ...node, attrs, content } : node
}
