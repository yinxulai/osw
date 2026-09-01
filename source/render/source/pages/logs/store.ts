import { create } from 'zustand'
import type { LogEntry } from '@common/schemas'

export type LevelFilter = 'all' | LogEntry['level']

interface LogsUiState {
  live: boolean
  levelFilter: LevelFilter
  searchText: string
  page: number
  setLive: (value: boolean | ((current: boolean) => boolean)) => void
  setLevelFilter: (level: LevelFilter) => void
  setSearchText: (text: string) => void
  setPage: (page: number) => void
}

export const useLogsUiStore = create<LogsUiState>(set => ({
  live: true,
  levelFilter: 'all',
  searchText: '',
  page: 1,
  setLive: value => set(state => ({ live: typeof value === 'function' ? value(state.live) : value })),
  setLevelFilter: levelFilter => set({ levelFilter, page: 1 }),
  setSearchText: searchText => set({ searchText, page: 1 }),
  setPage: page => set({ page }),
}))
