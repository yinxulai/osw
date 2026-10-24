import type { ApiKey, ApiKeyUsageRecency } from '@common/schemas'
import { resolveApiKeyStatus, type ApiKeyRow } from '../types'

/**
 * 把「配置库里的 Key 列表」与「观测库里的活跃度」拼成展示行。
 *
 * 两份数据来自两个库、两条接口，拼接是**领域逻辑**而不是渲染细节：它要处理
 * 「活跃度里没有这把 Key」（签发后一次都没被用过）这个分支，而这个分支的正确表现
 * 是「显示从未使用」，不是「这一行缺一块」。
 *
 * 挂在 `lib/` 而不是页面的 `useMemo` 里，是为了它能被不渲染 React 的单测直接钉住——
 * 「一把没用过的 Key 不会因为缺记录而消失」「活跃度里有一把已被删除的 Key 也不会多出一行」
 * 这两条都属于「只会在用户手上体现」的行为。
 */
export function buildApiKeyRows(
  keys: ReadonlyArray<ApiKey>,
  recency: ReadonlyMap<string, ApiKeyUsageRecency>,
  now: number,
): ApiKeyRow[] {
  return keys.map(key => {
    const usage = recency.get(key.id)
    return {
      ...key,
      status: resolveApiKeyStatus(key, now),
      lastUsedTime: usage?.lastUsedTime ?? null,
      recentRequests: usage?.recentRequests ?? 0,
    }
  })
}
