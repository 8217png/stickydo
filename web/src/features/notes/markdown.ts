import { MarkdownManager } from '@tiptap/markdown'
import { docFromText, emptyDoc, isNoteDoc, type NoteDoc } from '@stickydo/core/notes'
import { noteExtensions } from './extensions'

/**
 * 旧版 Markdown 便利贴的转换。依赖 Tiptap，只在真的有旧数据（或第一次放示例便利贴）时才加载：
 * 用 loadMarkdown() 动态引入，不进首屏的包。
 */

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
