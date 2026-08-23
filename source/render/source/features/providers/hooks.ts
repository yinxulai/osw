import { useQuery, useQueryClient } from '@tanstack/react-query'
import { providerApi } from '@/api/providers'
import { unwrap } from '@/api/unwrap'

export const providerKeys = { all: ['providers'] as const }
const useProvidersQuery = () => useQuery({ queryKey: providerKeys.all, queryFn: () => unwrap(providerApi.list()), refetchInterval: 10_000 })
export function useProviders() { return useProvidersQuery().data ?? [] }
export function useProvidersLoading() { return useProvidersQuery().isPending }
export function useProvidersError() { return useProvidersQuery().error?.message ?? null }
export function useProvidersActions() { const client = useQueryClient(); return { refresh: () => { void client.invalidateQueries({ queryKey: providerKeys.all }) } } }
