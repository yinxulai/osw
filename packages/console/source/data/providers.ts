import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Provider } from '@common/schemas'
import { providerApi } from '@/api/providers'
import { unwrap } from '@/api/unwrap'

export const providerKeys = { all: ['providers'] as const }

/** 数据未就绪时复用的空数组，避免 `?? []` 每次渲染都产生新引用。 */
const EMPTY_PROVIDERS: Provider[] = []

const useProvidersQuery = () => useQuery({ queryKey: providerKeys.all, queryFn: () => unwrap(providerApi.list()), refetchInterval: 10_000 })
export function useProviders() { return useProvidersQuery().data ?? EMPTY_PROVIDERS }
export function useProvidersLoading() { return useProvidersQuery().isPending }
export function useProvidersError() { return useProvidersQuery().error?.message ?? null }
export function useProvidersActions() {
  const client = useQueryClient()
  const refresh = useCallback(() => { void client.invalidateQueries({ queryKey: providerKeys.all }) }, [client])
  /** 乐观更新侧栏顺序，失败时回滚到请求前的列表。 */
  const reorder = useCallback(async (ids: string[]) => {
    const previous = client.getQueryData<Provider[]>(providerKeys.all)
    if (previous) {
      const byId = new Map(previous.map(provider => [provider.id, provider]))
      const moved = ids.map(id => byId.get(id)).filter((provider): provider is Provider => Boolean(provider))
      // 没被拖到的供应商（理论上不会有）按原顺序追加在后面，列表长度不会因为一次拖动而变。
      const movedIds = new Set(moved.map(provider => provider.id))
      client.setQueryData(providerKeys.all, [...moved, ...previous.filter(provider => !movedIds.has(provider.id))])
    }
    try {
      await unwrap(providerApi.reorder(ids))
    } catch (error) {
      if (previous) client.setQueryData(providerKeys.all, previous)
      throw error
    }
  }, [client])
  return { refresh, reorder }
}
