import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ThemeMode } from '@/components/app-sidebar'

interface AppUiState {
  themeMode: ThemeMode
  setThemeMode: (mode: ThemeMode) => void
}

export const useAppUiStore = create<AppUiState>()(persist(
  set => ({
    themeMode: 'system',
    setThemeMode: themeMode => set({ themeMode }),
  }),
  {
    name: 'one-switch-ui',
  },
))
