import { create } from 'zustand'
import type { Settings } from '@common/schemas'

interface RuntimeSettingsUiState {
  draft: Settings | null
  saved: boolean
  hydrate: (settings: Settings) => void
  updateField: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  setSaved: (saved: boolean) => void
}

export const useRuntimeSettingsUiStore = create<RuntimeSettingsUiState>(set => ({
  draft: null,
  saved: false,
  hydrate: draft => set({ draft }),
  updateField: (key, value) => set(state => ({ draft: state.draft ? { ...state.draft, [key]: value } : null })),
  setSaved: saved => set({ saved }),
}))
