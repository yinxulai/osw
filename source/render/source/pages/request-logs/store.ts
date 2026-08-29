import { create } from 'zustand'
import type { RequestLogFilter } from './service'

const initialFilter: RequestLogFilter = {
  providerId: 'all',
  providerModelId: 'all',
  logicalModelId: 'all',
  clientProtocol: 'all',
  status: 'all',
  createdTimeFrom: null,
  createdTimeTo: null,
}

interface RequestLogsUiState {
  page: number
  expandedId: string | null
  filter: RequestLogFilter
  setPage: (page: number) => void
  setExpandedId: (id: string | null) => void
  setFilter: (filter: Partial<RequestLogFilter>) => void
}

export const useRequestLogsUiStore = create<RequestLogsUiState>((set) => ({
  page: 1,
  expandedId: null,
  filter: initialFilter,
  setPage: (page) => set({ page }),
  setExpandedId: (expandedId) => set({ expandedId }),
  setFilter: (filter) => set((state) => ({ page: 1, filter: { ...state.filter, ...filter } })),
}))
