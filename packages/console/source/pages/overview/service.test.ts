// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryFixture } from '@/test-support'
import { useOverviewService, useProviderAnalyticsDetail } from './service'

/*
 * 概览页的数据层。
 *
 * 三个状态位不是随手起的名，界面靠它们决定「转圈 / 覆盖层 / 空态」：
 *   - `loading` 只在**首次**没有数据时为真（后续轮询不能再把页面清空）；
 *   - `refreshing` 是「已有数据、正在后台重取」；
 *   - `error` 只在**还没拿到过数据**时给文案——有旧数据时宁可继续展示旧的，也不整页换成错误。
 */

const api = vi.hoisted(() => ({
  summary: vi.fn(),
  providerDetail: vi.fn(),
}))

vi.mock('@/api/observability', () => ({
  analyticsApi: { summary: api.summary, providerDetail: api.providerDetail },
}))

function ok(data: unknown) {
  return { success: true as const, data }
}

beforeEach(() => {
  api.summary.mockReset()
  api.providerDetail.mockReset()
  api.summary.mockResolvedValue(ok({ totalRequests: 1 }))
  api.providerDetail.mockResolvedValue(ok({ totalRequests: 2 }))
})

describe('概览汇总', () => {
  it('首屏从查询里取到数据后 loading 转为 false', async () => {
    const { wrapper } = createQueryFixture()

    const { result } = renderHook(() => useOverviewService('7d'), { wrapper })

    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual({ totalRequests: 1 })
    expect(result.current.error).toBeNull()
  })

  it('查询按范围分键并带上范围参数（切范围不该复用上一份缓存）', async () => {
    const { wrapper } = createQueryFixture()

    const { result } = renderHook(() => useOverviewService('30d'), { wrapper })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(api.summary).toHaveBeenCalledWith('30d')
  })

  it('refresh 直接透传 refetch', async () => {
    const { wrapper } = createQueryFixture()
    const { result } = renderHook(() => useOverviewService('7d'), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      void result.current.refresh()
    })

    await waitFor(() => expect(api.summary).toHaveBeenCalledTimes(2))
  })

  it('首次就失败时把错误文案交出来，数据保持 null', async () => {
    api.summary.mockResolvedValue({ success: false, errorCode: 'E', errorMessage: '表坏了' })
    const { wrapper } = createQueryFixture()

    const { result } = renderHook(() => useOverviewService('7d'), { wrapper })

    await waitFor(() => expect(result.current.error).toBe('表坏了'))
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('拿到过数据之后再失败也不报错（旧数据继续显示，页面不整屏变错误）', async () => {
    const { client, wrapper } = createQueryFixture()
    const { result } = renderHook(() => useOverviewService('7d'), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    // 模拟「后台轮询失败但数据还在」：缓存保留，查询错误同时存在。
    client.setQueryData(['analytics', '7d'], { totalRequests: 1 })
    act(() => {
      result.current.refresh()
    })

    await waitFor(() => expect(result.current.data).toEqual({ totalRequests: 1 }))
    expect(result.current.error).toBeNull()
  })
})

describe('供应商明细', () => {
  it('没有选中供应商时完全不请求（enabled 为假）', () => {
    const { wrapper } = createQueryFixture()

    renderHook(() => useProviderAnalyticsDetail(null, '7d'), { wrapper })

    expect(api.providerDetail).not.toHaveBeenCalled()
  })

  it('选中后用供应商 id 与范围请求', async () => {
    const { wrapper } = createQueryFixture()

    const { result } = renderHook(() => useProviderAnalyticsDetail('prov_primary', '30d'), { wrapper })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(api.providerDetail).toHaveBeenCalledWith('prov_primary', '30d')
    expect(result.current.data).toEqual({ totalRequests: 2 })
  })

  it('切换供应商会问新的那一个（键里带着 id）', async () => {
    const { wrapper } = createQueryFixture()

    const { result, rerender } = renderHook(({ id }) => useProviderAnalyticsDetail(id, '7d'), {
      wrapper,
      initialProps: { id: 'prov_a' },
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    rerender({ id: 'prov_b' })

    await waitFor(() => expect(api.providerDetail).toHaveBeenCalledWith('prov_b', '7d'))
  })
})
