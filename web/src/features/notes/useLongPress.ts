import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { flushSync } from 'react-dom'

/** 长按多久触发（毫秒） */
export const LONG_PRESS_MS = 2000
/** 按住期间允许的手抖距离（像素）；移动超过这个距离算拖动，不再触发。手指比鼠标抖得多 */
const MOVE_TOLERANCE = { mouse: 5, touch: 10 }

/** 这些元素上按住不算长按：操作栏、复选框、链接、按钮等有自己的作用 */
const IGNORE = '.no-drag, input, textarea, button, a, select, [contenteditable="true"]'

/**
 * 长按：按住不动超过 LONG_PRESS_MS 触发 onLongPress（docs/frontend-design.md §2.2，长按便利贴等同于双击进入编辑）。
 * 只认主键（鼠标左键、触屏、触控笔）；移动、松开、取消都会中止。
 *
 * - 鼠标：时间一到立即触发。
 * - 触屏：时间一到先进入“已就绪”（armed，界面给出提示），手指松开时才触发——
 *   iOS 只在用户手势（松开手指）里允许弹出键盘，所以要在 touchend 里同步进入编辑并聚焦。
 *   触屏的移动和松开用 touch 事件跟踪：iOS 判断手指在动时会发 pointercancel，
 *   但触摸本身还在继续，不能因此中止。
 * 移动和松开在 window 上监听：拖动便利贴时指针可能离开元素，也不和 react-rnd 的拖动抢事件。
 */
export function useLongPress(onLongPress: () => void, enabled = true) {
  const cleanup = useRef<(() => void) | null>(null)
  const callback = useRef(onLongPress)
  callback.current = onLongPress
  const [armed, setArmed] = useState(false)

  // 卸载或停用时取消进行中的计时
  useEffect(() => {
    if (!enabled) cleanup.current?.()
    return () => cleanup.current?.()
  }, [enabled])

  const onPointerDown = (e: ReactPointerEvent) => {
    cleanup.current?.()
    if (!enabled || e.button !== 0 || !e.isPrimary) return
    if (e.target instanceof Element && e.target.closest(IGNORE)) return

    const touch = e.pointerType !== 'mouse'
    const tolerance = touch ? MOVE_TOLERANCE.touch : MOVE_TOLERANCE.mouse
    const startX = e.clientX
    const startY = e.clientY
    const pointerId = e.pointerId
    let ready = false
    const moved = (x: number, y: number) => Math.hypot(x - startX, y - startY) > tolerance

    const timer = setTimeout(() => {
      if (!touch) {
        stop()
        callback.current()
        return
      }
      ready = true
      setArmed(true)
    }, LONG_PRESS_MS)

    // 鼠标、触控笔：指针事件
    const onPointerMove = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId && moved(ev.clientX, ev.clientY)) stop()
    }
    const onPointerEnd = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) finish()
    }
    // 触屏：touch 事件（不受 pointercancel 影响）
    const onTouchMove = (ev: TouchEvent) => {
      const t = ev.touches[0]
      if (ev.touches.length > 1 || (t && moved(t.clientX, t.clientY))) stop()
    }
    const onTouchEnd = (ev: TouchEvent) => {
      if (ev.touches.length === 0) finish()
    }

    /** 松开：已就绪就触发（在这次手势里同步渲染，编辑器的输入框才能拿到焦点、弹出键盘） */
    function finish() {
      const fire = ready
      stop()
      if (fire) flushSync(() => callback.current())
    }
    function stop() {
      clearTimeout(timer)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerEnd)
      window.removeEventListener('pointercancel', onPointerEnd)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', stop)
      window.removeEventListener('blur', stop)
      if (ready) setArmed(false)
      ready = false
      cleanup.current = null
    }

    if (touch && e.pointerType === 'touch') {
      window.addEventListener('touchmove', onTouchMove, { passive: true })
      window.addEventListener('touchend', onTouchEnd)
      window.addEventListener('touchcancel', stop)
    } else {
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerEnd)
      window.addEventListener('pointercancel', onPointerEnd)
    }
    // 按住时切换了窗口，收不到松开事件
    window.addEventListener('blur', stop)
    cleanup.current = stop
  }

  return { onPointerDown, armed }
}
