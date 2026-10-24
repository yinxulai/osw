// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLogicalModelMetrics } from './use-logical-model-metrics'

/*
 * 逻辑模型的运行指标。
 *
 * 这里没有多少逻辑，但有一件容易被忽略的事：数据没到的时候返回的空表必须是**同一个对象**。
 * 每次渲染现造一个 `{}` 会让下游凡是「指标变了就重算」的 `useMemo` / `useEffect` 每帧都白跑。
 */

const state = vi.hoisted(() => ({
  data: undefined as undefined | { modelMetrics: Record<string, unknown>; summaryMetrics: unknown },
  refetch: vi.fn(),
  refSeen: undefined as unknown,
}))

vi.mock('../queries', () => ({
  useLogicalModelMetricsQuery: (ref: unknown) => {
    state.refSeen = ref
    return { data: state.data, refetch: state.refetch }
  },
}))

const REF = { id: 'lm_primary', modelId: 'gpt-5' }

beforeEach(() => {
  state.data = undefined
  state.refetch.mockReset()
  state.refetch.mockResolvedValue(undefined)
  state.refSeen = undefined
})

describe('数据未就绪', () => {
  it('空表是复用的常量，不是每帧现造的新对象', () => {
    const view = renderHook(() => useLogicalModelMetrics(REF))
    const first = view.result.current.modelMetrics
    expect(first).toEqual({})

    // 强制重渲染后再读一次：同一个引用才算复用。
    view.rerender()
    expect(view.result.current.modelMetrics).toBe(first)
  })

  it('汇总指标保持未定义，让界面自己决定是「还没算」还是「算出来是空」', () => {
    const { result } = renderHook(() => useLogicalModelMetrics(REF))

    expect(result.current.summaryMetrics).toBeUndefined()
  })

  it('未就绪时也照样把引用交给查询（由查询自己的 enabled 决定开不开火）', () => {
    renderHook(() => useLogicalModelMetrics(null))

    expect(state.refSeen).toBeNull()
  })
})

describe('数据到达', () => {
  it('把查询结果原样分成「按模型」与「汇总」两份', () => {
    state.data = { modelMetrics: { pm_a: { requestCount: 3 } }, summaryMetrics: { completedRequestCount: 3 } }
    const { result } = renderHook(() => useLogicalModelMetrics(REF))

    expect(result.current.modelMetrics).toEqual({ pm_a: { requestCount: 3 } })
    expect(result.current.summaryMetrics).toEqual({ completedRequestCount: 3 })
  })

  it('汇总为空对象时也照原样返回（不做「空就算没算」的猜测）', () => {
    state.data = { modelMetrics: {}, summaryMetrics: { completedRequestCount: 0, successRate: null } }
    const { result } = renderHook(() => useLogicalModelMetrics(REF))

    expect(result.current.summaryMetrics).toEqual({ completedRequestCount: 0, successRate: null })
  })
})

describe('刷新', () => {
  it('refresh 直接透传查询的 refetch', async () => {
    const { result } = renderHook(() => useLogicalModelMetrics(REF))

    await result.current.refresh()

    expect(state.refetch).toHaveBeenCalledTimes(1)
  })
})
