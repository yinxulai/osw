/**
 * 表头点击排序：排序状态与比较器。
 *
 * 排序**按已经拿到的行算**，不重新取数——点一下表头立刻看到顺序变化，也不打扰 15s 一次的轮询。
 * 代价是排的是接口给出的那一批行：榜单本来就只列前 10 名，供应商明细也受服务端的 200 行上限约束。
 */

export type TableSortDirection = 'ascending' | 'descending'

export interface TableSortState<K extends string> {
  key: K
  direction: TableSortDirection
}

/**
 * 点表头的结果：换一列就按该列的初始方向排（数值列先看大的，名字列先看 A→Z），
 * 同一列再点就翻转。不设「第三次点击取消排序」——回到默认顺序得靠用户自己再点回来，
 * 而每一列的初始方向本来就是它最有用的那一头。
 */
export function nextTableSort<K extends string>(
  current: TableSortState<K>,
  key: K,
  initialDirection: TableSortDirection,
): TableSortState<K> {
  if (current.key !== key) return { key, direction: initialDirection }
  return { key, direction: current.direction === 'ascending' ? 'descending' : 'ascending' }
}

/** 参与排序的取值：数字按大小，字符串按当前语言，`null` 表示这一列没有样本。 */
export type TableSortValue = number | string | null

/**
 * 比较两个取值。
 *
 * `null`（没测到）**无论升序降序都垫底**：把「没有样本」排到榜首，等于让最不可信的模型占着
 * 最显眼的位置。名字按当前语言比较，中文不会退化成码点序。
 */
export function compareTableSortValues(
  a: TableSortValue,
  b: TableSortValue,
  direction: TableSortDirection,
  locale: string,
): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  const result = typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a).localeCompare(String(b), locale)
  if (result === 0) return 0
  return direction === 'descending' ? -result : result
}

export interface TableSortAccessor<T, K extends string> {
  /** 从一行里取出排序列的值。 */
  value: (row: T, key: K) => TableSortValue
  /** 取值相同时的次序。服务端已按尝试数排好序，用它兜住并列，刷新之间不会跳动。 */
  tiebreak: (a: T, b: T) => number
}

export function applyTableSort<T, K extends string>(
  rows: readonly T[],
  sort: TableSortState<K>,
  accessor: TableSortAccessor<T, K>,
  locale: string,
): T[] {
  return [...rows].sort((a, b) =>
    compareTableSortValues(accessor.value(a, sort.key), accessor.value(b, sort.key), sort.direction, locale)
    || accessor.tiebreak(a, b),
  )
}
