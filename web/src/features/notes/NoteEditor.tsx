import { type ReactNode, useEffect, useRef } from 'react'
import { type Editor, EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { type Note, type Snapshot, snapshotNow } from './store'
import { cleanDoc, hasMarkdownTable, type NoteDoc, trimDoc } from './doc'
import { markdownToDoc } from './markdown'
import { noteExtensions } from './extensions'

/**
 * 原地编辑：Tiptap 所见即所得编辑器。Markdown 写法会即时变成格式（# 标题、- 列表、[] 待办、**粗体** 等）。
 * Esc 或 Ctrl/⌘+Enter 结束编辑；点到别处也会结束。
 */
export default function NoteEditor({
  note,
  onDone,
  fit,
  takeOver,
}: {
  note: Note
  onDone: (content: NoteDoc, snapshot: Snapshot) => void
  fit?: boolean
  /** 第一次拿到焦点时调用：取走编辑器出来之前已经打的字（见 StickyNote.tsx 的 NoteEditor） */
  takeOver?: () => string
}) {
  // 进入编辑时的快照：编辑结束、内容确实变了才作为一步撤销记录
  const snapshot = useRef(snapshotNow())
  const takeOverRef = useRef(takeOver)
  const done = useRef(false)
  const finish = (doc: NoteDoc) => {
    if (done.current) return
    done.current = true
    onDone(doc, snapshot.current)
  }

  const editor = useEditor({
    extensions: noteExtensions({ placeholder: '写点什么…' }),
    content: note.content,
    autofocus: false,
    onFocus: ({ editor }) => {
      const take = takeOverRef.current
      if (!take) return
      takeOverRef.current = undefined
      const text = take()
      if (!text) return
      const chain = editor.chain().setTextSelection(editor.state.doc.content.size)
      text.split('\n').forEach((line, i) => {
        if (i > 0) chain.splitBlock()
        if (line) chain.insertContent(line)
      })
      chain.run()
    },
    editorProps: {
      attributes: { class: 'note-md note-editor outline-none', spellcheck: 'false' },
      // 粘贴带表格的 Markdown 文字（例如从别的笔记软件、AI 回答里复制）：按 Markdown 解析，表格直接变成表格
      handlePaste: (_view, e) => {
        const text = e.clipboardData?.getData('text/plain')
        if (!text || !hasMarkdownTable(text) || !editor) return false
        // 在表格里粘贴时按普通文字处理（表格不能套表格）
        if (editor.isActive('table')) return false
        const doc = markdownToDoc(text)
        editor.commands.insertContent(doc.content ?? [])
        return true
      },
      handleKeyDown: (view, e) => {
        if (e.isComposing) return false
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault()
          ;(view.dom as HTMLElement).blur()
          return true
        }
        return false
      },
    },
    // 去掉编辑器补上的默认属性和末尾空段落，内容没改时与原来完全一致
    onBlur: ({ editor }) => finish(cleanDoc(trimDoc(editor.getJSON() as NoteDoc))),
  })

  // 编辑器挂上页面后取焦点；真正拿到焦点时（onFocus）再接过临时输入框里已经打的字
  useEffect(() => {
    // 开发模式（StrictMode）下第一个实例会被销毁重建，跳过已销毁的
    if (editor && !editor.isDestroyed) editor.commands.focus('end')
  }, [editor])

  return (
    <>
      <EditorContent
        editor={editor}
        className={`no-drag note-text cursor-text px-4 pt-4 pb-3 ${fit ? 'min-h-[72px]' : 'h-full overflow-y-auto'}`}
        onPointerDown={(e) => e.stopPropagation()}
      />
      {editor && <TableToolbar editor={editor} />}
    </>
  )
}

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
const alt = mod === '⌘' ? '⌥' : 'Alt'

type TableAction = { key: string; label: string; keys?: string; run: (e: Editor) => boolean; can: (e: Editor) => boolean; icon: ReactNode; danger?: boolean }

