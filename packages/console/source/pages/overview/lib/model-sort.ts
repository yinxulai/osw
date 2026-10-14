import type { ModelStat } from '@common/schemas'
import type { TableSortAccessor, TableSortDirection, TableSortState } from '@/lib/table-sort'

/**
 * 两张模型表（排行榜与供应商明细）共用的排序键。
 *
 * 键就是 `ModelStat` 的字段名：两张表的列集合刻意保持一致（同一批指标在两处不该换名字、换顺序），
 * 比较逻辑也就没有抄两份的理由。`providerName` 是排行榜多出来的那一列。
 */
export type ModelSortKey =
  | 'providerModelName'
  | 'providerName'
  | 'attempts'
  | 'avgTtftMs'
  | 'avgTps'
  | 'avgOutputTokens'
  | 'cacheHitRate'
  | 'successRate'

/** 默认排序：按尝试数倒序，与服务端 `getModelStats` 的 `attempts desc` 同一口径。 */
export const MODEL_SORT_DEFAULT: TableSortState<ModelSortKey> = { key: 'attempts', direction: 'descending' }

/**
 * 点每一列表头时的第一个方向。
 *
 * 数值列先看最大的（「最慢的是哪个模型」比「最快的是哪个」更常问），名字列从 A 排到 Z——
 * 对名字来说逆向字母序没有意义。
 */
export const MODEL_SORT_DIRECTIONS: Record<ModelSortKey, TableSortDirection> = {
  providerModelName: 'ascending',
  providerName: 'ascending',
  attempts: 'descending',
  avgTtftMs: 'descending',
  avgTps: 'descending',
  avgOutputTokens: 'descending',
  cacheHitRate: 'descending',
  successRate: 'descending',
}

export const MODEL_SORT_ACCESSOR: TableSortAccessor<ModelStat, ModelSortKey> = {
  value: (row, key) => (key === 'providerName' ? row.providerName : row[key]),
  // 服务端的并列次序是 `providerModelId asc`，这里照抄，排序结果在两次刷新之间保持一致。
  tiebreak: (a, b) => a.providerModelId.localeCompare(b.providerModelId),
}
