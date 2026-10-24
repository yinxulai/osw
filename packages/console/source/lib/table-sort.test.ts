import { describe, expect, it } from 'vitest'
import {
  applyTableSort,
  compareTableSortValues,
  nextTableSort,
  type TableSortAccessor,
  type TableSortState,
} from './table-sort'

/*
 * 排序的比较规则。
 *
 * 这里守的是三件容易在实现里走偏的事：换列要按该列的初始方向（而不是沿用上一列的方向）、
 * 同一列再点要翻转、以及 `null` 永远垫底——统计里的空值代表「没有样本」，
 * 让它因为降序排到榜首就等于把最不可信的模型放在最显眼的位置。
 */

describe('nextTableSort', () => {
  it('换一列时按该列自己的初始方向，而不是沿用当前方向', () => {
    const current: TableSortState<'a' | 'b'> = { key: 'a', direction: 'descending' }

    expect(nextTableSort(current, 'b', 'ascending')).toEqual({ key: 'b', direction: 'ascending' })
  })

  it('同一列再点翻转方向', () => {
    const current: TableSortState<'a'> = { key: 'a', direction: 'descending' }

    expect(nextTableSort(current, 'a', 'descending')).toEqual({ key: 'a', direction: 'ascending' })
    expect(nextTableSort(nextTableSort(current, 'a', 'descending'), 'a', 'descending'))
      .toEqual({ key: 'a', direction: 'descending' })
  })

  it('第三次点击不清除排序，只在两个方向之间往复——上面那句「翻转」就已经把它钉死了', () => {
    let state: TableSortState<'a'> = { key: 'a', direction: 'ascending' }
    for (let index = 0; index < 4; index += 1) state = nextTableSort(state, 'a', 'ascending')

    expect(state).toEqual({ key: 'a', direction: 'ascending' })
  })
})

describe('compareTableSortValues', () => {
  it('数字按大小，方向决定正负', () => {
    expect(compareTableSortValues(1, 2, 'ascending', 'zh-CN')).toBeLessThan(0)
    expect(compareTableSortValues(1, 2, 'descending', 'zh-CN')).toBeGreaterThan(0)
    expect(compareTableSortValues(2, 2, 'descending', 'zh-CN')).toBe(0)
  })

  it('字符串按当前语言比较，中文不退化成码点序', () => {
    // 码点序里「张」在「李」之后，拼音序里「李」在「张」之后。
    expect(compareTableSortValues('张三', '李四', 'ascending', 'zh-CN')).toBeGreaterThan(0)
    expect(compareTableSortValues('张三', '李四', 'ascending', 'en-US')).toBeLessThan(0)
    // 切换方向只翻转符号，比较基准不变。
    expect(compareTableSortValues('张三', '李四', 'descending', 'zh-CN')).toBeLessThan(0)
  })

  it('null 无论升序降序都垫底', () => {
    expect(compareTableSortValues(null, 1, 'ascending', 'zh-CN')).toBeGreaterThan(0)
    expect(compareTableSortValues(null, 1, 'descending', 'zh-CN')).toBeGreaterThan(0)
    expect(compareTableSortValues(1, null, 'ascending', 'zh-CN')).toBeLessThan(0)
    expect(compareTableSortValues(1, null, 'descending', 'zh-CN')).toBeLessThan(0)
    expect(compareTableSortValues(null, null, 'descending', 'zh-CN')).toBe(0)
  })
})

interface Row {
  id: string
  attempts: number
  ttft: number | null
}

const accessor: TableSortAccessor<Row, 'attempts' | 'ttft'> = {
  value: (row, key) => row[key],
  tiebreak: (a, b) => a.id.localeCompare(b.id),
}

describe('applyTableSort', () => {
  const rows: Row[] = [
    { id: 'b', attempts: 5, ttft: 900 },
    { id: 'a', attempts: 5, ttft: 120 },
    { id: 'c', attempts: 9, ttft: null },
  ]

  it('不改动传进来的数组', () => {
    const original = [...rows]
    applyTableSort(rows, { key: 'attempts', direction: 'descending' }, accessor, 'zh-CN')

    expect(rows).toEqual(original)
  })

  it('取值相同的行按 tiebreak 排，次序在两次排序之间稳定', () => {
    const sorted = applyTableSort(rows, { key: 'attempts', direction: 'descending' }, accessor, 'zh-CN')

    // 请求数 5、5、9：倒序时 9 在最前，两个 5 由 id 决定先后。
    expect(sorted.map(row => row.id)).toEqual(['c', 'a', 'b'])
  })

  it('null 排在最后，即使方向是降序', () => {
    const descending = applyTableSort(rows, { key: 'ttft', direction: 'descending' }, accessor, 'zh-CN')
    expect(descending.map(row => row.id)).toEqual(['b', 'a', 'c'])

    const ascending = applyTableSort(rows, { key: 'ttft', direction: 'ascending' }, accessor, 'zh-CN')
    expect(ascending.map(row => row.id)).toEqual(['a', 'b', 'c'])
  })

  it('空表不炸', () => {
    expect(applyTableSort([], { key: 'attempts', direction: 'ascending' }, accessor, 'zh-CN')).toEqual([])
  })
})