const ACTIONS: (TableAction | 'sep' | { group: string })[] = [
  { group: '行' },
  {
    key: 'rowBefore',
    label: '上方插入行',
    keys: `${mod}+${alt}+↑`,
    run: (e) => e.chain().focus().addRowBefore().run(),
    can: (e) => e.can().addRowBefore(),
    icon: <path d="M2.5 9.5h11v4h-11zM8 2.5v5M5.5 5H10.5" />,
  },
  {
    key: 'rowAfter',
    label: '下方插入行',
    keys: `${mod}+${alt}+↓`,
    run: (e) => e.chain().focus().addRowAfter().run(),
    can: (e) => e.can().addRowAfter(),
    icon: <path d="M2.5 2.5h11v4h-11zM8 8.5v5M5.5 11H10.5" />,
  },
  {
    key: 'deleteRow',
    label: '删除行',
    keys: `${mod}+Shift+Backspace`,
    run: (e) => e.chain().focus().deleteRow().run(),
    can: (e) => e.can().deleteRow(),
    icon: <path d="M2.5 6h11v4h-11zM6 3.5l4 9M10 3.5l-4 9" />,
    danger: true,
  },
  'sep',
  { group: '列' },
  {
    key: 'colBefore',
    label: '左侧插入列',
    keys: `${mod}+${alt}+Shift+←`,
    run: (e) => e.chain().focus().addColumnBefore().run(),
    can: (e) => e.can().addColumnBefore(),
    icon: <path d="M9.5 2.5h4v11h-4zM2.5 8h5M5 5.5v5" />,
  },
  {
    key: 'colAfter',
    label: '右侧插入列',
    keys: `${mod}+${alt}+Shift+→`,
    run: (e) => e.chain().focus().addColumnAfter().run(),
    can: (e) => e.can().addColumnAfter(),
    icon: <path d="M2.5 2.5h4v11h-4zM8.5 8h5M11 5.5v5" />,
  },
  {
    key: 'deleteColumn',
    label: '删除列',
    keys: `${mod}+${alt}+Shift+Backspace`,
    run: (e) => e.chain().focus().deleteColumn().run(),
    can: (e) => e.can().deleteColumn(),
    icon: <path d="M6 2.5h4v11H6zM3.5 6l9 4M12.5 6l-9 4" />,
    danger: true,
  },
  'sep',
  {
    key: 'deleteTable',
    label: '删除表格',
    run: (e) => e.chain().focus().deleteTable().run(),
    can: (e) => e.can().deleteTable(),
    icon: <path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.6 8.5h6.8l.6-8.5M2.5 8h11" />,
    danger: true,
  },
]

/**
 * 光标在表格里时，便利贴下方出现的表格工具栏：插入 / 删除行和列、删除表格。
 * 按下按钮时不让编辑器失去焦点（失去焦点就会结束编辑），操作都可以 Ctrl+Z 撤销。
 */
function TableToolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => (e.isActive('table') ? Object.fromEntries(ACTIONS.flatMap((a) => (a === 'sep' || 'group' in a ? [] : [[a.key, a.can(e)]]))) : null),
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  })
  if (!state) return null
  return (
    <div
      role="toolbar"
      aria-label="表格"
      className="no-drag absolute top-full left-0 z-20 mt-2 flex items-center gap-0.5 rounded-ui border border-chrome-border bg-chrome p-1 shadow-chrome backdrop-blur-md"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.preventDefault()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {ACTIONS.map((a, i) =>
        a === 'sep' ? (
          <span key={i} className="mx-1 h-4 w-px bg-chrome-border" />
        ) : 'group' in a ? (
          <span key={i} className="pr-0.5 pl-1.5 text-[11.5px] text-ink-faint select-none">
            {a.group}
          </span>
        ) : (
          <button
            key={a.key}
            type="button"
            title={a.keys ? `${a.label}（${a.keys}）` : a.label}
            aria-label={a.label}
            disabled={!state[a.key]}
            className={`grid size-7 place-items-center rounded-md text-ink-muted transition-colors hover:bg-chrome-hover disabled:pointer-events-none disabled:opacity-35 ${a.danger ? 'hover:text-danger' : 'hover:text-ink'}`}
            onClick={() => a.run(editor)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {a.icon}
            </svg>
          </button>
        ),
      )}
    </div>
  )
}
