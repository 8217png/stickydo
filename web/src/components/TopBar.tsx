import type { ReactNode } from 'react'
import { type ThemePref, useSettings } from '../features/settings'
import { useNotes } from '../features/notes/store'

const THEME_NEXT: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' }
const THEME_LABEL: Record<ThemePref, string> = { system: '跟随系统', light: '浅色', dark: '暗色' }

export function TopBar({ onHelp }: { onHelp: () => void }) {
  const { theme, setTheme, tilt, setTilt } = useSettings()
  const canUndo = useNotes((s) => s.past.length > 0)
  const canRedo = useNotes((s) => s.future.length > 0)
  const { undo, redo } = useNotes.getState()

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-[9000] flex items-center justify-between p-3">
      <div className="pointer-events-auto flex items-center gap-2 rounded-ui border border-chrome-border bg-chrome px-3 py-1.5 shadow-chrome backdrop-blur-md">
        <Logo />
        <span className="text-[14px] font-semibold tracking-tight">Sticky-Do</span>
        <span className="ml-1 rounded-full bg-chrome-hover px-1.5 py-px text-[10px] font-medium text-ink-faint">M0</span>
      </div>

      <div className="pointer-events-auto flex items-center gap-0.5 rounded-ui border border-chrome-border bg-chrome p-1 shadow-chrome backdrop-blur-md">
        <IconButton title="撤销（Ctrl+Z）" disabled={!canUndo} onClick={undo}>
          <path d="M5.5 4L3 6.5 5.5 9M3.5 6.5h6a3.5 3.5 0 010 7H8" />
        </IconButton>
        <IconButton title="重做（Ctrl+Shift+Z）" disabled={!canRedo} onClick={redo}>
          <path d="M10.5 4L13 6.5 10.5 9M12.5 6.5h-6a3.5 3.5 0 000 7H8" />
        </IconButton>
        <span className="mx-1 h-4 w-px bg-chrome-border" />
        <IconButton title={tilt ? '倾斜：开' : '倾斜：关'} active={tilt} onClick={() => setTilt(!tilt)}>
          <rect x="4" y="4" width="8" height="8" rx="1" transform={tilt ? 'rotate(-8 8 8)' : undefined} />
        </IconButton>
        <IconButton title={`主题：${THEME_LABEL[theme]}`} onClick={() => setTheme(THEME_NEXT[theme])}>
          {theme === 'light' && <><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" /></>}
          {theme === 'dark' && <path d="M13 9.5A5.5 5.5 0 016.5 3a5.5 5.5 0 106.5 6.5z" />}
          {theme === 'system' && <><circle cx="8" cy="8" r="5.5" /><path d="M8 2.5v11a5.5 5.5 0 000-11z" fill="currentColor" /></>}
        </IconButton>
        <IconButton title="快捷键（?）" onClick={onHelp}>
          <rect x="1.5" y="4" width="13" height="8.5" rx="1.5" /><path d="M4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01M5 10h6" />
        </IconButton>
      </div>
    </header>
  )
}

function IconButton(props: { title: string; onClick: () => void; disabled?: boolean; active?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={props.title}
      aria-label={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      className={`grid size-8 place-items-center rounded-lg transition-colors hover:bg-chrome-hover disabled:opacity-35 disabled:hover:bg-transparent ${props.active ? 'text-ink' : 'text-ink-muted'}`}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        {props.children}
      </svg>
    </button>
  )
}

function Logo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <rect x="2" y="3" width="13" height="13" rx="2" transform="rotate(-6 9 9)" fill="var(--note-lemon)" stroke="var(--chrome-border)" />
      <path d="M6 9.5l2 2 4-4.5" fill="none" stroke="var(--note-ink)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" transform="rotate(-6 9 9)" />
    </svg>
  )
}
