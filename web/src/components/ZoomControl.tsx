import { type MouseEvent, useEffect, useRef, useState } from 'react'
import { formatZoom, useZoom, ZOOM_MAX, ZOOM_MIN, zoomControls } from '../features/notes/zoom'

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = mac ? '⌘' : 'Ctrl'

const PRESETS = [0.5, 1, 1.5, 2]

/**
 * 右下角的缩放控件（白板视图）：显示全部便利贴 / 缩小 / 当前比例 / 放大。点比例弹出菜单：显示全部便利贴、常用比例。
 * 快捷键 Ctrl / ⌘ + = / - / 0、Shift + 1；Ctrl / ⌘ + 滚轮、触控板和触屏双指也能缩放（见 Whiteboard）
 */
export function ZoomControl() {
  const zoom = useZoom((s) => s.zoom)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  const blurAfter = (e: MouseEvent<HTMLButtonElement>) => {
    // 鼠标点完把焦点还给页面，单键快捷键接着能用；键盘操作时保留焦点
    if (e.detail > 0) e.currentTarget.blur()
  }
  const iconButton = 'grid size-8 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-chrome-hover hover:text-ink disabled:pointer-events-none disabled:opacity-35'
  const item = 'flex h-8 w-full items-center justify-between gap-4 rounded-lg px-2.5 text-left text-[13px] text-ink transition-colors hover:bg-chrome-hover'

  return (
    <div
      ref={ref}
      role="group"
      aria-label="缩放"
      className="pointer-events-auto relative flex items-center gap-0.5 rounded-ui border border-chrome-border bg-chrome p-1 shadow-chrome backdrop-blur-md"
    >
      <button
        type="button"
        title="显示全部便利贴（Shift 1）"
        aria-label="显示全部便利贴"
        className={iconButton}
        onClick={(e) => {
          blurAfter(e)
          zoomControls()?.fit()
        }}
      >
        {/* 四个角框住几张便利贴 */}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2 5.5V3a1 1 0 0 1 1-1h2.5M10.5 2H13a1 1 0 0 1 1 1v2.5M14 10.5V13a1 1 0 0 1-1 1h-2.5M5.5 14H3a1 1 0 0 1-1-1v-2.5" />
          <rect x="5" y="5" width="3" height="3" rx=".5" />
          <rect x="8.5" y="8" width="2.5" height="3" rx=".5" />
        </svg>
      </button>
      <span className="mx-0.5 h-4 w-px bg-chrome-border" aria-hidden />
      <button
        type="button"
        title={`缩小（${MOD} -）`}
        aria-label="缩小"
        disabled={zoom <= ZOOM_MIN + 0.001}
        className={iconButton}
        onClick={(e) => {
          blurAfter(e)
          zoomControls()?.step(-1)
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
          <path d="M3.5 8h9" />
        </svg>
      </button>
      <button
        type="button"
        title="缩放比例"
        aria-label={`缩放比例 ${formatZoom(zoom)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="h-8 min-w-[52px] rounded-lg px-1.5 text-[13px] text-ink-muted tabular-nums transition-colors hover:bg-chrome-hover hover:text-ink aria-expanded:bg-chrome-hover aria-expanded:text-ink"
        onClick={() => setOpen((o) => !o)}
      >
        {formatZoom(zoom)}
      </button>
      <button
        type="button"
        title={`放大（${MOD} +）`}
        aria-label="放大"
        disabled={zoom >= ZOOM_MAX - 0.001}
        className={iconButton}
        onClick={(e) => {
          blurAfter(e)
          zoomControls()?.step(1)
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
          <path d="M3.5 8h9M8 3.5v9" />
        </svg>
      </button>

      {open && (
        <div role="menu" aria-label="缩放比例" className="absolute right-0 bottom-full mb-2 w-52 rounded-ui border border-chrome-border bg-surface p-1 shadow-chrome">
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={(e) => {
              blurAfter(e)
              setOpen(false)
              zoomControls()?.fit()
            }}
          >
            显示全部便利贴
            <span className="text-[11.5px] text-ink-faint">Shift 1</span>
          </button>
          <div className="mx-2 my-1 h-px bg-chrome-border" />
          {PRESETS.map((z) => (
            <button
              key={z}
              type="button"
              role="menuitemradio"
              aria-checked={Math.abs(zoom - z) < 0.005}
              className={`${item} aria-checked:font-medium`}
              onClick={(e) => {
                blurAfter(e)
                setOpen(false)
                zoomControls()?.zoomTo(z)
              }}
            >
              {formatZoom(z)}
              {z === 1 && <span className="text-[11.5px] font-normal text-ink-faint">{MOD} 0</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
