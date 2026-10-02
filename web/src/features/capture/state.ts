import { create } from 'zustand'

/** 快速记录输入框与命令面板的开关（同一时间最多开一个） */
interface CommandUI {
  captureOpen: boolean
  /** 打开快速记录时预填的文字（例如按 T 时预填 “[] ”） */
  captureText: string
  paletteOpen: boolean
}

export const useCommandUI = create<CommandUI>(() => ({ captureOpen: false, captureText: '', paletteOpen: false }))

export const openCapture = (text = '') => useCommandUI.setState({ captureOpen: true, captureText: text, paletteOpen: false })
export const closeCapture = () => useCommandUI.setState({ captureOpen: false })
export const openPalette = () => useCommandUI.setState({ paletteOpen: true, captureOpen: false })
export const closePalette = () => useCommandUI.setState({ paletteOpen: false })

/** 有任一浮层打开时返回 true 并关掉它（白板上的 Esc 用） */
export function closeCommandUI(): boolean {
  const s = useCommandUI.getState()
  if (!s.captureOpen && !s.paletteOpen) return false
  useCommandUI.setState({ captureOpen: false, paletteOpen: false })
  return true
}
