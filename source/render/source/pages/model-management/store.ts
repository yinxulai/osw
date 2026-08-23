import { create } from 'zustand'

interface ModelManagementUiState {
  selectedProviderId: string
  setSelectedProviderId: (id: string) => void
}

export const useModelManagementUiStore = create<ModelManagementUiState>(set => ({
  selectedProviderId: '',
  setSelectedProviderId: selectedProviderId => set({ selectedProviderId }),
}))
