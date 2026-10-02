import { useCallback, useEffect, useRef, useState } from 'react'
import { ShortcutSheet } from '../components/ShortcutSheet'
import { TopBar } from '../components/TopBar'
import { Whiteboard } from '../features/notes/Whiteboard'
import { useBoardShortcuts } from '../features/notes/useBoardShortcuts'
import { PopupResizeGrip } from '../extension/PopupResizeGrip'
import { trackStandaloneWindowBounds } from '../extension/standaloneWindow'
import { surface } from '../extension/surface'
import { QuickCapture } from '../features/capture/QuickCapture'
import { CommandPalette } from '../features/capture/CommandPalette'
import { closeCommandUI } from '../features/capture/state'

/** 白板页：快捷键只在这一页生效 */
export function BoardPage() {
  const [helpOpen, setHelpOpen] = useState(false)
  const toggleHelp = useCallback(() => setHelpOpen((o) => !o), [])
  const helpOpenRef = useRef(helpOpen)
  helpOpenRef.current = helpOpen
  const closeOverlays = useCallback(() => {
    if (closeCommandUI()) return true
    if (!helpOpenRef.current) return false
    setHelpOpen(false)
    return true
  }, [])
  useBoardShortcuts({ toggleHelp, closeOverlays })
  useEffect(() => {
    if (surface === 'ext-window') void trackStandaloneWindowBounds()
  }, [])

  return (
    <div className="relative h-full">
      <TopBar onHelp={toggleHelp} />
      <Whiteboard />
      <ShortcutSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
      <QuickCapture />
      <CommandPalette onHelp={toggleHelp} />
      {surface === 'ext-popup' && <PopupResizeGrip />}
    </div>
  )
}
