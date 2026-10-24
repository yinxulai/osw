// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { providerModelMetricKey } from '@common/provider-model-metrics'
import { createQueryFixture } from '@/test-support'
import { EMPTY_LOGICAL_MODEL_REF, logicalModelKeys, useLogicalModelMetricsQuery, useLogicalModelModeQuery, useLogicalModelProviderModelsQuery, useSwitchManualModelMutation, useUpdateProviderModelMutation } from './queries'

/*
 * 逻辑模型页的三个查询与两个写入。
 *
 * 这一层是「两把钥匙」制度的落点，值得钉住的都是**用错了哪把钥匙**：
 *
 *   - 绑定列表和指标缓存键都用 `id`（数据记录 id）——身份不变，改了模型名也不该变成另一条缓存；
 *   - 手动锁定与请求日志按 `modelId` 问，因为运行时和日志里记的就是那个模型名；
 *   - 还没拿到逻辑模型时不能发请求（`enabled: false`），否则会用空串当 id 打上去；
 *   - 切换成功后**就地写缓存**而不是等一次往返，界面要立刻反映。
 */

const api = vi.hoisted(() => ({
  listByLogicalModel: vi.fn(),
  schedulingUpdate: vi.fn(),
  status: vi.fn(),
  switchTo: vi.fn(),
  listLogs: vi.fn(),
}))

vi.mock('@/api/models', () => ({
  providerModelApi: { listByLogicalModel: api.listByLogicalModel },
  schedulingPolicyApi: { update: api.schedulingUpdate },
}))
vi.mock('@/api/runtime', () => ({
  logicalModelRoutingApi: { status: api.status, switch: api.switchTo },
}))
vi.mock('@/api/observability', () => ({
  requestLogApi: { list: api.listLogs },
}))

const REF = { id: 'lm_primary', modelId: 'gpt-5' }

function ok(data: unknown) {
  return { success: true as const, data }
}

function reset() {
  api.listByLogicalModel.mockReset()
  api.schedulingUpdate.mockReset()
  api.status.mockReset()
  api.switchTo.mockReset()
  api.listLogs.mockReset()
}

beforeEach(() => {
  reset()
  api.listByLogicalModel.mockResolvedValue(ok([]))
  api.status.mockResolvedValue(ok({ logicalModelId: 'gpt-5', manualModelId: null }))
  api.listLogs.mockResolvedValue(ok({ logs: [], total: 0 }))
  api.schedulingUpdate.mockResolvedValue(ok({ id: 'policy_1' }))
  api.switchTo.mockResolvedValue(ok({ logicalModelId: 'gpt-5', modelId: 'pm_b' }))
})

describe('缓存键', () => {
  it('绑定列表与指标都按数据记录 id 取键（模型名可以改，身份不变）', () => {
    expect(logicalModelKeys.models('lm_primary')).toEqual(['logical-model-provider-models', 'lm_primary'])
    expect(logicalModelKeys.metrics('lm_primary')).toEqual(['logical-model-metrics', 'lm_primary'])
    expect(logicalModelKeys.mode('lm_primary')).toEqual(['logical-model-routing-mode', 'lm_primary'])
  })

  it('三类键互不相同（同一 id 不会互相覆盖）', () => {
    const keys = new Set([
      logicalModelKeys.models('lm_1').join('|'),
      logicalModelKeys.metrics('lm_1').join('|'),
      logicalModelKeys.mode('lm_1').join('|'),
    ])
    expect(keys.size).toBe(3)
  })

  it('占位引用用的是导出的同一个常量（现造字面量会让下游依赖数组每次都变）', () => {
    expect(EMPTY_LOGICAL_MODEL_REF).toEqual({ id: '', modelId: '' })
  })
})

