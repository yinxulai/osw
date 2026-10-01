import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { providerModelApi } from '@/api/models'
import { unwrap } from '@/api/unwrap'

export const providerModelKeys = { withDeleted: ['provider-models', 'with-deleted'] as const }

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
