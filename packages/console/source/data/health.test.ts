// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { HealthSnapshot } from '@common/schemas'
import { healthKeys, useHealth, useHealthActions, useHealthError, useHealthLoading } from '@/data/health'
import { createQueryFixture, providerHealth, providerModelHealth } from '@/test-support'

/*
 * 健康快照的两个约定值得钉住：
 *
 * 1. **服务端的数组在数据层就转成按 id 索引的字典**：界面每一处都要按 id 查，不收口的话
 *    每个组件各自 `find()` 一遍，请求量级一大就是 O(n²)；
 * 2. **空态必须复用同一份常量**：每次渲染新造一个 `{}`，依赖它的 memo 会一路重算。
 */

const state = vi.hoisted(() => ({
  snapshot: null as HealthSnapshot | null,
  requests: 0,
}))

vi.mock('@/api/runtime', () => ({
  healthApi: {
    list: async () => {
      state.requests += 1
      return { success: true, data: state.snapshot }
    },
  },
}))

beforeEach(() => {
  state.snapshot = null
  state.requests = 0
})

describe('useHealth', () => {
  it('把两个数组分别索引成字典', async () => {
    state.snapshot = {
      providers: [
        providerHealth({ providerId: 'prov_a', consecutiveFailures: 2 }),
        providerHealth({ providerId: 'prov_b' }),
      ],
      providerModels: [
        providerModelHealth({ providerModelId: 'pm_x', cooldownUntilTime: 1_800_000 }),
      ],
    }

    const { wrapper } = createQueryFixture()
    const { result } = renderHook(() => useHealth(), { wrapper })

    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(Object.keys(result.current.providers)).toEqual(['prov_a', 'prov_b'])
    expect(result.current.providers.prov_a.consecutiveFailures).toBe(2)
    expect(result.current.providerModels.pm_x.cooldownUntilTime).toBe(1_800_000)
  })

  it('数据没到时给的是同一份空字典：空态不该每次渲染换一个对象', () => {
    const { wrapper } = createQueryFixture()
    const first = renderHook(() => useHealth(), { wrapper })
    const second = renderHook(() => useHealth(), { wrapper })

    expect(first.result.current.providers).toEqual({})
    expect(first.result.current.providers).toBe(second.result.current.providers)
    expect(first.result.current.providerModels).toBe(second.result.current.providerModels)
  })

  it('加载态、错误态与 loaded 出自同一次查询', async () => {
    state.snapshot = { providers: [], providerModels: [] }
    const { wrapper } = createQueryFixture()
    const health = renderHook(() => useHealth(), { wrapper })
    const loading = renderHook(() => useHealthLoading(), { wrapper })
    const error = renderHook(() => useHealthError(), { wrapper })

    await waitFor(() => expect(health.result.current.loaded).toBe(true))
    expect(health.result.current.loading).toBe(false)
    expect(loading.result.current).toBe(false)
    expect(error.result.current).toBeNull()
  })
})

describe('useHealthActions', () => {
  it('refresh 重取同一份快照', async () => {
    state.snapshot = { providers: [], providerModels: [] }
    const { client, wrapper } = createQueryFixture()
    renderHook(() => useHealth(), { wrapper })
    await waitFor(() => expect(state.requests).toBe(1))

    const actions = renderHook(() => useHealthActions(), { wrapper })
    await actions.result.current.refresh()

    await waitFor(() => expect(state.requests).toBe(2))
    // 缓存里放的是服务端原样的两个数组：索引成字典是读取侧的事，
    // 换个人来读缓存不会拿到一份「已经被别人塑过形」的数据。
    expect(client.getQueryData(healthKeys.all)).toEqual({ providers: [], providerModels: [] })
  })
})