describe('绑定列表查询', () => {
  it('按数据记录 id 拉绑定，并定期刷新（绑定会在别处被改动）', async () => {
    api.listByLogicalModel.mockResolvedValue(ok([{ id: 'pm_a' }]))
    const { wrapper } = createQueryFixture()

    const { result } = renderHook(() => useLogicalModelProviderModelsQuery(REF), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.listByLogicalModel).toHaveBeenCalledWith('lm_primary')
    expect(result.current.data).toEqual([{ id: 'pm_a' }])
    expect(result.current.data).not.toBeNull()
  })

  it('还没拿到逻辑模型时完全不发请求（空串 id 打上去只会拿到 400）', () => {
    const { wrapper } = createQueryFixture()

    const { result } = renderHook(() => useLogicalModelProviderModelsQuery(null), { wrapper })

    expect(result.current.fetchStatus).toBe('idle')
    expect(api.listByLogicalModel).not.toHaveBeenCalled()
  })

  it('接口返回失败时查询进入错误态（`unwrap` 会把 success:false 抛出来）', async () => {
    // 失败响应是平铺的：`success`/`errorCode`/`errorMessage`，没有嵌套的 `error` 对象。
    api.listByLogicalModel.mockResolvedValue({ success: false, errorCode: 'X', errorMessage: '断了' })
    const { wrapper } = createQueryFixture()

    const { result } = renderHook(() => useLogicalModelProviderModelsQuery(REF), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as Error).message).toBe('断了')
  })
})

describe('手动锁定查询', () => {
  it('按模型 id 问（运行时记的是请求里的模型名，不是数据记录 id）', async () => {
    const { wrapper } = createQueryFixture()

    const { result } = renderHook(() => useLogicalModelModeQuery(REF), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.status).toHaveBeenCalledWith('gpt-5')
    expect(result.current.data).toEqual({ logicalModelId: 'gpt-5', manualModelId: null })
  })

  it('还没拿到逻辑模型时不问', () => {
    const { wrapper } = createQueryFixture()

    renderHook(() => useLogicalModelModeQuery(null), { wrapper })

    expect(api.status).not.toHaveBeenCalled()
  })

  it('结果落在自己的缓存键上（三把钥匙互不串味）', async () => {
    const { client, wrapper } = createQueryFixture()

    const { result } = renderHook(() => useLogicalModelModeQuery(REF), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(client.getQueryData(logicalModelKeys.mode('lm_primary'))).toEqual({ logicalModelId: 'gpt-5', manualModelId: null })
  })
})

describe('指标查询', () => {
  it('请求日志按模型 id 过滤，取最近 100 条', async () => {
    const { wrapper } = createQueryFixture()

    const { result } = renderHook(() => useLogicalModelMetricsQuery(REF), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.listLogs).toHaveBeenCalledWith({ limit: 100, logicalModelId: 'gpt-5' })
    // 按「真正服务请求的模型」分组的字典，不是数组；汇总单独一份结构。
    expect(result.current.data!.modelMetrics).toEqual({})
    expect(result.current.data!.summaryMetrics).toMatchObject({ completedRequestCount: 0, successCount: 0 })
  })

  it('把日志交给真实的指标计算（按成功尝试的供应商+模型分组）', async () => {
    api.listLogs.mockResolvedValue(ok({
      logs: [{
        id: 'log_1',
        timestamp: 1_700_000_000_000,
        status: 'success',
        outputTokens: 20,
        attempts: [
          { attemptIndex: 0, status: 'failed', providerId: 'prov_old', providerModelId: 'pm_old', ttftMilliseconds: null, durationMilliseconds: 100 },
          { attemptIndex: 1, status: 'success', providerId: 'prov_primary', providerModelId: 'pm_a', ttftMilliseconds: 200, durationMilliseconds: 1_000 },
        ],
      }],
      total: 1,
    }))
    const { wrapper } = createQueryFixture()

    const { result } = renderHook(() => useLogicalModelMetricsQuery(REF), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // 键取「成功那次尝试」的模型，失败的上游不参与聚合。
    const key = providerModelMetricKey('prov_primary', 'pm_a')
    expect(Object.keys(result.current.data!.modelMetrics)).toEqual([key])
    expect(result.current.data!.modelMetrics[key]).toMatchObject({ sampleCount: 1, avgTtftMilliseconds: 200 })
    expect(result.current.data!.summaryMetrics).toMatchObject({ completedRequestCount: 1, successCount: 1, failoverCount: 1 })
  })

  it('列表为空时也给得出结构（界面照常渲染，不切空态排版）', async () => {
    const { wrapper } = createQueryFixture()

    const { result } = renderHook(() => useLogicalModelMetricsQuery(REF), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data!.modelMetrics).toEqual({})
    expect(result.current.data!.summaryMetrics.successRate).toBeNull()
  })

  it('还没拿到逻辑模型时不拉日志', () => {
    const { wrapper } = createQueryFixture()

    renderHook(() => useLogicalModelMetricsQuery(null), { wrapper })

    expect(api.listLogs).not.toHaveBeenCalled()
  })
})

describe('切换手动模型', () => {
  it('调用接口后把手动锁定写进缓存（界面立刻反映，不等下一次轮询）', async () => {
    const { client, wrapper } = createQueryFixture()
    client.setQueryData(logicalModelKeys.mode('lm_primary'), { logicalModelId: 'gpt-5', manualModelId: null })

    const { result } = renderHook(() => useSwitchManualModelMutation(REF), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('pm_b')
    })

    expect(api.switchTo).toHaveBeenCalledWith('gpt-5', 'pm_b')
    expect(client.getQueryData(logicalModelKeys.mode('lm_primary'))).toEqual({
      logicalModelId: 'gpt-5',
      manualModelId: 'pm_b',
    })
  })

  it('解锁定（传 null）也写得进去', async () => {
    api.switchTo.mockResolvedValue(ok({ logicalModelId: 'gpt-5', modelId: null }))
    const { client, wrapper } = createQueryFixture()
    client.setQueryData(logicalModelKeys.mode('lm_primary'), { logicalModelId: 'gpt-5', manualModelId: 'pm_a' })

    const { result } = renderHook(() => useSwitchManualModelMutation(REF), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(null)
    })

    expect(api.switchTo).toHaveBeenCalledWith('gpt-5', null)
    expect(client.getQueryData(logicalModelKeys.mode('lm_primary'))).toEqual({
      logicalModelId: 'gpt-5',
      manualModelId: null,
    })
  })

  it('接口失败时不写缓存（保留服务端的真实状态）', async () => {
    api.switchTo.mockResolvedValue({ success: false, errorCode: 'E', errorMessage: '不行' })
    const { client, wrapper } = createQueryFixture()
    client.setQueryData(logicalModelKeys.mode('lm_primary'), { logicalModelId: 'gpt-5', manualModelId: null })

    const { result } = renderHook(() => useSwitchManualModelMutation(REF), { wrapper })

    await expect(act(async () => {
      await result.current.mutateAsync('pm_b')
    })).rejects.toThrow()

    expect(client.getQueryData(logicalModelKeys.mode('lm_primary'))).toEqual({
      logicalModelId: 'gpt-5',
      manualModelId: null,
    })
  })
})

