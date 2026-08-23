import { create } from 'zustand'
import type { LogEntry } from '@common/schemas'

export type LevelFilter = 'all' | LogEntry['level']

interface LogsUiState {
  live: boolean
  levelFilter: LevelFilter
  searchText: string
  setLive: (value: boolean | ((current: boolean) => boolean)) => void
  setLevelFilter: (level: LevelFilter) => void
  setSearchText: (text: string) => void
}

export const useLogsUiStore = create<LogsUiState>(set => ({
  live: true,
  levelFilter: 'all',
  searchText: '',
  setLive: value => set(state => ({ live: typeof value === 'function' ? value(state.live) : value })),
  setLevelFilter: levelFilter => set({ levelFilter }),
  setSearchText: searchText => set({ searchText }),
}))
