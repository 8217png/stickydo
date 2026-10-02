import { type AnyExtension, Extension, type JSONContent } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { type EditorState, TextSelection } from '@tiptap/pm/state'
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

/** 光标所在的表格行：行节点、它在表格里是第几行、行的起始位置 */
function currentRow(state: EditorState) {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'tableRow') {
      return { row: $from.node(d), index: $from.index(d - 1), start: $from.before(d), depth: d }
    }
  }
  return null
}

/**
 * 表格的写法和快捷键：
 * - Markdown 写法：在 `| 姓名 | 电话 |` 这样一行的末尾回车，这一行变成表头，下面接一行空的，光标移到第一个格子。
 *   只在顶层段落里生效（列表、引用、表格里不变）
 * - Tab / Shift+Tab 在格子之间移动，在最后一格按 Tab 加一行（Tiptap 自带）
 * - Ctrl+Alt+↑ / ↓ 在上方 / 下方插入行，Ctrl+Shift+Backspace 删除当前行
 * - Ctrl+Alt+Shift+← / → 在左侧 / 右侧插入列，Ctrl+Alt+Shift+Backspace 删除当前列
 * - 在一行空行的第一格开头按 Backspace：删掉这一行，光标回到上一行末尾（表头不删）
 */
const TableShortcuts = Extension.create({
  name: 'tableShortcuts',
  priority: 200,
  addKeyboardShortcuts() {
    const inTable = () => this.editor.isActive('table')
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
      Backspace: ({ editor }) => {
        const { selection } = editor.state
        const r = currentRow(editor.state)
        if (!r || !selection.empty || r.index === 0 || r.row.textContent !== '') return false
        // 只在第一格的开头：光标前面就是这一行的开始（行 → 格子 → 段落）
        if (selection.from !== r.start + 3) return false
        return editor
          .chain()
          .deleteRow()
          .command(({ tr }) => {
            // 删掉后回到上一行最后一格的末尾
            const prev = tr.doc.resolve(r.start - 1)
            tr.setSelection(TextSelection.near(prev, -1))
            return true
          })
          .run()
      },
      'Mod-Alt-ArrowUp': () => inTable() && this.editor.commands.addRowBefore(),
      'Mod-Alt-ArrowDown': () => inTable() && this.editor.commands.addRowAfter(),
      'Mod-Shift-Backspace': () => inTable() && this.editor.commands.deleteRow(),
      'Mod-Alt-Shift-ArrowLeft': () => inTable() && this.editor.commands.addColumnBefore(),
      'Mod-Alt-Shift-ArrowRight': () => inTable() && this.editor.commands.addColumnAfter(),
      'Mod-Alt-Shift-Backspace': () => inTable() && this.editor.commands.deleteColumn(),
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
    TableShortcuts,
    ...(opts.placeholder ? [Placeholder.configure({ placeholder: opts.placeholder })] : []),
  ]
}
