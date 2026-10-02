import { useEffect } from 'react'
import { NOTE_COLORS } from '../../design/colors'
import { deleteWithUndo, stepNoteSize } from './actions'
import { readingOrder } from './layout'
import { docFromText, hasMarkdownTable, loadMarkdown } from './doc'
import { useNotes, visibleNotes } from './store'
import { nextNotePosition, scrollNoteIntoView } from './viewport'
import { closePalette, openCapture, openPalette, useCommandUI } from '../capture/state'
import { toggleBoardLayout, toggleSidebar, useBoardLayout, useView } from '../view'

/** 焦点在输入框/编辑器里，或输入法正在组字时，单键快捷键不生效（docs/frontend-design.md §2.4） */
function isTyping(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return true
  const t = e.target as HTMLElement | null
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
}

export function useBoardShortcuts(opts: { toggleHelp: () => void; closeOverlays: () => boolean }) {
  const { toggleHelp, closeOverlays } = opts

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const key = e.key
      // Ctrl/⌘+K：命令面板。在编辑便利贴时也能用；面板自己处理再按一次关闭
      if (mod && !e.shiftKey && !e.altKey && key.toLowerCase() === 'k' && !e.isComposing) {
        e.preventDefault()
        // 面板已经开着（焦点还没进到面板里时，面板自己收不到这次按键）：关闭
        if (useCommandUI.getState().paletteOpen) {
          closePalette()
          return
        }
        ;(document.activeElement as HTMLElement | null)?.blur?.()
        openPalette()
        return
      }
      if (isTyping(e)) return
      const s = useNotes.getState()

      if (mod && key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
        return
      }
      if (mod && key.toLowerCase() === 'y') {
        e.preventDefault()
        s.redo()
        return
      }
      if (mod || e.altKey) return

      if (key === '?') {
        e.preventDefault()
        toggleHelp()
        return
      }
      if (key === 'Escape') {
        if (!closeOverlays()) s.select(null)
        return
      }
      // [：收起或展开侧边栏（专注模式）
      if (key === '[') {
        e.preventDefault()
        toggleSidebar()
        return
      }
      // Q：快速记录；T：快速记录一条待办（预填 “[] ”）
      if (key === 'q' || key === 'Q') {
        e.preventDefault()
        openCapture()
        return
      }
      if (key === 't' || key === 'T') {
        e.preventDefault()
        openCapture('[] ')
        return
      }
      // 下面这些只在白板上有意义
      if (useView.getState().view.kind !== 'board') return

      // V：白板 / 列表
      if (key === 'v' || key === 'V') {
        e.preventDefault()
        toggleBoardLayout()
        return
      }
      if (key === 'n' || key === 'N') {
        e.preventDefault()
        const id = s.create(nextNotePosition())
        s.setEditing(id)
        return
      }

      if ((key === '-' || key === '=' || key === '+') && useBoardLayout.getState().layout === 'board') {
        // 全局：统一所有便利贴的大小并自动排列
        e.preventDefault()
        stepNoteSize(key === '-' ? -1 : 1)
        return
      }

      const nav = { j: 1, ArrowDown: 1, ArrowRight: 1, k: -1, ArrowUp: -1, ArrowLeft: -1 }[key]
      if (nav) {
        const notes = visibleNotes()
        if (notes.length === 0) return
        e.preventDefault()
        const order = readingOrder(notes)
        const i = order.findIndex((n) => n.id === s.selectedId)
        const next = i === -1 ? (nav > 0 ? 0 : order.length - 1) : (i + nav + order.length) % order.length
        s.select(order[next].id)
        scrollNoteIntoView(order[next].id)
        return
      }

      const sel = s.selectedId
      if (!sel) return

      if (/^[1-8]$/.test(key)) {
        const color = NOTE_COLORS[Number(key) - 1].key
        const note = s.notes.find((n) => n.id === sel)
        if (note && note.color !== color) s.update(sel, { color })
        return
      }
      if (key === 'Delete' || key === 'Backspace') {
        e.preventDefault()
        // 删除后焦点移到阅读顺序中的下一张，方便连续操作
        const order = readingOrder(visibleNotes())
        const i = order.findIndex((n) => n.id === sel)
        const next = order[i + 1] ?? order[i - 1]
        deleteWithUndo(sel)
        if (next) useNotes.getState().select(next.id)
        return
      }
      if (key === 'e' || key === 'E' || key === 'Enter') {
        e.preventDefault()
        s.bringToFront(sel)
        s.setEditing(sel)
      }
    }

    // 白板上粘贴文字 → 直接生成便利贴（docs/frontend-design.md §2.1）
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName))) return
      const text = e.clipboardData?.getData('text/plain')?.trim()
      if (!text) return
      e.preventDefault()
      const pos = nextNotePosition()
      const clipped = text.slice(0, 5000)
      // 带 Markdown 表格的文字按 Markdown 解析（转换器按需加载），其余原样保存
      if (hasMarkdownTable(clipped)) {
        loadMarkdown()
          .then((toDoc) => toDoc(clipped))
          .catch(() => docFromText(clipped))
          .then((content) => useNotes.getState().create({ ...pos, content }))
      } else useNotes.getState().create({ ...pos, content: docFromText(clipped) })
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('paste', onPaste)
    }
  }, [toggleHelp, closeOverlays])
}
