import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useProviders, useProvidersActions, useProvidersLoading } from '@/data/providers'
import { useHealth, useHealthActions } from '@/data/health'
import { loadProviderModels, providerModelKeys } from '@/data/provider-models'
import type { ProviderModelRoute } from '@common/schemas'
import { useModelManagementUiStore } from '../store'

/**
 * 模型列表的缓存键。
 *
 * 唯一来源已搬到 `@/data/provider-models`（诊断面板挂在外壳上，也要读同一份），
 * 这里保留 `modelKeys` 这个名字继续给页面内部使用。
 */
export const modelKeys = providerModelKeys

/** 数据未就绪时复用的空数组，避免 `?? []` 每次渲染都产生新引用。 */
const EMPTY_MODELS: ProviderModelRoute[] = []

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
  const models = query.data ?? EMPTY_MODELS
  const setModels = useCallback((next: ProviderModelRoute[] | ((current: ProviderModelRoute[]) => ProviderModelRoute[])) => client.setQueryData<ProviderModelRoute[]>(modelKeys.all, current => typeof next === 'function' ? next(current ?? []) : next), [client])
  const loadModels = useCallback(async () => { const result = await query.refetch(); return !result.isError }, [query])
  const reload = useCallback(async () => { refreshProviders(); refreshHealth(); await loadModels() }, [loadModels, refreshHealth, refreshProviders])
  /*
   * 自动选中第一个供应商。
   *
   * 判据是「记下的那个还在不在」，不是「有没有记过」：这个选择会跟着窗口一起恢复
   * （`store/page-scratch.ts`），而供应商可能在别处被删掉。只看空不空的话，本机存着
   * 一个已经消失的 id 时，页面会一直停在「请选择供应商」的空状态上，用户还以为供应商
   * 全没了。
   *
   * 必须等 `providers` 有内容再判断：还没加载出来时列表是空的，按「不在列表里」处理会
   * 把用户的选择直接擦掉。
   */
  useEffect(() => {
    if (providers.length === 0) return
    if (providers.some(provider => provider.id === selectedProviderId)) return
    setSelectedProviderId(providers[0].id)
  }, [providers, selectedProviderId, setSelectedProviderId])
  return { providers, health, providersLoading, models, setModels, selectedProviderId, setSelectedProviderId, loading: query.isPending || providersLoading, loadModels, reload }
}
