import { create } from 'zustand'
import type { LogEntry, LogScope } from '@common/schemas'

export type LevelFilter = 'all' | LogEntry['level']
export type ScopeFilter = 'all' | LogScope

interface LogsUiState {
  live: boolean
  levelFilter: LevelFilter
  /**
   * 当前看哪个模块的日志。
   *
   * **默认 `proxy`**：绝大多数日志是代理请求产生的，用户来这一页通常就是想看它们；
   * 其它模块（启动、数据库、桌面宿主）在需要排障时再手动选。默认值是产品决定，不是
   * 「没选」的占位——所以这里没有把它当 `all`，要看全部模块得显式选「全部模块」。
   */
  scopeFilter: ScopeFilter
  searchText: string
  page: number
  setLive: (value: boolean | ((current: boolean) => boolean)) => void
  setLevelFilter: (level: LevelFilter) => void
  setScopeFilter: (scope: ScopeFilter) => void
  setSearchText: (text: string) => void
  setPage: (page: number) => void
}

export const useLogsUiStore = create<LogsUiState>(set => ({
  live: true,
  levelFilter: 'all',
  scopeFilter: 'proxy',
  searchText: '',
  page: 1,
  setLive: value => set(state => ({ live: typeof value === 'function' ? value(state.live) : value })),
  setLevelFilter: levelFilter => set({ levelFilter, page: 1 }),
  setScopeFilter: scopeFilter => set({ scopeFilter, page: 1 }),
  setSearchText: searchText => set({ searchText, page: 1 }),
  setPage: page => set({ page }),
}))
