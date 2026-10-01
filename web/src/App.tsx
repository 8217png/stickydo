import { useCallback, useEffect, useRef, useState } from 'react'
import { MotionConfig } from 'motion/react'
import { Toaster } from 'sonner'
import { ShortcutSheet } from './components/ShortcutSheet'
import { TopBar } from './components/TopBar'
import { Whiteboard } from './features/notes/Whiteboard'
import { useBoardShortcuts } from './features/notes/useBoardShortcuts'
import { useSettings } from './features/settings'

function useResolvedTheme() {
  const pref = useSettings((s) => s.theme)
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const theme = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
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
