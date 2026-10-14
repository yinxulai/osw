import { useCallback, useMemo, useState } from 'react'
import {
  applyTableSort,
  nextTableSort,
  type TableSortAccessor,
  type TableSortDirection,
  type TableSortState,
} from '@/lib/table-sort'
import { useLocale } from '@/i18n/provider'

export interface UseTableSortResult<T, K extends string> {
  sortedRows: T[]
  sort: TableSortState<K>
  /** 点表头：换列按该列的初始方向，同列再点翻转。 */
  toggleSort: (key: K) => void
}

/**
 * 表格排序状态：数据交进来，排好序的行交出去。
 *
 * 只持有「按哪一列、朝哪边」，数据本身仍由调用方持有——页面每 15s 轮询一次，新数据进来时
 * 排序必须跟着新数据走，所以这里存的是行而不是副本。
 */
export function useTableSort<T, K extends string>(
  rows: readonly T[],
  defaultSort: TableSortState<K>,
  accessor: TableSortAccessor<T, K>,
  initialDirections: Record<K, TableSortDirection>,
): UseTableSortResult<T, K> {
  const locale = useLocale()
  const [sort, setSort] = useState<TableSortState<K>>(defaultSort)

  const toggleSort = useCallback(
    (key: K) => setSort((current) => nextTableSort(current, key, initialDirections[key])),
    [initialDirections],
  )

  const sortedRows = useMemo(() => applyTableSort(rows, sort, accessor, locale), [rows, sort, accessor, locale])

  return { sortedRows, sort, toggleSort }
}
