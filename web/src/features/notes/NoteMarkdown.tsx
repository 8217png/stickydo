import { createContext, memo, useContext } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

/**
 * 便利贴的 Markdown 渲染（GFM：表格、删除线、任务列表、自动链接）。
 * - 换行即换行（remark-breaks），符合便利贴的书写习惯
 * - 不渲染原始 HTML，不加载外部图片
 * - 第一行如果是普通文字，作为标题加粗显示（与之前的约定一致）
 * - 任务列表的复选框可以直接点击，回写到源码里的 [ ] / [x]
 */

// 以这些语法开头的第一行不当作标题，而是按 Markdown 块渲染
const BLOCK_START = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~|\[[ xX]?\]|\||---|\*\*\*)/

/** 任务项在源码中的起始偏移，传给其中的复选框 */
const TaskOffset = createContext<number | null>(null)
/** 按偏移切换任务项的勾选状态 */
const TaskToggle = createContext<(offset: number) => void>(() => {})

export const NoteMarkdown = memo(function NoteMarkdown({
  content,
  onChange,
}: {
  content: string
  onChange: (next: string) => void
}) {
  const nl = content.indexOf('\n')
  const firstLine = nl === -1 ? content : content.slice(0, nl)
  const hasTitle = firstLine.trim() !== '' && !BLOCK_START.test(firstLine)
  const bodyStart = hasTitle ? (nl === -1 ? content.length : nl + 1) : 0
  const body = content.slice(bodyStart)

  const toggleTask = (offset: number) => {
    const at = bodyStart + offset
    const m = /\[([ xX])\]/.exec(content.slice(at))
    if (!m) return
    const i = at + m.index
    const mark = m[1] === ' ' ? 'x' : ' '
    onChange(`${content.slice(0, i)}[${mark}]${content.slice(i + 3)}`)
  }

  return (
    <div className="note-md">
      {hasTitle && <div className="note-md-title">{firstLine}</div>}
      {body.trim() && (
        <TaskToggle.Provider value={toggleTask}>
          <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
            {body}
          </Markdown>
        </TaskToggle.Provider>
      )}
    </div>
  )
})

const components: Components = {
  li({ node, className, children, ...rest }) {
    const isTask = className?.includes('task-list-item')
    const offset = node?.position?.start.offset
    return (
      <li className={className} {...rest}>
        {isTask && offset != null ? <TaskOffset.Provider value={offset}>{children}</TaskOffset.Provider> : children}
      </li>
    )
  },
  input({ type, checked }) {
    if (type !== 'checkbox') return null
    return <TaskCheckbox checked={!!checked} />
  },
  a({ href, children }) {
    return (
      <a
        className="no-drag"
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {children}
      </a>
    )
  },
  // 不加载外部图片：显示为替代文字
  img({ alt }) {
    return <span className="note-md-img">[图片{alt ? `：${alt}` : ''}]</span>
  },
}

function TaskCheckbox({ checked }: { checked: boolean }) {
  const offset = useContext(TaskOffset)
  const toggle = useContext(TaskToggle)
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? '标记为未完成' : '标记为完成'}
      className="no-drag note-md-check"
      data-checked={checked}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        if (offset != null) toggle(offset)
      }}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
        <path d="M2 5.2l2 2 4-4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
