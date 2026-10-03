import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { create } from 'zustand'
import { arrangeNotes } from '../features/notes/actions'
import { visibleNotes } from '../features/notes/store'

/** 确认框开着没有：命令面板里选“重新排列”也打开同一个确认框 */
const useArrangeConfirm = create<{ open: boolean }>(() => ({ open: false }))
export const openArrangeConfirm = () => useArrangeConfirm.setState({ open: true })
const close = () => useArrangeConfirm.setState({ open: false })

/**
 * 顶栏的“重新排列”：先在按钮下方弹出确认（排列会打乱手动摆放的位置），确认后才排列。
 * 大小不变；排列后提示条和 Ctrl+Z 都可以撤销。Enter 确认、Esc 或点别处取消。
 */
export function ArrangeButton() {
  const open = useArrangeConfirm((s) => s.open)
  const ref = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const count = open ? visibleNotes().length : 0

  useEffect(() => {
    if (!open) return
    confirmRef.current?.focus()
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    // 在捕获阶段接住 Esc / Enter：Enter 在白板上是“编辑选中的便利贴”，不能让它先处理
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Enter') return
      if (e.key === 'Enter' && document.activeElement !== confirmRef.current) return
      e.preventDefault()
      e.stopPropagation()
      close()
      if (e.key === 'Enter') arrangeNotes()
    }
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', esc, true)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="重新排列便利贴（大小不变）"
        aria-label="重新排列便利贴"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => {
          if (e.detail > 0) e.currentTarget.blur()
          useArrangeConfirm.setState({ open: !open })
        }}
        className="grid size-8 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-chrome-hover hover:text-ink aria-expanded:bg-chrome-hover aria-expanded:text-ink"
      >
        {/* 大小不一的几张便利贴排成两行 */}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="2" y="2" width="5" height="6" rx="1" />
          <rect x="9" y="2" width="5" height="4" rx="1" />
          <rect x="2" y="10" width="4" height="4" rx="1" />
          <rect x="8" y="10" width="6" height="4" rx="1" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="重新排列便利贴"
            className="absolute top-10 right-0 z-10 w-64 rounded-ui border border-chrome-border bg-surface p-3 shadow-chrome"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            <p className="text-[13.5px] font-medium text-ink">
              {count ? `重新排列这块白板的 ${count} 张便利贴？` : '这块白板上还没有便利贴'}
            </p>
            {count > 0 && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">按从上到下、从左到右的顺序排整齐，大小不变。之后可以撤销。</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="h-8 rounded-lg px-3 text-[13px] text-ink-muted transition-colors hover:bg-chrome-hover hover:text-ink"
                onClick={close}
              >
                取消
              </button>
              {count > 0 && (
                <button
                  ref={confirmRef}
                  type="button"
                  className="h-8 rounded-lg bg-ink px-3 text-[13px] font-medium text-surface transition-opacity hover:opacity-90"
                  onClick={() => {
                    close()
                    arrangeNotes()
                  }}
                >
                  重新排列
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
