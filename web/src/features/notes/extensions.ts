import type { AnyExtension } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import StarterKit from '@tiptap/starter-kit'
import { dueFromAttr, formatDue, PRIORITY_LABEL, todoMeta } from '@stickydo/core/capture'

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
    ...(opts.placeholder ? [Placeholder.configure({ placeholder: opts.placeholder })] : []),
  ]
}
