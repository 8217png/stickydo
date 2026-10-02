import { memo, type ReactNode } from 'react'
import type { JSONContent } from '@tiptap/core'
import { dueStatus, formatDue, hasTodoMeta, PRIORITY_LABEL, todoMeta } from '@stickydo/core/capture'
import type { NoteDoc } from './doc'

/**
 * 不在编辑状态的便利贴：把 Tiptap JSON 直接渲染成 React 元素。
 * 比给每张便利贴挂一个只读编辑器轻得多；文字永远作为文本渲染，不解析 HTML，
 * 链接只允许 http(s) / mailto。待办的复选框可以直接点击。
 */
export const NoteRenderer = memo(function NoteRenderer({
  doc,
  onToggleTask,
}: {
  doc: NoteDoc
  /** 点击待办复选框：path 是该 taskItem 在文档中的位置 */
  onToggleTask?: (path: number[]) => void
}) {
  return <div className="note-md">{renderChildren(doc, [], onToggleTask)}</div>
})

type Toggle = ((path: number[]) => void) | undefined

function renderChildren(node: JSONContent, path: number[], toggle: Toggle): ReactNode {
  return (node.content ?? []).map((child, i) => renderNode(child, [...path, i], toggle))
}

function renderNode(node: JSONContent, path: number[], toggle: Toggle): ReactNode {
  const key = path.join('.')
  const kids = () => renderChildren(node, path, toggle)
  switch (node.type) {
    case 'paragraph':
      return <p key={key}>{node.content?.length ? kids() : <br />}</p>
    case 'heading': {
      const level = Math.min(3, Math.max(1, Number(node.attrs?.level) || 1))
      const H = `h${level}` as 'h1' | 'h2' | 'h3'
      return <H key={key}>{kids()}</H>
    }
    case 'bulletList':
      return <ul key={key}>{kids()}</ul>
    case 'orderedList':
      return (
        <ol key={key} start={Number(node.attrs?.start) || 1}>
          {kids()}
        </ol>
      )
    case 'listItem':
      return <li key={key}>{kids()}</li>
    case 'taskList':
      return (
        <ul key={key} className="contains-task-list">
          {kids()}
        </ul>
      )
    case 'taskItem': {
      const checked = !!node.attrs?.checked
      return (
        <li key={key} className="task-list-item" data-checked={checked}>
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
              toggle?.(path)
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
              <path d="M2 5.2l2 2 4-4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="task-item-body">
            {kids()}
            <TodoMetaChips attrs={node.attrs} />
          </div>
        </li>
      )
    }
    case 'blockquote':
      return <blockquote key={key}>{kids()}</blockquote>
    case 'codeBlock':
      return (
        <pre key={key}>
          <code>{(node.content ?? []).map((t) => t.text ?? '').join('')}</code>
        </pre>
      )
    case 'horizontalRule':
      return <hr key={key} />
    case 'hardBreak':
      return <br key={key} />
    case 'text':
      return <Text key={key} node={node} />
    default:
      // 不认识的节点：只渲染其中的内容
      return <span key={key}>{kids()}</span>
  }
}

function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null
  try {
    const u = new URL(href, 'https://invalid.local')
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) && !href.startsWith('/') ? href : null
  } catch {
    return null
  }
}

function Text({ node }: { node: JSONContent }) {
  let out: ReactNode = node.text ?? ''
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'bold':
        out = <strong>{out}</strong>
        break
      case 'italic':
        out = <em>{out}</em>
        break
      case 'strike':
        out = <del>{out}</del>
        break
      case 'code':
        out = <code>{out}</code>
        break
      case 'link': {
        const href = safeHref(mark.attrs?.href)
        if (href)
          out = (
            <a className="no-drag" href={href} target="_blank" rel="noreferrer noopener" onDoubleClick={(e) => e.stopPropagation()}>
              {out}
            </a>
          )
        break
      }
    }
  }
  return <>{out}</>
}

/** 切换 path 处待办的勾选状态，返回新文档（不修改原文档） */
export function toggleTaskAt(doc: NoteDoc, path: number[]): NoteDoc {
  const update = (node: JSONContent, depth: number): JSONContent => {
    if (depth === path.length) {
      return node.type === 'taskItem' ? { ...node, attrs: { ...node.attrs, checked: !node.attrs?.checked } } : node
    }
    const i = path[depth]
    const content = node.content?.slice()
    if (!content || !content[i]) return node
    content[i] = update(content[i], depth + 1)
    return { ...node, content }
  }
  return update(doc, 0) as NoteDoc
}

/** 待办项下方的小标签：时间（逾期用柔和的橙色）、优先级、标签 */
function TodoMetaChips({ attrs }: { attrs: JSONContent['attrs'] }) {
  const meta = todoMeta(attrs)
  if (!hasTodoMeta(meta)) return null
  const status = meta.due && dueStatus(meta.due)
  return (
    <span className="todo-meta">
      {meta.due && (
        <span className="todo-chip" data-status={status} title={status === 'overdue' ? '已逾期' : undefined}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
            <rect x="2" y="3" width="12" height="11" rx="2" />
            <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
          </svg>
          {formatDue(meta.due)}
        </span>
      )}
      {meta.priority > 0 && (
        <span className="todo-chip" data-priority={meta.priority}>
          !{PRIORITY_LABEL[meta.priority]}
        </span>
      )}
      {meta.tags.map((t) => (
        <span key={t} className="todo-chip todo-tag">
          #{t}
        </span>
      ))}
    </span>
  )
}
