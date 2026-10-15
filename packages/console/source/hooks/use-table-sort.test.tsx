// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { useTableSort } from './use-table-sort'
import type { TableSortAccessor } from '@/lib/table-sort'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

interface Row {
  id: string
  attempts: number
}

/** renderHook 的入参：多参数函数的包装只在这一处出现，给个名字免得每处重复写匿名对象类型。 */
interface RowsProps {
  rows: Row[]
}

const accessor: TableSortAccessor<Row, 'attempts'> = {
  value: row => row.attempts,
  tiebreak: (a, b) => a.id.localeCompare(b.id),
}

const directions = { attempts: 'descending' } as const

/** `renderHook` 的 `wrapper`：对象参数只在这一个函数上，给个名字即可。 */
interface WrapperProps {
  children: ReactNode
}

function wrapper(props: WrapperProps): ReactNode {
  return <I18nProvider>{props.children}</I18nProvider>
}

const rows: Row[] = [
  { id: 'a', attempts: 1 },
  { id: 'b', attempts: 3 },
  { id: 'c', attempts: 2 },
]

beforeEach(() => {
  useLanguageStore.setState({ preference: 'zh-CN' })
})

/*
 * 排序状态挂在组件上，数据仍由调用方持有——页面每 15s 轮询一次，
 * 所以这里要守住的是「新数据进来时排序跟着新数据走」，而不是「排完序就留住副本」。
 */
describe('useTableSort', () => {
  it('初始状态就是传进来的默认排序', () => {
    const { result } = renderHook(() => useTableSort(rows, { key: 'attempts', direction: 'descending' }, accessor, directions), { wrapper })

    expect(result.current.sort).toEqual({ key: 'attempts', direction: 'descending' })
    expect(result.current.sortedRows.map(row => row.id)).toEqual(['b', 'c', 'a'])
  })

  it('点表头翻转方向，排序结果跟着反过来', () => {
    const { result } = renderHook(() => useTableSort(rows, { key: 'attempts', direction: 'descending' }, accessor, directions), { wrapper })

    act(() => result.current.toggleSort('attempts'))

    expect(result.current.sort.direction).toBe('ascending')
    expect(result.current.sortedRows.map(row => row.id)).toEqual(['a', 'c', 'b'])
  })

  it('数据换了（轮询到新一批）时用新的数据重排，不保留旧副本', () => {
    const { result, rerender } = renderHook(
      (props: RowsProps) => useTableSort(props.rows, { key: 'attempts', direction: 'descending' }, accessor, directions),
      { wrapper, initialProps: { rows } },
    )

    const next = [{ id: 'z', attempts: 9 }]
    rerender({ rows: next })

    expect(result.current.sortedRows.map(row => row.id)).toEqual(['z'])
  })
})
