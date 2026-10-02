import { useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

/** 长按多久触发（毫秒） */
export const LONG_PRESS_MS = 2000
/** 按住期间允许的手抖距离（像素）；移动超过这个距离算拖动，不再触发 */
const MOVE_TOLERANCE = 5

/** 这些元素上按住不算长按：操作栏、复选框、链接、按钮等有自己的作用 */
const IGNORE = '.no-drag, input, textarea, button, a, select, [contenteditable="true"]'

/**
 * 长按：按住不动超过 LONG_PRESS_MS 触发 onLongPress（docs/frontend-design.md §2.2，长按便利贴等同于双击进入编辑）。
 * 只认主键（鼠标左键、触屏、触控笔）；移动、松开、取消都会中止。
 * 移动和松开在 window 上监听：拖动便利贴时指针可能离开元素，也不和 react-rnd 的拖动抢事件。
 */
export function useLongPress(onLongPress: () => void, enabled = true) {
  const cleanup = useRef<(() => void) | null>(null)
  const callback = useRef(onLongPress)
  callback.current = onLongPress

  // 卸载或停用时取消进行中的计时
  useEffect(() => {
    if (!enabled) cleanup.current?.()
    return () => cleanup.current?.()
  }, [enabled])

  const onPointerDown = (e: ReactPointerEvent) => {
    cleanup.current?.()
    if (!enabled || e.button !== 0 || !e.isPrimary) return
    if (e.target instanceof Element && e.target.closest(IGNORE)) return

    const startX = e.clientX
    const startY = e.clientY
    const pointerId = e.pointerId
    const timer = setTimeout(() => {
      stop()
      callback.current()
    }, LONG_PRESS_MS)

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > MOVE_TOLERANCE) stop()
    }
    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) stop()
    }
    function stop() {
      clearTimeout(timer)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      window.removeEventListener('blur', stop)
      cleanup.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
    // 按住时切换了窗口，收不到松开事件
    window.addEventListener('blur', stop)
    cleanup.current = stop
  }

  return { onPointerDown }
}
