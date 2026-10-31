import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { unwrap } from '@/api/unwrap'
import { providerModelApi } from '@/api/models'
import { useLiveRequests } from '@/data/live-requests'
import { useDeletedLogicalModelIds, useLogicalModels } from '@/data/logical-models'
import { useProviders } from '@/data/providers'
import { useRequestLogDetailQuery, useRequestLogsQuery } from './queries'
import { buildRequestLogRows, type RequestLogsRow } from './lib/rows'
import { useLiveRowHold } from './hooks/use-live-row-hold'
import { useRequestLogsUiStore } from './store'

export interface RequestLogFilter { providerId: string; providerModelId: string; logicalModelId: string; clientProtocol: string; status: string; createdTimeFrom: number | null; createdTimeTo: number | null }

/**
 * 这个页面的筛选下拉只需要「id + 名字」，因此它缓存的是**接口原始载荷**。
 *
 * 键必须与模型管理页的 `['provider-models']` 分开：那个键里放的是映射成
 * `ProviderModelRoute` 的编辑器数据（还会被乐观写入），两个形状不同、写入方也不同的
 * 数据共用一个缓存键时，谁先挂载谁就决定了对方读到的是什么。
 */
const PROVIDER_MODEL_OPTIONS_KEY = ['provider-model-options'] as const

export function useRequestLogsService() {
  const queryClient = useQueryClient()
  const page = useRequestLogsUiStore(state => state.page)
  const expandedId = useRequestLogsUiStore(state => state.expandedId)
  const filter = useRequestLogsUiStore(state => state.filter)
  const setPage = useRequestLogsUiStore(state => state.setPage)
  const setExpandedId = useRequestLogsUiStore(state => state.setExpandedId)
  const setFilterState = useRequestLogsUiStore(state => state.setFilter)
  const logsQuery = useRequestLogsQuery(filter, page)
  const live = useLiveRequests()
  const logs = logsQuery.data?.logs ?? []
  const liveRequests = live.data ?? []
  /** 台账用 id 做索引；20 条以内没必要为了查找再建一层缓存。 */
  const liveById = useMemo(() => new Map(liveRequests.map(request => [request.id, request])), [liveRequests])
  const statusById = useMemo(() => new Map(logs.map(log => [log.id, log.status])), [logs])
  const filterApplied = Object.values(filter).some(value => value !== 'all' && value !== null)
  /**
   * 这一行此刻还该不该用实时形态——含「落定之后再多留十秒」。
   *
   * 判定规则在 `lib/live-hold.ts`：还在跑、或者刚跑完但还在窗口内、或者用户正展开着它。
   * 展开着就一直留着：用户盯着这把尺子看，把内容换掉等于从他手里抢走。
   */
  const keepLive = useLiveRowHold(liveRequests, expandedId)
  /** 被展开的那一条还用不用实时视图；用就不去读落库的详情（见 `useRequestLogDetailQuery`）。 */
  const expandedExecuting = expandedId === null
    ? false
    : (() => {
      const live = liveById.get(expandedId)
      return live !== undefined && keepLive(live, statusById.get(expandedId))
    })()
  const detailQuery = useRequestLogDetailQuery(expandedId, !expandedExecuting)
  /**
   * 合并后的行。
   *
   * 只有第 1 页且没有筛选时才把「台账里有、库里这一页却没有」的请求补进来：
   * 筛选与翻页是用户明确说出来的范围，补进去的行会绕过它们。
   */
  const rows: RequestLogsRow[] = useMemo(() => buildRequestLogRows({
    logs,
    liveRequests,
    injectLive: page === 1 && !filterApplied,
    keepLive,
  }), [logs, liveRequests, page, filterApplied, keepLive])
  const providers = useProviders()
  const logicalModels = useLogicalModels()
  const providerModelsQuery = useQuery({ queryKey: PROVIDER_MODEL_OPTIONS_KEY, queryFn: () => unwrap(providerModelApi.list()), staleTime: 30_000 })
  const providerNameById = useMemo(() => new Map(providers.map(provider => [provider.id, provider.name])), [providers])
  const providerModelOptions = useMemo(() => {
    const models = providerModelsQuery.data ?? []
    return models
      .map(model => ({ id: model.id, name: `${providerNameById.get(model.providerId) ?? model.providerId} / ${model.modelName}` }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [providerModelsQuery.data, providerNameById])
  // 日志里记的是请求当时的模型名，所以拿**模型 id** 反查展示名；找不到就原样显示那个名字。
  const getModelName = useCallback((modelId: string | null) => modelId === null ? '—' : logicalModels.find(model => model.modelId === modelId)?.modelId ?? modelId, [logicalModels])
  // 名字对不上一条活跃逻辑模型、却对得上一条已删除的——说明这条历史记录指向的配置被删了。
  // 名字照旧展示（记录是历史事实），只补一枚「已删除」标签（见 `DeletedTag`）。
  const deletedLogicalModelIds = useDeletedLogicalModelIds()
  const isModelDeleted = useCallback((modelId: string | null) => modelId !== null && deletedLogicalModelIds.has(modelId), [deletedLogicalModelIds])
  const refresh = useCallback((targetPage = page) => queryClient.invalidateQueries({ queryKey: ['request-logs', filter, targetPage] }), [filter, page, queryClient])
  const setFilter = useCallback((next: Partial<RequestLogFilter>) => { setFilterState(next) }, [setFilterState])
  const goToPage = useCallback((targetPage: number) => setPage(targetPage), [setPage])
  const error = logsQuery.error === null ? null : logsQuery.error instanceof Error ? logsQuery.error.message : String(logsQuery.error)
  const filtered = filterApplied

  return {
    rows, total: logsQuery.data?.total ?? 0,
    loading: logsQuery.isPending, refreshing: logsQuery.isFetching && !logsQuery.isPending,
    error, filtered,
    page, expandedId, filter, providerModelOptions, getModelName, isModelDeleted,
    details: detailQuery.data && expandedId ? { [expandedId]: detailQuery.data } : {},
    // 只认「还没有数据」，不认后台重取：请求还挂着时详情每 1.5s 会被重取一次，
    // 那是为了拿到新的状态与用量，画面上的东西不该跟着闪一下。
    detailLoadingIds: expandedId && detailQuery.isPending ? { [expandedId]: true } : {},
    detailErrors: expandedId && detailQuery.error ? { [expandedId]: detailQuery.error.message } : {},
    loadDetail: setExpandedId, refresh, setFilter, goToPage,
  }
}
