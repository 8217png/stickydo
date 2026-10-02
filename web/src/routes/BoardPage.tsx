import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ShortcutSheet } from '../components/ShortcutSheet'
import { TopBar } from '../components/TopBar'
import { Whiteboard } from '../features/notes/Whiteboard'
import { useBoardShortcuts } from '../features/notes/useBoardShortcuts'
import { PopupResizeGrip } from '../extension/PopupResizeGrip'
import { trackStandaloneWindowBounds } from '../extension/standaloneWindow'
import { surface } from '../extension/surface'
import { closeCommandUI } from '../features/capture/state'
import { Sidebar } from '../components/Sidebar'
import { LoadBoundary } from '../components/LoadBoundary'
import { TodoView } from '../features/todos/TodoView'
import { TrashView } from '../features/trash/TrashView'
import { toggleSidebar, useBoardLayout, useView } from '../features/view'
import { NoteList } from '../features/notes/NoteList'
import { LayoutToggle } from '../components/LayoutToggle'
import { useNotes } from '../features/notes/store'
import { loadNoteEditor } from '../features/notes/StickyNote'

// 快速记录（含解析器）和命令面板（cmdk）单独打包：首屏之后立刻在后台加载，不阻塞白板显示
const QuickCapture = lazy(() => import('../features/capture/QuickCapture').then((m) => ({ default: m.QuickCapture })))
const CommandPalette = lazy(() => import('../features/capture/CommandPalette').then((m) => ({ default: m.CommandPalette })))

/** 主页面：侧边栏 + 白板或待办列表。快捷键只在这一页生效 */
export function BoardPage() {
  const view = useView((s) => s.view)
  const layout = useBoardLayout((s) => s.layout)
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
  // 白板显示出来之后，空闲时预先加载编辑器，第一次双击编辑不用等
  useEffect(() => {
    if (!hydrated) return
    const preload = () => void loadNoteEditor()
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(preload, { timeout: 2000 })
      return () => cancelIdleCallback(id)
    }
    const t = setTimeout(preload, 500)
    return () => clearTimeout(t)
  }, [hydrated])

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="relative h-full min-w-0 flex-1">
        <TopBar onHelp={toggleHelp} />
        {view.kind === 'trash' ? (
          <TrashView />
        ) : view.kind !== 'board' ? (
          <TodoView view={view} />
        ) : layout === 'list' ? (
          <NoteList boardId={boardId} />
        ) : (
          <Whiteboard boardId={boardId} />
        )}
        {view.kind === 'board' && <LayoutToggle />}
      </main>
      <ShortcutSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
      <LoadBoundary>
        <Suspense fallback={null}>
          <QuickCapture />
          <CommandPalette onHelp={toggleHelp} />
        </Suspense>
      </LoadBoundary>
      {surface === 'ext-popup' && <PopupResizeGrip />}
    </div>
  )
}
