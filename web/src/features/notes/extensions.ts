import type { AnyExtension } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import StarterKit from '@tiptap/starter-kit'

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
    TaskItem.configure({ nested: true }),
    ...(opts.placeholder ? [Placeholder.configure({ placeholder: opts.placeholder })] : []),
  ]
}
