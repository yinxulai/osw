import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { logicalModelApi } from '@/api/models'
import { unwrap } from '@/api/unwrap'
import type { LogicalModel } from '@common/schemas'

export const logicalModelKeys = { all: ['logical-models'] as const, withDeleted: ['logical-models', 'with-deleted'] as const }

/** 数据未就绪时复用的空数组，避免 `?? []` 每次渲染都产生新引用。 */
const EMPTY_LOGICAL_MODELS: LogicalModel[] = []

const useLogicalModelsQuery = () => useQuery({ queryKey: logicalModelKeys.all, queryFn: () => unwrap(logicalModelApi.list()), refetchInterval: 30_000 })
export function useLogicalModels() { return useLogicalModelsQuery().data ?? EMPTY_LOGICAL_MODELS }
export function useLogicalModelsLoading() { return useLogicalModelsQuery().isPending }
export function useLogicalModelsError() { return useLogicalModelsQuery().error?.message ?? null }

/**
 * 被软删除的逻辑模型名（`modelId`）。
 *
 * 请求日志里记的是**请求当时的模型名**，删掉配置行并不会抹掉那些历史记录——名字仍在，
 * 只是不再对应一条活跃配置。观测侧要能分辨「这个名字还在用」和「这个名字的主人已经删了」，
 * 就得连删除行一起拿回来比对，这份名单只服务于那一件事。
 *
 * 单独一个缓存键：活跃列表被各处乐观写入（排序、增删改），观测侧只读这份全量的，互不干扰。
 */
const useDeletedLogicalModelsQuery = () => useQuery({
  queryKey: logicalModelKeys.withDeleted,
  queryFn: () => unwrap(logicalModelApi.listIncludingDeleted()),
  select: models => models.filter(model => model.deletedTime !== null),
  refetchInterval: 30_000,
})
export function useDeletedLogicalModelIds(): ReadonlySet<string> {
  const deleted = useDeletedLogicalModelsQuery().data ?? EMPTY_LOGICAL_MODELS
  return useMemo(() => new Set(deleted.map(model => model.modelId)), [deleted])
}
export function useLogicalModelsActions() {
  const client = useQueryClient()
  const refresh = useCallback(() => { void client.invalidateQueries({ queryKey: logicalModelKeys.all }) }, [client])
  /** 乐观更新展示顺序，失败时回滚到请求前的列表。 */
  const reorder = useCallback(async (ids: string[]) => {
    const previous = client.getQueryData<LogicalModel[]>(logicalModelKeys.all)
    if (previous) {
      const byId = new Map(previous.map(model => [model.id, model]))
      const next = ids.map(id => byId.get(id)).filter((model): model is LogicalModel => Boolean(model))
      client.setQueryData(logicalModelKeys.all, next)
    }
    try {
      await unwrap(logicalModelApi.reorder(ids))
    } catch (error) {
      if (previous) client.setQueryData(logicalModelKeys.all, previous)
      throw error
    }
  }, [client])
  return { refresh, reorder }
}
