import { useRef, useState } from 'react'
import { applyPopupSize, currentPopupSize, POPUP } from './popupSize'

/**
 * 浮窗左下角的拖拽把手。Chrome 插件浮窗本身不能拖边调整大小，
 * 这里通过改变页面尺寸让浮窗跟着变，松手后记住大小；双击恢复默认大小。
 *
 * 浮窗挂在工具栏图标下方、右边缘对齐图标，变宽时向左延伸，
 * 所以把手放在左下角：往左拖变宽，往下拖变高。
 */
export function PopupResizeGrip() {
  const start = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const [active, setActive] = useState(false)
  const [label, setLabel] = useState<string | null>(null)

  return (
    <div
      role="separator"
      aria-label="拖动调整浮窗大小，双击恢复默认"
      title="拖动调整浮窗大小，双击恢复默认"
      className="fixed bottom-1 left-1 z-[9500] grid size-6 cursor-nesw-resize place-items-center rounded-md text-ink-muted transition-colors hover:bg-chrome-hover hover:text-ink"
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        const s = currentPopupSize()
        // 用屏幕坐标：拖动过程中浮窗本身在变，页面内坐标不稳定
        start.current = { x: e.screenX, y: e.screenY, w: document.body.offsetWidth || s.w, h: document.body.offsetHeight || s.h }
        setActive(true)
      }}
      onPointerMove={(e) => {
        const st = start.current
        if (!st) return
        const s = applyPopupSize(st.w - (e.screenX - st.x), st.h + (e.screenY - st.y), false)
        setLabel(`${s.w} × ${s.h}`)
      }}
      onPointerUp={(e) => {
        const st = start.current
        if (!st) return
        applyPopupSize(st.w - (e.screenX - st.x), st.h + (e.screenY - st.y), true)
        start.current = null
        setActive(false)
        setLabel(null)
      }}
      onPointerCancel={() => {
        start.current = null
        setActive(false)
        setLabel(null)
      }}
      onDoubleClick={() => applyPopupSize(POPUP.default.w, POPUP.default.h, true)}
    >
      <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden>
        <path d="M1 2l7 7M1 5.5L4.5 9" />
      </svg>
      {active && label && (
        <span className="pointer-events-none absolute bottom-6 left-2 rounded-md border border-chrome-border bg-chrome px-1.5 py-0.5 text-[11px] whitespace-nowrap text-ink-muted shadow-chrome tabular-nums">
          {label}
        </span>
      )}
    </div>
  )
}
