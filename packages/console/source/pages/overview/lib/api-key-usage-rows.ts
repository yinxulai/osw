import type { ApiKey, ApiKeyStat } from '@common/schemas'
import type { AppTranslator } from '@/i18n/provider'

/** 按 Key 用量表的一行：把 `ApiKeyStat` 折算成「能直接显示、也能直接排序」的形状。 */
export interface ApiKeyUsageRow {
  apiKeyId: string | null
  name: string
  requests: number
  totalTokens: number
  /** 没有样本时为 `null`，界面显示 `—`，排序时垫底。 */
  successRate: number | null
  avgLatencyMs: number | null
}

/**
 * 把统计行折成显示行。
 *
 * 名字在这里反查而不是在组件里现找：请求日志只存 `apiKeyId`、不存名字，所以名字必须
 * 从当前 Key 列表实时取——改名之后历史统计跟着换标签。查不到说明这把 Key 已被删除，
 * 显示「已删除」；`apiKeyId === null` 的行是未署名的流量。
 *
 * 纯函数、放在 `lib/` 而不是组件里：视图层只该做映射与渲染，这些口径（除零、缺失值）
 * 值得被单独读一遍，也才能被排序规则共用。
 */
export function buildApiKeyUsageRows(stats: readonly ApiKeyStat[], keys: readonly ApiKey[], t: AppTranslator): ApiKeyUsageRow[] {
  return stats.map((stat) => {
    const name = stat.apiKeyId === null
      ? t('apiKeys.label.anonymous')
      : keys.find(key => key.id === stat.apiKeyId)?.name ?? t('apiKeys.label.unknown')
    return {
      apiKeyId: stat.apiKeyId,
      name,
      requests: stat.requests,
      totalTokens: stat.totalTokens,
      successRate: stat.requests > 0 ? stat.success / stat.requests : null,
      avgLatencyMs: stat.requests > 0 ? stat.avgLatencyMs : null,
    }
  })
}
