import type { TableSortAccessor, TableSortDirection, TableSortState } from '@/lib/table-sort'
import type { ApiKeyUsageRow } from './api-key-usage-rows'

/**
 * 按 Key 用量表的排序键。
 *
 * 与模型排行榜同一套做法（`model-sort.ts`）：键就是列的顺序，点表头只重排**已经拿到**的行，
 * 不重新取数。两个比率列由 `requests` 与 `success` / `avgLatencyMs` 现算，
 * 所以它们的键名不是 `ApiKeyStat` 上的字段，取值在 accessor 里做换算。
 */
export type ApiKeyUsageSortKey = 'name' | 'requests' | 'totalTokens' | 'successRate' | 'avgLatencyMs'

/** 默认排序：按请求数倒序，与服务端 `getApiKeyStats` 的口径一致（谁用得最多排最前）。 */
export const API_KEY_USAGE_SORT_DEFAULT: TableSortState<ApiKeyUsageSortKey> = { key: 'requests', direction: 'descending' }

/**
 * 点每一列表头时的第一个方向。
 *
 * 数值列先看最大的；名字列从 A 排到 Z——对名字来说逆向字母序没有意义。
 * 两个比率列同样先看大的（「谁的成功率最高 / 最慢的是哪把」是更常问的那一头）。
 */
export const API_KEY_USAGE_SORT_DIRECTIONS: Record<ApiKeyUsageSortKey, TableSortDirection> = {
  name: 'ascending',
  requests: 'descending',
  totalTokens: 'descending',
  successRate: 'descending',
  avgLatencyMs: 'descending',
}

export const API_KEY_USAGE_SORT_ACCESSOR: TableSortAccessor<ApiKeyUsageRow, ApiKeyUsageSortKey> = {
  value: (row, key) => row[key],
  // 并列时按 Key id 排：服务端的次序里匿名（`apiKeyId === null`）固定在最前，
  // 这里用空串兜住它，刷新之间顺序不会跳。
  tiebreak: (a, b) => (a.apiKeyId ?? '').localeCompare(b.apiKeyId ?? ''),
}
