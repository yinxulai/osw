import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PageKey, ThemeMode } from '@/components/app-sidebar'

interface AppUiState {
  activePage: PageKey
  themeMode: ThemeMode
  setActivePage: (page: PageKey) => void
  setThemeMode: (mode: ThemeMode) => void
}

export const useAppUiStore = create<AppUiState>()(persist(
  set => ({
    activePage: 'queue',
    themeMode: 'system',
    setActivePage: activePage => set({ activePage }),
    setThemeMode: themeMode => set({ themeMode }),
  }),
  { name: 'one-switch-ui' },
))
