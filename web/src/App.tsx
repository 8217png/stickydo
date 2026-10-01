import { useCallback, useEffect, useRef, useState } from 'react'
import { MotionConfig } from 'motion/react'
import { Toaster } from 'sonner'
import { ShortcutSheet } from './components/ShortcutSheet'
import { TopBar } from './components/TopBar'
import { Whiteboard } from './features/notes/Whiteboard'
import { useBoardShortcuts } from './features/notes/useBoardShortcuts'
import { useSettings } from './features/settings'

// 嵌入时宿主页面在根元素上设置的主题（我们自己的显式选择不算）
const initialTheme =
  useSettings.getState().theme === 'system' ? document.documentElement.dataset.theme : undefined

function useResolvedTheme() {
  const pref = useSettings((s) => s.theme)
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const systemTheme = initialTheme === 'light' || initialTheme === 'dark' ? initialTheme : systemDark ? 'dark' : 'light'
  const theme = pref === 'system' ? systemTheme : pref
  useEffect(() => {
    // 跟随系统时不写死属性，交给 CSS 的 prefers-color-scheme
    const root = document.documentElement
    if (pref !== 'system') root.dataset.theme = pref
    else if (initialTheme === 'light' || initialTheme === 'dark') root.dataset.theme = initialTheme
    else delete root.dataset.theme
  }, [pref])
  return theme
}

export default function App() {
  const theme = useResolvedTheme()
  const [helpOpen, setHelpOpen] = useState(false)
  const toggleHelp = useCallback(() => setHelpOpen((o) => !o), [])
  const helpOpenRef = useRef(helpOpen)
  helpOpenRef.current = helpOpen
  const closeOverlays = useCallback(() => {
    if (!helpOpenRef.current) return false
    setHelpOpen(false)
    return true
  }, [])
  useBoardShortcuts({ toggleHelp, closeOverlays })

  return (
    // 遵循系统的“减少动态效果”设置
    <MotionConfig reducedMotion="user">
      <div className="relative h-full">
        <TopBar onHelp={toggleHelp} />
        <Whiteboard />
        <ShortcutSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
        <Toaster
          theme={theme}
          position="bottom-center"
          toastOptions={{
            style: {
              background: 'var(--chrome-bg)',
              color: 'var(--ink)',
              border: '1px solid var(--chrome-border)',
              backdropFilter: 'blur(12px)',
              fontFamily: 'var(--font-ui)',
            },
          }}
        />
      </div>
    </MotionConfig>
  )
}
