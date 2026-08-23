import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { providerModelApi } from '@/api/models'
import { unwrap } from '@/api/unwrap'
import { useProviders, useProvidersActions, useProvidersLoading } from '@/features/providers/hooks'
import { useHealth, useHealthActions } from '@/features/health/hooks'
import type { ProviderModelRoute } from '@common/schemas'
import { useModelManagementUiStore } from '../store'

export const modelKeys = { all: ['provider-models'] as const }

function loadProviderModels(): Promise<ProviderModelRoute[]> {
  return unwrap(providerModelApi.list()).then(data => data.map(model => ({ id: model.id, providerId: model.providerId, modelName: model.modelName, endpoints: model.endpoints.map(endpoint => ({ protocol: endpoint.protocol, endpointUrl: endpoint.url ?? '', customAuthHeader: null, protocolConversionEnabled: endpoint.conversions.some(conversion => conversion.enabled) })), priority: 0, enabled: model.enabled, createdTime: model.createdTime, updatedTime: model.updatedTime, deletedTime: model.deletedTime })))
}

export function useModelData() {
  const client = useQueryClient()
  const providers = useProviders()
  const health = useHealth()
  const providersLoading = useProvidersLoading()
  const { refresh: refreshProviders } = useProvidersActions()
  const { refresh: refreshHealth } = useHealthActions()
  const selectedProviderId = useModelManagementUiStore(state => state.selectedProviderId)
  const setSelectedProviderId = useModelManagementUiStore(state => state.setSelectedProviderId)
  const query = useQuery({ queryKey: modelKeys.all, queryFn: loadProviderModels, refetchInterval: 30_000 })
  const models = query.data ?? []
  const setModels = useCallback((next: ProviderModelRoute[] | ((current: ProviderModelRoute[]) => ProviderModelRoute[])) => client.setQueryData<ProviderModelRoute[]>(modelKeys.all, current => typeof next === 'function' ? next(current ?? []) : next), [client])
  const loadModels = useCallback(async () => { const result = await query.refetch(); return !result.isError }, [query])
  const reload = useCallback(async () => { refreshProviders(); refreshHealth(); await loadModels() }, [loadModels, refreshHealth, refreshProviders])
  useEffect(() => { if (!selectedProviderId && providers[0]) setSelectedProviderId(providers[0].id) }, [providers, selectedProviderId, setSelectedProviderId])
  return { providers, health, providersLoading, models, setModels, selectedProviderId, setSelectedProviderId, loading: query.isPending || providersLoading, loadModels, reload }
}
