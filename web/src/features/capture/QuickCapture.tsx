import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { type Capture, type CaptureTokenKind, formatDue, PRIORITY_LABEL, parseCapture } from '@stickydo/core/capture'
import { createFromCapture } from './actions'
import { closeCapture, useCommandUI } from './state'

/**
 * 快速记录（docs/frontend-design.md §2.1）：Q 或顶栏 + 打开，打完字回车就保存。
 * [] 开头是待办：时间、优先级、标签在输入框里实时高亮，保存前就能确认解析结果。
 */
export function QuickCapture() {
  const open = useCommandUI((s) => s.captureOpen)
  return <AnimatePresence>{open && <CaptureDialog />}</AnimatePresence>
}

const TOKEN_STYLE: Record<CaptureTokenKind, string> = {
  todo: 'var(--chrome-hover)',
  due: 'color-mix(in srgb, var(--note-sky) 80%, transparent)',
  priority: 'color-mix(in srgb, var(--note-peach) 85%, transparent)',
  tag: 'color-mix(in srgb, var(--note-lavender) 85%, transparent)',
}

const MAX_HEIGHT = 168

function CaptureDialog() {
  const present = useIsPresent()
  const initial = useCommandUI((s) => s.captureText)
  const [text, setText] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const capture = useMemo(() => parseCapture(text), [text])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  // 高度随内容增长（最多约 6 行），高亮层跟着滚动
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(MAX_HEIGHT, el.scrollHeight)}px`
  }, [text])

  const save = (keepOpen: boolean) => {
    const id = createFromCapture(text)
    if (!id) return
    if (keepOpen) {
      // 连续记录：待办接着记待办
      setText(capture.kind === 'todo' ? '[] ' : '')
      ref.current?.focus()
    } else {
      closeCapture()
    }
  }

  return (
    <motion.div
      // 退出动画期间不再接收焦点和按键，免得吞掉紧接着按下的快捷键
      inert={!present}
      className="fixed inset-0 z-[10000] flex items-start justify-center bg-black/15 px-4 pt-[18vh] backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      onPointerDown={closeCapture}
    >
      <motion.div
        role="dialog"
        aria-label="快速记录"
        className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-chrome-border bg-surface shadow-chrome"
        initial={{ y: -8, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: -4, scale: 0.99, transition: { duration: 0.1 } }}
        transition={{ type: 'spring', stiffness: 520, damping: 36 }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="relative">
          {/* 高亮层：与输入框完全重叠，显示带底色的文字 */}
          <div
            ref={mirrorRef}
            aria-hidden
            className="capture-field pointer-events-none absolute inset-0 overflow-hidden text-ink"
          >
            <Highlighted text={text} capture={capture} />
          </div>
          <textarea
            ref={ref}
            rows={1}
            value={text}
            spellCheck={false}
            aria-label="记点什么"
            placeholder="记点什么…"
            onChange={(e) => setText(e.target.value)}
            onScroll={(e) => {
              if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                closeCapture()
              } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                save(true)
              } else if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                save(false)
              }
            }}
            className="capture-field relative block w-full resize-none bg-transparent text-transparent caret-[var(--ink)] outline-none placeholder:text-ink-faint"
            style={{ maxHeight: MAX_HEIGHT }}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-chrome-border px-4 py-2.5">
          <Preview capture={capture} empty={!text.trim()} />
          <div className="flex items-center gap-2 text-[12px] text-ink-faint">
            <span><kbd>Enter</kbd> 保存</span>
            <span className="max-sm:hidden"><kbd>Shift</kbd>+<kbd>Enter</kbd> 换行</span>
            <span className="max-sm:hidden"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> 保存并继续</span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

/** 按识别结果切分文字，识别到的部分加底色 */
function Highlighted({ text, capture }: { text: string; capture: Capture }) {
  const parts: ReactNode[] = []
  let at = 0
  for (const t of capture.tokens) {
    if (t.start > at) parts.push(text.slice(at, t.start))
    parts.push(
      <mark key={t.start} data-kind={t.kind} className="rounded-[4px] text-ink" style={{ background: TOKEN_STYLE[t.kind] }}>
        {text.slice(t.start, t.end)}
      </mark>,
    )
    at = t.end
  }
  parts.push(text.slice(at))
  // 末尾的换行需要占位，否则高亮层比输入框少一行
  parts.push('​')
  return <>{parts}</>
}

/** 将要创建的内容：便利贴，或带着时间、优先级、标签的待办 */
function Preview({ capture, empty }: { capture: Capture; empty: boolean }) {
  if (empty) {
    return (
      <span className="min-w-0 text-[12.5px] text-ink-muted">
        用 <code className="rounded bg-chrome-hover px-1">[]</code> 开头记待办，例如{' '}
        <span className="text-ink">[] 买牛奶 明天下午3点 !高 #生活</span>
      </span>
    )
  }
  const chip = (key: string, children: ReactNode, bg: string) => (
    <span key={key} className="rounded-full px-2 py-px text-[12px] text-ink" style={{ background: bg }}>
      {children}
    </span>
  )
  return (
    <span data-testid="capture-preview" className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12.5px] text-ink-muted">
      <span className="font-medium text-ink">{capture.kind === 'todo' ? '待办' : '便利贴'}</span>
      {capture.kind === 'todo' && (
        <>
          {capture.title && <span className="max-w-[16em] truncate">「{capture.title}」</span>}
          {capture.due && chip('due', `📅 ${formatDue(capture.due)}`, TOKEN_STYLE.due)}
          {capture.priority > 0 && chip('priority', `!${PRIORITY_LABEL[capture.priority]}`, TOKEN_STYLE.priority)}
          {capture.tags.map((t) => chip(`tag-${t}`, `#${t}`, TOKEN_STYLE.tag))}
        </>
      )}
    </span>
  )
}
