// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Provider } from '@common/schemas'
import { providerKeys, useDeletedProviderIds, useProviders, useProvidersActions, useProvidersError, useProvidersLoading } from '@/data/providers'
import { createQueryFixture, provider } from '@/test-support'

/*
 * 这一组盯的是供应商数据层对外承诺的三件事：
 *
 * 1. **缓存键是契约**：`withDeleted` 与活跃列表分开，各处乐观写入不会污染「谁被删了」；
 * 2. **空态不是新对象**：还没拿到数据时要复用同一个空数组，否则每次渲染一个新引用，
 *    依赖它的 `useMemo` / `useEffect` 全部跟着重跑；
 * 3. **乐观排序要能回滚**：拖动失败之后列表必须回到请求前的顺序，而不是停在拖动后的样子。
 */

const state = vi.hoisted(() => ({
  active: [] as Provider[],
  includingDeleted: [] as Provider[],
  activeRequests: 0,
  failReorder: null as Error | null,
  reorderPayloads: [] as string[][],
}))

vi.mock('@/api/providers', () => ({
  providerApi: {
    list: async () => {
      state.activeRequests += 1
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
  state.activeRequests = 0
  state.failReorder = null
  state.reorderPayloads = []
})

describe('useProviders', () => {
  it('还没拿到数据时返回同一个空数组，而不是每次渲染新建一个', () => {
    const { wrapper } = createQueryFixture()
    const first = renderHook(() => useProviders(), { wrapper })
    const second = renderHook(() => useProviders(), { wrapper })

    const a = first.result.current
    const b = second.result.current
    expect(a).toEqual([])
    // 同一个模块级常量：两个 hook、不同实例之间是同一个引用。
    expect(a).toBe(b)
  })

  it('拿到数据后原样给出服务端顺序', async () => {
    state.active = [provider({ id: 'prov_a', name: 'A' }), provider({ id: 'prov_b', name: 'B' })]
    const { wrapper } = createQueryFixture()
    const { result } = renderHook(() => useProviders(), { wrapper })

    await waitFor(() => expect(result.current).toHaveLength(2))
    expect(result.current.map(item => item.id)).toEqual(['prov_a', 'prov_b'])
  })

  it('加载态与错误态各自出自同一次查询', async () => {
    state.active = [provider()]
    const { wrapper } = createQueryFixture()
    const loading = renderHook(() => useProvidersLoading(), { wrapper })
    const error = renderHook(() => useProvidersError(), { wrapper })

    await waitFor(() => expect(loading.result.current).toBe(false))
    expect(error.result.current).toBeNull()
  })
})

describe('useDeletedProviderIds', () => {
  it('只收软删除的行，且用 modelId 之外的记录 id 作键', async () => {
    state.includingDeleted = [
      provider({ id: 'prov_live', deletedTime: null }),
      provider({ id: 'prov_gone', deletedTime: 1_700_000 }),
    ]
    const { wrapper } = createQueryFixture()
    const { result } = renderHook(() => useDeletedProviderIds(), { wrapper })

    await waitFor(() => expect(result.current.size).toBe(1))
    expect(result.current.has('prov_gone')).toBe(true)
    expect(result.current.has('prov_live')).toBe(false)
  })

  it('空名单也是一个集合而不是 undefined：调用方用 has() 不需要先判空', () => {
    const { wrapper } = createQueryFixture()
    const { result } = renderHook(() => useDeletedProviderIds(), { wrapper })

    expect(result.current).toBeInstanceOf(Set)
    expect(result.current.size).toBe(0)
  })

  it('与活跃列表分开缓存：两者是不同的查询键，各自取自己的接口', async () => {
    state.active = [provider({ id: 'prov_live' })]
    state.includingDeleted = [provider({ id: 'prov_live' }), provider({ id: 'prov_gone', deletedTime: 1 })]

    const { client, wrapper } = createQueryFixture()
    renderHook(() => useProviders(), { wrapper })
    renderHook(() => useDeletedProviderIds(), { wrapper })

    await waitFor(() => {
      expect(client.getQueryData(providerKeys.all)).toHaveLength(1)
      expect(client.getQueryData(providerKeys.withDeleted)).toHaveLength(2)
    })
  })
})

describe('useProvidersActions', () => {
  it('refresh 让活跃列表重新取一次', async () => {
    state.active = [provider()]
    const { wrapper } = createQueryFixture()
    // 得有一个观察者挂在列表上：`invalidateQueries` 只重取「有人在看」的查询，
    // 页面里这两个 hook 也确实是同时挂着的。
    const list = renderHook(() => useProviders(), { wrapper })
    const { result } = renderHook(() => useProvidersActions(), { wrapper })

    await waitFor(() => expect(list.result.current).toHaveLength(1))
    await act(async () => result.current.refresh())
    await waitFor(() => expect(state.activeRequests).toBe(2))
  })

  it('排序先改本地再发请求：拖动不必等一个来回', async () => {
    state.active = [provider({ id: 'prov_a' }), provider({ id: 'prov_b' }), provider({ id: 'prov_c' })]
    const { client, wrapper } = createQueryFixture()
    const list = renderHook(() => useProviders(), { wrapper })
    await waitFor(() => expect(list.result.current).toHaveLength(3))

    const actions = renderHook(() => useProvidersActions(), { wrapper })
    await act(async () => actions.result.current.reorder(['prov_c', 'prov_a', 'prov_b']))

    expect(state.reorderPayloads).toEqual([['prov_c', 'prov_a', 'prov_b']])
    expect((client.getQueryData(providerKeys.all) as Provider[]).map(item => item.id)).toEqual(['prov_c', 'prov_a', 'prov_b'])
  })

  it('没被拖到的供应商按原顺序补在后面：一次拖动不会让列表变短', async () => {
    state.active = [provider({ id: 'prov_a' }), provider({ id: 'prov_b' }), provider({ id: 'prov_c' })]
    const { client, wrapper } = createQueryFixture()
    const list = renderHook(() => useProviders(), { wrapper })
    await waitFor(() => expect(list.result.current).toHaveLength(3))

    const actions = renderHook(() => useProvidersActions(), { wrapper })
    await act(async () => actions.result.current.reorder(['prov_c']))

    expect((client.getQueryData(providerKeys.all) as Provider[]).map(item => item.id)).toEqual(['prov_c', 'prov_a', 'prov_b'])
  })

  it('接口失败时回滚到请求前的顺序，并把错误抛给调用方', async () => {
    state.active = [provider({ id: 'prov_a' }), provider({ id: 'prov_b' })]
    const { client, wrapper } = createQueryFixture()
    const list = renderHook(() => useProviders(), { wrapper })
    await waitFor(() => expect(list.result.current).toHaveLength(2))

    state.failReorder = new Error('reorder failed')
    const actions = renderHook(() => useProvidersActions(), { wrapper })

    await act(async () => {
      await expect(actions.result.current.reorder(['prov_b', 'prov_a'])).rejects.toThrow('reorder failed')
    })
    expect((client.getQueryData(providerKeys.all) as Provider[]).map(item => item.id)).toEqual(['prov_a', 'prov_b'])
  })

  it('本地还没有列表时不写缓存，也不因为在无列表时失败而报错回滚', async () => {
    const { client, wrapper } = createQueryFixture()
    const actions = renderHook(() => useProvidersActions(), { wrapper })

    // 没挂过列表 hook 就没有缓存可言：这种情况下只是老老实实发一次请求。
    await act(async () => actions.result.current.reorder(['prov_a']))
    expect(state.reorderPayloads).toEqual([['prov_a']])
    expect(client.getQueryData(providerKeys.all)).toBeUndefined()
  })
})
