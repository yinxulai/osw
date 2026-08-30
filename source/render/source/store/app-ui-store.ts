import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PageKey, ThemeMode } from '@/components/app-sidebar'

interface AppUiState {
  activePage: PageKey
  overviewProviderId: string | null
  themeMode: ThemeMode
  setActivePage: (page: PageKey) => void
  setOverviewProviderId: (providerId: string | null) => void
  setThemeMode: (mode: ThemeMode) => void
}

export const useAppUiStore = create<AppUiState>()(persist(
  set => ({
    activePage: 'queue',
    overviewProviderId: null,
    themeMode: 'system',
    setActivePage: activePage => set({ activePage }),
    setOverviewProviderId: overviewProviderId => set({ overviewProviderId }),
    setThemeMode: themeMode => set({ themeMode }),
  }),
  {
    name: 'one-switch-ui',
    partialize: state => ({ activePage: state.activePage, themeMode: state.themeMode }),
  },
))
