import type { ApiKey, ApiKeyStat } from '@common/schemas'
import type { AppTranslator } from '@/i18n/provider'

/** 按 Key 用量表的一行：把 `ApiKeyStat` 折算成「能直接显示、也能直接排序」的形状。 */
export interface ApiKeyUsageRow {
  apiKeyId: string | null
  name: string
  /** 这行名字对应的 Key 已被软删除：名字照旧展示，后面补一枚「已删除」标签。 */
  deleted: boolean
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
 * 从 Key 列表实时取——改名之后历史统计跟着换标签。
 *
 * `keys` 必须是**含软删除行**的那一份（`useApiKeysIncludingDeleted`）。Key 是软删除：
 * 删掉之后行还在、名字也还在，统计里的历史用量依然指向它。只拿活跃列表来查，会把这把
 * Key 当场退化成「已删除的 Key」这句占位文案，等于把「额度当年花在谁身上」这个事实丢掉——
 * 名字照旧展示，只补一枚标签说明它已经删了，与模型排行榜里供应商 / 供应商模型的
 * 处理完全一致（`model-ranking.tsx`）。
 *
 * 查不到才退回占位文案：那种情况是记录指向的配置真的不存在，已经不是「已删除」能解释的了。
 *
 * `apiKeyId === null` 的行是未署名的流量，与「已删除」是两件事，标签也不同。
 *
 * 纯函数、放在 `lib/` 而不是组件里：视图层只该做映射与渲染，这些口径（除零、缺失值）
 * 值得被单独读一遍，也才能被排序规则共用。
 */
export function buildApiKeyUsageRows(stats: readonly ApiKeyStat[], keys: readonly ApiKey[], t: AppTranslator): ApiKeyUsageRow[] {
  return stats.map((stat) => {
    const key = stat.apiKeyId === null ? undefined : keys.find(item => item.id === stat.apiKeyId)
    const name = stat.apiKeyId === null
      ? t('apiKeys.label.anonymous')
      : key?.name ?? t('apiKeys.label.unknown')
    return {
      apiKeyId: stat.apiKeyId,
      name,
      deleted: key?.deletedTime != null,
      requests: stat.requests,
      totalTokens: stat.totalTokens,
      successRate: stat.requests > 0 ? stat.success / stat.requests : null,
      avgLatencyMs: stat.requests > 0 ? stat.avgLatencyMs : null,
    }
  })
}
