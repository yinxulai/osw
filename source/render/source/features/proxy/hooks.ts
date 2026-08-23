import { useQuery, useQueryClient } from '@tanstack/react-query'
import { proxyApi } from '@/api/runtime'
import { unwrap } from '@/api/unwrap'

export const proxyKeys = { status: ['proxy-status'] as const }
const useProxyQuery = () => useQuery({ queryKey: proxyKeys.status, queryFn: () => unwrap(proxyApi.status()), refetchInterval: 5_000 })
export function useProxy() { return useProxyQuery().data ?? null }
export const useProxyStatus = useProxy
export function useProxyLoading() { return useProxyQuery().isPending }
export function useProxyError() { return useProxyQuery().error?.message ?? null }
export function useProxyActions() {
  const client = useQueryClient()
  const command = async (fn: typeof proxyApi.start) => { const result = await fn(); if (result.success) client.setQueryData(proxyKeys.status, result.data); return result }
  return { start: () => command(proxyApi.start), stop: () => command(proxyApi.stop), restart: () => command(proxyApi.restart), refresh: () => { void client.invalidateQueries({ queryKey: proxyKeys.status }) } }
}
