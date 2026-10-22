import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { providerModelApi } from '@/api/models'
import { unwrap } from '@/api/unwrap'
import type { ProviderModelRoute } from '@common/schemas'

export const providerModelKeys = {
  /** 模型管理页与诊断面板共用的那一份「已保存的模型路由」。 */
  all: ['provider-models'] as const,
  withDeleted: ['provider-models', 'with-deleted'] as const,
}

/** 数据未就绪时复用的空数组，避免 `?? []` 每次渲染都产生新引用。 */
const EMPTY_PROVIDER_MODELS: ProviderModelRoute[] = []

/**
 * 库里的供应商模型行 → 面板与规划器都认识的 {@link ProviderModelRoute}。
 *
 * 这层映射是**唯一**一份：模型管理页与外壳上的诊断面板读的是同一把缓存键
 *（`providerModelKeys.all`），所以它也只能有一个来源，否则同一个模型在两处会给出
 * 两种「可测协议」的结论。
 */
export function loadProviderModels(): Promise<ProviderModelRoute[]> {
  return unwrap(providerModelApi.list()).then(data => data.map(model => ({
    id: model.id,
    providerId: model.providerId,
    modelName: model.modelName,
    endpoints: model.endpoints.map(endpoint => ({
      protocol: endpoint.protocol,
      endpointUrl: endpoint.url ?? '',
      customAuthHeader: null,
      protocolConversionEnabled: endpoint.conversions.some(conversion => conversion.enabled),
    })),
    priority: 0,
    enabled: model.enabled,
    createdTime: model.createdTime,
    updatedTime: model.updatedTime,
    deletedTime: model.deletedTime,
  })))
}

/** 挂在外壳上的诊断面板用得到的模型列表；与模型管理页共享同一份缓存。 */
export function useProviderModels(): ProviderModelRoute[] {
  const query = useQuery({ queryKey: providerModelKeys.all, queryFn: loadProviderModels, refetchInterval: 30_000 })
  return query.data ?? EMPTY_PROVIDER_MODELS
}

/**
 * 被软删除的供应商模型 id。
 *
 * 统计分析里的模型名同样是**写入当时的快照**，删掉配置行不会让统计消失；界面上要标出
 * 「这个模型已经删了」，就得连删除行一起拿回来比对。只读、单独缓存，不与编辑器里的
 * `['provider-models']` 共用——那个键放的是映射过的编辑器形状。
 */
const useDeletedProviderModelsQuery = () => useQuery({
  queryKey: providerModelKeys.withDeleted,
  queryFn: () => unwrap(providerModelApi.listIncludingDeleted()),
  refetchInterval: 30_000,
})
export function useDeletedProviderModelIds(): ReadonlySet<string> {
  const deleted = useDeletedProviderModelsQuery().data
  return useMemo(() => new Set((deleted ?? []).filter(model => model.deletedTime !== null).map(model => model.id)), [deleted])
}
