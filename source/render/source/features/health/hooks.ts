import { useQuery, useQueryClient } from '@tanstack/react-query'
import { healthApi } from '@/api/runtime'
import { unwrap } from '@/api/unwrap'

export const healthKeys = { all: ['health'] as const }
const useHealthQuery = () => useQuery({
  queryKey: healthKeys.all,
  queryFn: () => unwrap(healthApi.list()),
  refetchInterval: 5_000,
  select: data => ({ providers: Object.fromEntries(data.providers.map(item => [item.providerId, item])), providerModels: Object.fromEntries(data.providerModels.map(item => [item.providerModelId, item])) }),
})
export function useHealth() { const query = useHealthQuery(); return { providers: query.data?.providers ?? {}, providerModels: query.data?.providerModels ?? {}, loading: query.isPending, error: query.error?.message ?? null, loaded: query.isFetched } }
export function useHealthLoading() { return useHealthQuery().isPending }
export function useHealthError() { return useHealthQuery().error?.message ?? null }
export function useHealthActions() { const client = useQueryClient(); return { refresh: () => { void client.invalidateQueries({ queryKey: healthKeys.all }) } } }
