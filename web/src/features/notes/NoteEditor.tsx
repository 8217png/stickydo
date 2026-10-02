import { useEffect, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { type Note, type Snapshot, snapshotNow } from './store'
import { cleanDoc, type NoteDoc, trimDoc } from './doc'
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
    <EditorContent
      editor={editor}
      className={`no-drag note-text cursor-text px-4 pt-4 pb-3 ${fit ? 'min-h-[72px]' : 'h-full overflow-y-auto'}`}
      onPointerDown={(e) => e.stopPropagation()}
    />
  )
}
