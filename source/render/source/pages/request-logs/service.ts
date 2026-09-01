import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { unwrap } from '@/api/unwrap'
import { providerModelApi } from '@/api/models'
import { useLogicalModels } from '@/features/logical-models/hooks'
import { useProviders } from '@/features/providers/hooks'
import { useRequestLogDetailQuery, useRequestLogsQuery, PAGE_SIZE } from './queries'
import { useRequestLogsUiStore } from './store'

export interface RequestLogFilter { providerId: string; providerModelId: string; logicalModelId: string; clientProtocol: string; status: string; createdTimeFrom: number | null; createdTimeTo: number | null }

export function useRequestLogsService() {
  const queryClient = useQueryClient()
  const page = useRequestLogsUiStore(state => state.page)
  const expandedId = useRequestLogsUiStore(state => state.expandedId)
  const filter = useRequestLogsUiStore(state => state.filter)
  const setPage = useRequestLogsUiStore(state => state.setPage)
  const setExpandedId = useRequestLogsUiStore(state => state.setExpandedId)
  const setFilterState = useRequestLogsUiStore(state => state.setFilter)
  const logsQuery = useRequestLogsQuery(filter, page)
  const detailQuery = useRequestLogDetailQuery(expandedId)
  const providers = useProviders()
  const logicalModels = useLogicalModels()
  const providerModelsQuery = useQuery({ queryKey: ['provider-models'], queryFn: () => unwrap(providerModelApi.list()), staleTime: 30_000 })
  const providerOptions = useMemo(() => providers.map(p => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)), [providers])
  const providerNameById = useMemo(() => new Map(providers.map(provider => [provider.id, provider.name])), [providers])
  const providerModelOptions = useMemo(() => {
    const models = providerModelsQuery.data ?? []
    return models
      .map(model => ({ id: model.id, name: `${providerNameById.get(model.providerId) ?? model.providerId} / ${model.modelName}` }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [providerModelsQuery.data, providerNameById])
  const getModelName = useCallback((id: string) => logicalModels.find(model => model.id === id)?.name ?? id, [logicalModels])
  const refresh = useCallback((targetPage = page) => queryClient.invalidateQueries({ queryKey: ['request-logs', filter, targetPage] }), [filter, page, queryClient])
  const setFilter = useCallback((next: Partial<RequestLogFilter>) => { setFilterState(next) }, [setFilterState])
  const goToPage = useCallback((targetPage: number) => setPage(targetPage), [setPage])

  return {
    logs: logsQuery.data?.logs ?? [], total: logsQuery.data?.total ?? 0,
    loading: logsQuery.isPending, refreshing: logsQuery.isFetching && !logsQuery.isPending,
    page, expandedId, filter, providers, logicalModels, providerOptions, providerModelOptions, getModelName,
    details: detailQuery.data && expandedId ? { [expandedId]: detailQuery.data } : {},
    detailLoadingIds: expandedId && detailQuery.isFetching ? { [expandedId]: true } : {},
    detailErrors: expandedId && detailQuery.error ? { [expandedId]: detailQuery.error.message } : {},
    loadDetail: setExpandedId, refresh, setFilter, goToPage, pageSize: PAGE_SIZE,
  }
}
