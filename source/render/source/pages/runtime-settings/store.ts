import { create } from 'zustand'
import type { Settings } from '@common/schemas'

interface RuntimeSettingsUiState {
  draft: Settings | null
  baseline: Settings | null
  saved: boolean
  isDirty: boolean
  hydrate: (settings: Settings) => void
  updateField: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  resetDraft: () => void
  setSaved: (saved: boolean) => void
}

export const useRuntimeSettingsUiStore = create<RuntimeSettingsUiState>(set => ({
  draft: null,
  baseline: null,
  saved: false,
  isDirty: false,
  hydrate: settings => set({ draft: settings, baseline: settings, saved: false, isDirty: false }),
  updateField: (key, value) => set(state => {
    if (!state.draft) return state
    const draft = { ...state.draft, [key]: value }
    return {
      draft,
      saved: false,
      isDirty: state.baseline ? JSON.stringify(draft) !== JSON.stringify(state.baseline) : true,
    }
  }),
  resetDraft: () => set(state => state.baseline
    ? { draft: state.baseline, saved: false, isDirty: false }
    : state),
  setSaved: saved => set({ saved }),
}))
