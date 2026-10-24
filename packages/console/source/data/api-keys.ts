import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiKey, ApiKeyUsageRecency } from '@common/schemas'
import { apiKeyApi, type CreateApiKeyInput, type UpdateApiKeyInput } from '@/api/api-keys'
import { analyticsApi } from '@/api/observability'
import { unwrap } from '@/api/unwrap'
import { useSettings } from '@/data/settings'

export const apiKeyKeys = { all: ['api-keys'] as const, recency: ['api-keys', 'recency'] as const }

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

/**
 * 每把 Key 的活跃度（最近使用时间 + 最近 7 天请求数），按 `apiKeyId` 索引。
 *
 * 单独一条查询而不是并进列表接口：列表来自**配置库**（用户写的），活跃度来自
 * **观测库**（系统写的），两条库的读取节奏与失效时机都不一样。索引在这里建，
 * 因为渲染层不该自己 `find` 一遍——那是纯逻辑，属于 `pages/api-keys/lib`。
 *
 * 刷新节奏跟统计页一致（15 秒）：它回答的是「这把刚才还在用吗」，慢了就没意义。
 */
const useApiKeyRecencyQuery = () => {
  // 模块关着时这份数据没有任何地方会渲染（页面跳走、统计卡不显示），
  // 就别让它继续挂着 15 秒一次的轮询；重新打开开关时 `enabled` 变化会自动拉一次。
  const featureEnabled = useSettings()?.apiKeyFeatureEnabled ?? true
  return useQuery({
    queryKey: apiKeyKeys.recency,
    queryFn: () => unwrap(analyticsApi.apiKeyRecency()),
    enabled: featureEnabled,
    refetchInterval: featureEnabled ? 15_000 : false,
  })
}

/**
 * 索引必须按响应**引用**记忆化。
 *
 * 直接在 hook 体里 `new Map(...)` 会让每次渲染都产出一个新的 Map：消费方拿它当
 * `useMemo` 依赖时，依赖永远「变了」，拼接出来的行数组也跟着每帧重建——列表与统计卡
 * 于是每次父组件重渲染都要全量重算、重挂。放这里而不是让调用方自己 `useMemo`，
 * 是因为「一份 Map」正是这个 hook 的返回值本身。
 */
export function useApiKeyRecency(): Map<string, ApiKeyUsageRecency> {
  const rows = useApiKeyRecencyQuery().data
  return useMemo(() => new Map((rows ?? []).map(row => [row.apiKeyId, row])), [rows])
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
