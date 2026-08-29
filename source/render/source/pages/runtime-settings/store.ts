import { create } from 'zustand'
import type { Settings } from '@common/schemas'

interface RuntimeSettingsUiState {
  draft: Settings | null
  baseline: Settings | null
  saved: boolean
  isDirty: boolean
  hydrate: (settings: Settings) => void
  updateField: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  setSaved: (saved: boolean) => void
}

export const useRuntimeSettingsUiStore = create<RuntimeSettingsUiState>(set => ({
  draft: null,
  baseline: null,
  saved: false,
  isDirty: false,
  hydrate: settings => set({ draft: settings, baseline: settings, isDirty: false }),
  updateField: (key, value) => set(state => {
    if (!state.draft) return state
    const draft = { ...state.draft, [key]: value }
    return {
      draft,
      saved: false,
      isDirty: state.baseline ? JSON.stringify(draft) !== JSON.stringify(state.baseline) : true,
    }
  }),
  setSaved: saved => set({ saved }),
}))
