import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ProviderHealth, ProviderModelHealth } from '@common/schemas'
import { healthApi } from '@/api/runtime'
import { unwrap } from '@/api/unwrap'

export const healthKeys = { all: ['health'] as const }

/**
 * 数据还没到时的空占位。
 *
 * 写成 `query.data?.providers ?? {}` 的话，每次渲染都会产生一个新对象：
 * 依赖它的 `useMemo` / `useCallback` / `useEffect` 就得跟着重跑，
 * 而这些回调里往往带 `setState`——是最容易一路演成无限更新链的起点。
 */
const EMPTY_PROVIDER_HEALTH: Record<string, ProviderHealth> = {}
const EMPTY_PROVIDER_MODEL_HEALTH: Record<string, ProviderModelHealth> = {}

const useHealthQuery = () => useQuery({
  queryKey: healthKeys.all,
  queryFn: () => unwrap(healthApi.list()),
  refetchInterval: 5_000,
  select: data => ({ providers: Object.fromEntries(data.providers.map(item => [item.providerId, item])), providerModels: Object.fromEntries(data.providerModels.map(item => [item.providerModelId, item])) }),
})
export function useHealth() {
  const query = useHealthQuery()
  const providers = query.data?.providers ?? EMPTY_PROVIDER_HEALTH
  const providerModels = query.data?.providerModels ?? EMPTY_PROVIDER_MODEL_HEALTH
  const { isPending, error, isFetched } = query
  return useMemo(
    () => ({ providers, providerModels, loading: isPending, error: error?.message ?? null, loaded: isFetched }),
    [providers, providerModels, isPending, error, isFetched],
  )
}
export function useHealthLoading() { return useHealthQuery().isPending }
export function useHealthError() { return useHealthQuery().error?.message ?? null }
export function useHealthActions() { const client = useQueryClient(); return { refresh: () => { void client.invalidateQueries({ queryKey: healthKeys.all }) } } }
