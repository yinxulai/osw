import type { RequestLogFilter } from './service'
import { createPageScratchStore } from '@/store/page-scratch'

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

/**
 * 这一页记进草稿的那几项：筛什么、翻到第几页、展开的是哪一条。
 *
 * `expandedId` 也记：用户点开一条请求看清楚，再刷新一下页面（自动更新后重进）时
 * 那条应该还开着。真正「不该复活」的是已经在运行设置页改了一半却还没保存的草稿，
 * 那属于服务端事实的草稿，见 `pages/runtime-settings/store.ts`。
 */
type PersistedRequestLogsScratch = Pick<RequestLogsUiState, 'page' | 'expandedId' | 'filter'>

const scratch = createPageScratchStore<RequestLogsUiState, PersistedRequestLogsScratch>({
  page: 'request-logs',
  create: set => ({
    page: 1,
    expandedId: null,
    filter: initialFilter,
    setPage: page => set({ page }),
    setExpandedId: expandedId => set({ expandedId }),
    // 改筛选条件就回第一页，并且把展开的详情收起来：
    // 留着的话详情里讲的是一条已经被新条件筛掉的日志，表格和详情会各说各话。
    setFilter: filter => set(state => ({ page: 1, expandedId: null, filter: { ...state.filter, ...filter } })),
  }),
  pick: state => ({ page: state.page, expandedId: state.expandedId, filter: state.filter }),
  defaults: { page: 1, expandedId: null, filter: initialFilter },
})

export const useRequestLogsUiStore = scratch.store
/** 丢掉这一页记下的筛选、页码与展开项（测试复位、以及「重新看一遍」时用）。 */
export const resetRequestLogsScratch = scratch.reset
