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
