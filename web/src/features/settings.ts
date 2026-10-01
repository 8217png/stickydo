import { create } from 'zustand'
import { load, save } from '../lib/storage'

export type ThemePref = 'system' | 'light' | 'dark'
export type NoteSizeKey = 's' | 'm' | 'l'

interface SettingsState {
  theme: ThemePref
  tilt: boolean
  /** 全局便利贴尺寸档位：新建便利贴用它，切换时统一所有便利贴并自动排列 */
  noteSize: NoteSizeKey
  setTheme: (t: ThemePref) => void
  setTilt: (on: boolean) => void
  setNoteSize: (size: NoteSizeKey) => void
}

export const useSettings = create<SettingsState>()((set) => ({
  theme: load<ThemePref>('stickydo.theme') ?? 'system',
  tilt: load<boolean>('stickydo.tilt') ?? true,
  noteSize: load<NoteSizeKey>('stickydo.noteSize') ?? 'm',
  setTheme: (theme) => {
    save('stickydo.theme', theme)
    set({ theme })
  },
  setTilt: (tilt) => {
    save('stickydo.tilt', tilt)
    set({ tilt })
  },
  setNoteSize: (noteSize) => {
    save('stickydo.noteSize', noteSize)
    set({ noteSize })
  },
}))

// 其他页面改了设置（主题、倾斜、全局尺寸）时同步过来
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (!e.key?.startsWith('stickydo.') || e.newValue == null) return
    const field = ({ 'stickydo.theme': 'theme', 'stickydo.tilt': 'tilt', 'stickydo.noteSize': 'noteSize' } as const)[e.key]
    if (!field) return
    try {
      useSettings.setState({ [field]: JSON.parse(e.newValue) })
    } catch {
      /* ignore */
    }
  })
}
