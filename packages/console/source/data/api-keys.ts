import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiKey } from '@common/schemas'
import { apiKeyApi, type CreateApiKeyInput, type UpdateApiKeyInput } from '@/api/api-keys'
import { unwrap } from '@/api/unwrap'

export const apiKeyKeys = { all: ['api-keys'] as const }

/** 更新入参：id 与要改的字段分开，避免把 id 也当成可改字段。 */
export type UpdateApiKeyMutationInput = { id: string; updates: UpdateApiKeyInput }

/**
 * 客户端 API Key 列表。
 *
 * 名字与「是否启用 / 是否过期」都是时间敏感的状态（请求记录要按 id 反查当前名字），
 * 所以不设 `staleTime`：任何一次增删改之后都靠 `invalidate` 重新拉，界面不自己猜。
 */
const useApiKeysQuery = () => useQuery({ queryKey: apiKeyKeys.all, queryFn: () => unwrap(apiKeyApi.list()) })

export function useApiKeys(): ApiKey[] {
  return useApiKeysQuery().data ?? []
}

export function useApiKeysLoading(): boolean {
  return useApiKeysQuery().isPending
}

/** 列表加载失败要能显示出来并重试，所以这里把错误原文透出去（页面再本地化）。 */
export function useApiKeysError(): string | null {
  return useApiKeysQuery().error?.message ?? null
}

/**
 * 写操作的统一入口。
 *
 * 每个 mutation 成功后都 `invalidate` 列表，让「页面状态」只有一个来源（服务端）：
 * 这样连启用/停用这种乐观更新都不需要——重拉一次的成本远低于维护一份影子状态。
 * 明文（`secret`）只在 create / rotate 的**返回值**里出现，不落进缓存。
 */
export function useApiKeysActions() {
  const client = useQueryClient()
  const invalidate = () => { void client.invalidateQueries({ queryKey: apiKeyKeys.all }) }

  const refresh = () => { invalidate() }
  const create = useMutation({ mutationFn: (input: CreateApiKeyInput) => unwrap(apiKeyApi.create(input)), onSuccess: invalidate })
  const update = useMutation({
    mutationFn: (input: UpdateApiKeyMutationInput) => unwrap(apiKeyApi.update(input.id, input.updates)),
    onSuccess: invalidate,
  })
  const remove = useMutation({ mutationFn: (id: string) => unwrap(apiKeyApi.remove(id)), onSuccess: invalidate })
  const rotate = useMutation({ mutationFn: (id: string) => unwrap(apiKeyApi.rotate(id)), onSuccess: invalidate })

  return { refresh, create, update, remove, rotate }
}