describe('开关某个绑定', () => {
  it('提交时带上数据记录 id 与绑定 id，成功后就地失效两处列表', async () => {
    const { client, wrapper } = createQueryFixture()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderHook(() => useUpdateProviderModelMutation(REF), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ id: 'pm_a', enabled: false })
    })

    expect(api.schedulingUpdate).toHaveBeenCalledWith({ logicalModelId: 'lm_primary', providerModelId: 'pm_a', enabled: false })
    const keys = invalidate.mock.calls.map(call => JSON.stringify((call[0] as { queryKey: unknown }).queryKey))
    expect(keys).toContain(JSON.stringify(logicalModelKeys.models('lm_primary')))
    // 「供应商模型」列表里也显示着同一个开关状态，两边都要重取。
    expect(keys).toContain(JSON.stringify(['provider-models']))
  })

  it('失败时不失效任何缓存（列表保持服务端的真实值）', async () => {
    api.schedulingUpdate.mockResolvedValue({ success: false, errorCode: 'E', errorMessage: '不行' })
    const { client, wrapper } = createQueryFixture()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderHook(() => useUpdateProviderModelMutation(REF), { wrapper })

    await expect(act(async () => {
      await result.current.mutateAsync({ id: 'pm_a', enabled: true })
    })).rejects.toThrow()

    expect(invalidate).not.toHaveBeenCalled()
  })
})
