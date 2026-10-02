import { type AnyExtension, Extension, type JSONContent } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { TextSelection } from '@tiptap/pm/state'
import { Placeholder } from '@tiptap/extensions'
import StarterKit from '@tiptap/starter-kit'
import { dueFromAttr, formatDue, PRIORITY_LABEL, todoMeta } from '@stickydo/core/capture'
import { markdownTableRow } from '@stickydo/core/notes'

/**
 * 待办项：在 Tiptap 的 taskItem 上加时间、优先级、标签（docs/architecture.md「待办」）。
 * - 回车拆分时不复制这些属性（keepOnSplit: false），否则新的一行会带着同样的时间
 * - 渲染成 data-* 属性：编辑时用 CSS 在文字下方显示，和非编辑状态看起来一致
 */
const TodoItem = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      due: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el) => el.getAttribute('data-due'),
        renderHTML: (a) => {
          const due = dueFromAttr(a.due)
          return due ? { 'data-due': a.due, 'data-meta-due': `📅 ${formatDue(due)}` } : {}
        },
      },
      priority: {
        default: 0,
        keepOnSplit: false,
        parseHTML: (el) => Number(el.getAttribute('data-priority')) || 0,
        renderHTML: (a) => {
          const p = todoMeta({ priority: a.priority }).priority
          return p ? { 'data-priority': p, 'data-meta-priority': `!${PRIORITY_LABEL[p]}` } : {}
        },
      },
      tags: {
        default: [],
        keepOnSplit: false,
        parseHTML: (el) => (el.getAttribute('data-tags') ?? '').split(',').filter(Boolean),
        renderHTML: (a) => {
          const tags = todoMeta({ tags: a.tags }).tags
          return tags.length ? { 'data-tags': tags.join(','), 'data-meta-tags': tags.map((t) => `#${t}`).join(' ') } : {}
        },
      },
    }
  },
})

/**
 * Markdown 写法的表格：在 `| 姓名 | 电话 |` 这样一行的末尾回车，这一行变成表头，下面接一行空的，
 * 光标移到第一个格子。之后 Tab / Shift+Tab 在格子之间移动，在最后一格按 Tab 加一行。
 * 只在顶层段落里生效（列表、引用、表格里不变）。
 */
const MarkdownTable = Extension.create({
  name: 'markdownTable',
  priority: 200,
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        const para = $from.parent
        if (!empty || $from.depth !== 1 || para.type.name !== 'paragraph' || $from.parentOffset !== para.content.size) return false
        const cells = markdownTableRow(para.textContent)
        if (!cells) return false
        const cell = (type: string, text: string): JSONContent => ({
          type,
          content: [text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' }],
        })
        const table: JSONContent = {
          type: 'table',
          content: [
            { type: 'tableRow', content: cells.map((c) => cell('tableHeader', c)) },
            { type: 'tableRow', content: cells.map(() => cell('tableCell', '')) },
          ],
        }
        const start = $from.before()
        return editor
          .chain()
          .insertContentAt({ from: start, to: $from.after() }, table)
          .command(({ tr }) => {
            // 第一行（表头）之后：进入第二行 → 第一个格子 → 格子里的段落
            const header = tr.doc.nodeAt(start)?.firstChild
            if (header) tr.setSelection(TextSelection.create(tr.doc, start + 1 + header.nodeSize + 3))
            return true
          })
          .run()
      },
    }
  },
})

/**
 * 便利贴编辑器的 Tiptap 扩展。存储格式是 Tiptap JSON（docs/architecture.md §4）。
 * StarterKit 自带 Markdown 快捷输入：# 标题、- 列表、1. 有序列表、> 引用、``` 代码、
 * **粗体**、*斜体*、~~删除线~~；TaskItem 支持行首输入 [] 或 [ ] 加空格生成待办。
 */
export function noteExtensions(opts: { placeholder?: string } = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      // 便利贴里不需要拖拽插入光标、下划线；也不要自动在末尾补空段落
      // （否则只是打开再关闭编辑器，内容也会变化，被误判为编辑）
      dropcursor: false,
      underline: false,
      trailingNode: false,
    }),
    TaskList,
    TodoItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    MarkdownTable,
    ...(opts.placeholder ? [Placeholder.configure({ placeholder: opts.placeholder })] : []),
  ]
}
