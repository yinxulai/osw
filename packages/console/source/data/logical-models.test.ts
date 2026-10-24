// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LogicalModel } from '@common/schemas'
import { logicalModelKeys, useDeletedLogicalModelIds, useLogicalModels, useLogicalModelsActions, useLogicalModelsError, useLogicalModelsLoading } from '@/data/logical-models'
import { createQueryFixture, logicalModel } from '@/test-support'

/*
 * 逻辑模型数据层与供应商那层同构，唯一值得单独钉住的是**「删掉的模型名」用什么当键**：
 * 统计里记的是 `modelId`（模型名），不是记录 id。用错这一格，「这一行已经删了」永远标不出来。
 */

const state = vi.hoisted(() => ({
  active: [] as LogicalModel[],
  includingDeleted: [] as LogicalModel[],
  requests: 0,
  failReorder: null as Error | null,
  reorderPayloads: [] as string[][],
}))

vi.mock('@/api/models', () => ({
  logicalModelApi: {
    list: async () => {
      state.requests += 1
      return { success: true, data: state.active }
    },
    listIncludingDeleted: async () => ({ success: true, data: state.includingDeleted }),
    reorder: async (ids: string[]) => {
      state.reorderPayloads.push(ids)
      if (state.failReorder) throw state.failReorder
      return { success: true, data: [] }
    },
  },
}))

beforeEach(() => {
  state.active = []
  state.includingDeleted = []
  state.requests = 0
  state.failReorder = null
  state.reorderPayloads = []
})

describe('useLogicalModels', () => {
  it('空态复用同一个数组', () => {
    const { wrapper } = createQueryFixture()
    const first = renderHook(() => useLogicalModels(), { wrapper })
    const second = renderHook(() => useLogicalModels(), { wrapper })

    expect(first.result.current).toEqual([])
    expect(first.result.current).toBe(second.result.current)
  })

  it('加载态与错误态出自同一次查询', async () => {
    state.active = [logicalModel()]
    const { wrapper } = createQueryFixture()
    const loading = renderHook(() => useLogicalModelsLoading(), { wrapper })
    const error = renderHook(() => useLogicalModelsError(), { wrapper })

    await waitFor(() => expect(loading.result.current).toBe(false))
    expect(error.result.current).toBeNull()
  })
})

describe('useDeletedLogicalModelIds', () => {
  it('键是 modelId 而不是记录 id', async () => {
    state.includingDeleted = [
      logicalModel({ id: 'lm_live', modelId: 'gpt-5', deletedTime: null }),
      logicalModel({ id: 'lm_gone', modelId: 'claude-4', deletedTime: 1_700_000 }),
    ]
    const { wrapper } = createQueryFixture()
    const { result } = renderHook(() => useDeletedLogicalModelIds(), { wrapper })

    await waitFor(() => expect(result.current.size).toBe(1))
    expect(result.current.has('claude-4')).toBe(true)
    // 记录 id 不该出现在这份名单里：界面拿它去比对请求日志上的模型名，永远比不中。
    expect(result.current.has('lm_gone')).toBe(false)
  })

  it('没有数据时是一个空集合', () => {
    const { wrapper } = createQueryFixture()
    expect(renderHook(() => useDeletedLogicalModelIds(), { wrapper }).result.current.size).toBe(0)
  })

  it('与活跃列表分开缓存', async () => {
    state.active = [logicalModel({ id: 'lm_live' })]
    state.includingDeleted = [logicalModel({ id: 'lm_live' }), logicalModel({ id: 'lm_gone', modelId: 'gone', deletedTime: 1 })]

    const { client, wrapper } = createQueryFixture()
    renderHook(() => useLogicalModels(), { wrapper })
    renderHook(() => useDeletedLogicalModelIds(), { wrapper })

    await waitFor(() => {
      expect(client.getQueryData(logicalModelKeys.all)).toHaveLength(1)
      expect(client.getQueryData(logicalModelKeys.withDeleted)).toHaveLength(2)
    })
  })
})

describe('useLogicalModelsActions', () => {
  it('refresh 让活跃列表重新取一次', async () => {
    state.active = [logicalModel()]
    const { wrapper } = createQueryFixture()
    const list = renderHook(() => useLogicalModels(), { wrapper })
    const actions = renderHook(() => useLogicalModelsActions(), { wrapper })

    await waitFor(() => expect(list.result.current).toHaveLength(1))
    await act(async () => actions.result.current.refresh())
    await waitFor(() => expect(state.requests).toBe(2))
  })

  it('排序先改本地再发请求', async () => {
    state.active = [logicalModel({ id: 'lm_a', modelId: 'a' }), logicalModel({ id: 'lm_b', modelId: 'b' })]
    const { client, wrapper } = createQueryFixture()
    const list = renderHook(() => useLogicalModels(), { wrapper })
    await waitFor(() => expect(list.result.current).toHaveLength(2))

    const actions = renderHook(() => useLogicalModelsActions(), { wrapper })
    await act(async () => actions.result.current.reorder(['lm_b', 'lm_a']))

    expect(state.reorderPayloads).toEqual([['lm_b', 'lm_a']])
    expect((client.getQueryData(logicalModelKeys.all) as LogicalModel[]).map(item => item.id)).toEqual(['lm_b', 'lm_a'])
  })

  it('失败时回滚并抛错', async () => {
    state.active = [logicalModel({ id: 'lm_a' }), logicalModel({ id: 'lm_b' })]
    const { client, wrapper } = createQueryFixture()
    const list = renderHook(() => useLogicalModels(), { wrapper })
    await waitFor(() => expect(list.result.current).toHaveLength(2))

    state.failReorder = new Error('boom')
    const actions = renderHook(() => useLogicalModelsActions(), { wrapper })

    await act(async () => {
      await expect(actions.result.current.reorder(['lm_b', 'lm_a'])).rejects.toThrow('boom')
    })
    expect((client.getQueryData(logicalModelKeys.all) as LogicalModel[]).map(item => item.id)).toEqual(['lm_a', 'lm_b'])
  })

  it('本地没有列表时不写缓存', async () => {
    const { client, wrapper } = createQueryFixture()
    const actions = renderHook(() => useLogicalModelsActions(), { wrapper })

    await act(async () => actions.result.current.reorder(['lm_a']))
    expect(client.getQueryData(logicalModelKeys.all)).toBeUndefined()
  })
})
