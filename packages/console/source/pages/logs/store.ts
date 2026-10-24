import type { LogEntry, LogScope } from '@common/schemas'
import { createPageScratchStore } from '@/store/page-scratch'

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

/**
 * 这一页记进草稿的只有两项：筛哪个级别、看哪个模块。
 *
 * `live` 不进草稿——它是「要不要跟着滚」，不是「我在看什么」。静默重载（自动更新后
 * 重进）之后留着一个关掉的实时流，界面上只有一个小圆点变了色，用户会以为日志不再更新。
 *
 * `searchText` 不进草稿：这一页的搜索词由路由的 `q` 决定（从请求记录跳过来时会带着
 * 请求 id），挂载时会被路由值覆盖，存下来只会在下一次挂载时被立刻擦掉。
 *
 * `page` 也不进：`useLogsModel` 挂载时按路由复位搜索词，而改搜索词按定义要回第一页
 * （见下面的 `setSearchText`），所以这一页的页码每次进来都是 1。声明一个必然被擦掉的
 * 字段只会让人以为它有用。
 */
type PersistedLogsScratch = Pick<LogsUiState, 'levelFilter' | 'scopeFilter'>

const scratch = createPageScratchStore<LogsUiState, PersistedLogsScratch>({
  page: 'logs',
  create: set => ({
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
  }),
  pick: state => ({ levelFilter: state.levelFilter, scopeFilter: state.scopeFilter }),
  defaults: { levelFilter: 'all', scopeFilter: 'proxy' },
})

export const useLogsUiStore = scratch.store
/** 丢掉这一页记下的筛选与页码（测试复位、以及「重新看一遍」时用）。 */
export const resetLogsScratch = scratch.reset
