import type { ReactNode } from 'react'
import { type BoardLayout, setBoardLayout, useBoardLayout } from '../features/view'

/** 右下角的“白板 | 列表”切换（快捷键 V） */
export function LayoutToggle() {
  const layout = useBoardLayout((s) => s.layout)
  const option = (value: BoardLayout, label: string, icon: ReactNode) => (
    <button
      type="button"
      role="radio"
      aria-checked={layout === value}
      title={`${label}（V 切换）`}
      onClick={(e) => {
        if (e.detail > 0) e.currentTarget.blur()
        setBoardLayout(value)
      }}
      className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] transition-colors ${
        layout === value ? 'bg-chrome-hover font-medium text-ink' : 'text-ink-muted hover:text-ink'
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {icon}
      </svg>
      <span className="max-sm:hidden">{label}</span>
    </button>
  )
  return (
    <div
      role="radiogroup"
      aria-label="显示方式"
      className="pointer-events-auto absolute right-3 bottom-3 z-[9000] flex items-center gap-0.5 rounded-ui border border-chrome-border bg-chrome p-1 shadow-chrome backdrop-blur-md"
    >
      {option('board', '白板', <><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="4" width="5" height="5" rx="1" /><rect x="3" y="9" width="5" height="5" rx="1" /></>)}
      {option('list', '列表', <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" />)}
    </div>
  )
}
