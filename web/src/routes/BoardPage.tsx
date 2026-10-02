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
import { Sidebar } from '../components/Sidebar'
import { TodoView } from '../features/todos/TodoView'
import { toggleSidebar, useView } from '../features/view'
import { useNotes } from '../features/notes/store'

/** 主页面：侧边栏 + 白板或待办列表。快捷键只在这一页生效 */
export function BoardPage() {
  const view = useView((s) => s.view)
  const boards = useNotes((s) => s.boards)
  const hydrated = useNotes((s) => s.hydrated)
  // 看板在别处被删掉了：回到收件箱
  const boardId = view.kind === 'board' && view.boardId && (!hydrated || boards.some((b) => b.id === view.boardId)) ? view.boardId : null
  const [helpOpen, setHelpOpen] = useState(false)
  const toggleHelp = useCallback(() => setHelpOpen((o) => !o), [])
  const helpOpenRef = useRef(helpOpen)
  helpOpenRef.current = helpOpen
  const closeOverlays = useCallback(() => {
    if (closeCommandUI()) return true
    // 窄屏的侧边栏抽屉
    if (useView.getState().sidebarOpen && window.innerWidth < 900) {
      toggleSidebar(false)
      return true
    }
    if (!helpOpenRef.current) return false
    setHelpOpen(false)
    return true
  }, [])
  useBoardShortcuts({ toggleHelp, closeOverlays })
  useEffect(() => {
    if (surface === 'ext-window') void trackStandaloneWindowBounds()
  }, [])

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="relative h-full min-w-0 flex-1">
        <TopBar onHelp={toggleHelp} />
        {view.kind === 'board' ? <Whiteboard boardId={boardId} /> : <TodoView view={view} />}
      </main>
      <ShortcutSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
      <QuickCapture />
      <CommandPalette onHelp={toggleHelp} />
      {surface === 'ext-popup' && <PopupResizeGrip />}
    </div>
  )
}
