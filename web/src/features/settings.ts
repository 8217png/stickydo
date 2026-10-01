import { create } from 'zustand'
import { load, save } from '../lib/storage'

export type ThemePref = 'system' | 'light' | 'dark'

interface SettingsState {
  theme: ThemePref
  tilt: boolean
  setTheme: (t: ThemePref) => void
  setTilt: (on: boolean) => void
}

export const useSettings = create<SettingsState>()((set) => ({
  theme: load<ThemePref>('stickydo.theme') ?? 'system',
  tilt: load<boolean>('stickydo.tilt') ?? true,
  setTheme: (theme) => {
    save('stickydo.theme', theme)
    set({ theme })
  },
  setTilt: (tilt) => {
    save('stickydo.tilt', tilt)
    set({ tilt })
  },
}))
