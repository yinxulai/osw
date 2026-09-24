import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { logicalModelApi } from '@/api/models'
import { unwrap } from '@/api/unwrap'
import type { LogicalModel } from '@common/schemas'

export const logicalModelKeys = { all: ['logical-models'] as const }

/** 数据未就绪时复用的空数组，避免 `?? []` 每次渲染都产生新引用。 */
const EMPTY_LOGICAL_MODELS: LogicalModel[] = []

const useLogicalModelsQuery = () => useQuery({ queryKey: logicalModelKeys.all, queryFn: () => unwrap(logicalModelApi.list()), refetchInterval: 30_000 })
export function useLogicalModels() { return useLogicalModelsQuery().data ?? EMPTY_LOGICAL_MODELS }
export function useLogicalModelsLoading() { return useLogicalModelsQuery().isPending }
export function useLogicalModelsError() { return useLogicalModelsQuery().error?.message ?? null }
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
