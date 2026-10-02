import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { useSession } from '../features/auth/session'

/** 顶栏右侧的账号入口：未登录时是“登录”，登录后是头像菜单。只在 Web 版显示。 */
export function AccountMenu() {
  const user = useSession((s) => s.user)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // 页面加载后确认一下登录状态（会话失效时会自动退出）
  useEffect(() => {
    if (useSession.getState().user) void useSession.getState().reloadUser()
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  if (!user) {
    return (
      <Link
        to="/login"
        className="ml-0.5 inline-flex h-8 items-center rounded-lg px-2.5 text-[13px] font-medium text-ink transition-colors hover:bg-chrome-hover focus-visible:outline-2 focus-visible:outline-focus"
      >
        登录
      </Link>
    )
  }

  const initial = Array.from(user.name.trim() || user.email)[0]?.toUpperCase() ?? '?'

  return (
    <div ref={rootRef} className="relative ml-0.5">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`账号：${user.name}`}
        title={user.email}
        onClick={() => setOpen((o) => !o)}
        className="grid size-8 place-items-center rounded-full text-[13px] font-semibold transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        style={{ background: 'var(--note-lavender)', color: 'var(--note-ink)' }}
      >
        {initial}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            className="absolute top-10 right-0 w-60 overflow-hidden rounded-ui border border-chrome-border bg-surface p-1 shadow-chrome"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.1 } }}
            transition={{ type: 'spring', stiffness: 600, damping: 36 }}
            style={{ transformOrigin: 'top right' }}
          >
            <div className="px-3 pt-2 pb-2.5">
              <div className="truncate text-[13.5px] font-medium text-ink">{user.name}</div>
              <div className="truncate text-[12.5px] text-ink-muted">{user.email}</div>
            </div>
            <div className="mx-1 h-px bg-chrome-border" />
            <button
              type="button"
              role="menuitem"
              autoFocus
              className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-ink transition-colors hover:bg-chrome-hover focus-visible:bg-chrome-hover focus-visible:outline-none"
              onClick={async () => {
                setOpen(false)
                await useSession.getState().logout()
                toast('已退出登录')
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M6 2.5H3.5a1 1 0 00-1 1v9a1 1 0 001 1H6M10.5 11l3-3-3-3M13.5 8H6" />
              </svg>
              退出登录
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
