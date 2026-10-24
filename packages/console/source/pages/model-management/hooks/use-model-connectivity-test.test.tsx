// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useModelConnectivityTest } from './use-model-connectivity-test'

/*
 * 「保存前先测一下」这个动作的客户端编排。
 *
 * 盯三件事：
 * 1. 发出去的是**表单里的草稿值**，不是数据库里的行——这正是这个按钮存在的理由；
 * 2. 超时不能被说成「被取消」——那是我们自己的计时器造的假错误，用户照它去排查会白跑；
 * 3. 部分通 != 整体失败。三个协议通了两个，用户要看见的是哪一个没过。
 */

const state = vi.hoisted(() => ({
  payloads: [] as Array<Record<string, unknown>>,
  responses: [] as Array<Record<string, unknown>>,
  /** 每次调用按序取一个；取完了就一直用最后一个。 */
  abortedFlags: [] as boolean[],
}))

vi.mock('@/api/tools', () => ({
  modelConnectivityApi: {
    test: async (payload: Record<string, unknown>, signal?: AbortSignal) => {
      state.payloads.push(payload)
      const index = Math.min(state.payloads.length - 1, state.responses.length - 1)
      const response = state.responses[index] ?? { success: false, errorCode: 'UNKNOWN', errorMessage: 'no stub' }
      if (signal) state.abortedFlags.push(signal.aborted)
      return response
    },
  },
}))

// 错误码本地化不是被测对象：回显码本身，好断言「拿到的是码不是英文原文」。
vi.mock('@/api/errors', () => ({
  localizeErrorCode: (errorCode: string, diagnosticMessage: string) => errorCode ? `localized:${errorCode}` : diagnosticMessage,
}))

vi.mock('@/i18n/provider', () => ({ useTranslation: () => (key: string) => key }))

const TARGETS = [
  { protocol: 'openai-completions' as const, endpointUrl: '' },
  { protocol: 'anthropic-messages' as const, endpointUrl: 'https://mirror.example.com/v1/messages' },
]

function stubResults(...results: Array<Record<string, unknown>>) {
  state.responses = [{ success: true, data: { results } }]
}

beforeEach(() => {
  state.payloads.length = 0
  state.responses.length = 0
  state.abortedFlags.length = 0
})

describe('useModelConnectivityTest', () => {
  it('初始什么都不展示', () => {
    const view = renderHook(() => useModelConnectivityTest())
    expect(view.result.current.status).toBe('idle')
    expect(view.result.current.results).toEqual([])
  })

  it('把草稿值原样发给服务端：模型名与每个启用协议各自的地址', async () => {
    stubResults({ protocol: 'openai-completions', endpointUrl: null, success: true, durationMilliseconds: 3 })
    const view = renderHook(() => useModelConnectivityTest())

    await act(async () => { await view.result.current.run('prov_1', 'gpt-4o-draft', TARGETS) })

    expect(state.payloads).toEqual([{
      providerId: 'prov_1',
      modelName: 'gpt-4o-draft',
      endpoints: [
        { protocol: 'openai-completions', endpointUrl: '' },
        { protocol: 'anthropic-messages', endpointUrl: 'https://mirror.example.com/v1/messages' },
      ],
    }])
  })

  it('全部通过时状态是成功', async () => {
    stubResults(
      { protocol: 'openai-completions', endpointUrl: 'https://a.example.com', success: true, statusCode: 200, durationMilliseconds: 12 },
      { protocol: 'anthropic-messages', endpointUrl: 'https://b.example.com', success: true, statusCode: 200, durationMilliseconds: 20 },
    )
    const view = renderHook(() => useModelConnectivityTest())

    await act(async () => { await view.result.current.run('prov_1', 'gpt-4o', TARGETS) })

    expect(view.result.current.status).toBe('success')
    expect(view.result.current.results).toHaveLength(2)
  })

  it('部分通过也算成功：逐行说清哪一个没过，而不是一句「测试失败」把好的一起否掉', async () => {
    stubResults(
      { protocol: 'openai-completions', endpointUrl: 'https://a.example.com', success: true, statusCode: 200, durationMilliseconds: 12 },
      { protocol: 'anthropic-messages', endpointUrl: 'https://b.example.com', success: false, statusCode: 401, durationMilliseconds: 30, errorCode: 'UPSTREAM_AUTH_FAILED', errorMessage: 'invalid key' },
    )
    const view = renderHook(() => useModelConnectivityTest())

    await act(async () => { await view.result.current.run('prov_1', 'gpt-4o', TARGETS) })

    expect(view.result.current.status).toBe('success')
    expect(view.result.current.results[0].success).toBe(true)
    expect(view.result.current.results[1]).toMatchObject({ success: false, errorMessage: 'localized:UPSTREAM_AUTH_FAILED' })
    expect(view.result.current.errorMessage).toBeUndefined()
  })

  it('一行都没通时才是失败', async () => {
    stubResults(
      { protocol: 'openai-completions', endpointUrl: null, success: false, durationMilliseconds: 1, errorCode: 'ENDPOINT_URL_MISSING', errorMessage: 'no url' },
      { protocol: 'anthropic-messages', endpointUrl: null, success: false, durationMilliseconds: 1, errorCode: 'ENDPOINT_URL_MISSING', errorMessage: 'no url' },
    )
    const view = renderHook(() => useModelConnectivityTest())

    await act(async () => { await view.result.current.run('prov_1', 'gpt-4o', TARGETS) })

    expect(view.result.current.status).toBe('error')
  })

  it('没有可用的错误码时回到英文原文，而不是编一句「未知错误」', async () => {
    stubResults({ protocol: 'openai-completions', endpointUrl: 'https://a.example.com', success: false, statusCode: 400, durationMilliseconds: 8, errorMessage: 'model does not exist' })
    const view = renderHook(() => useModelConnectivityTest())

    await act(async () => { await view.result.current.run('prov_1', 'nope', TARGETS) })

    // 上游原话比我们编的句子准确：它说了是哪一个字段不对。
    expect(view.result.current.results[0].errorMessage).toBe('model does not exist')
  })

  it('请求整体失败时给一条界面文案', async () => {
    state.responses = [{ success: false, errorCode: 'NOT_FOUND', errorMessage: 'Provider not found: prov_x' }]
    const view = renderHook(() => useModelConnectivityTest())

    await act(async () => { await view.result.current.run('prov_x', 'gpt-4o', TARGETS) })

    expect(view.result.current.status).toBe('error')
    expect(view.result.current.errorMessage).toBe('localized:NOT_FOUND')
    expect(view.result.current.results).toEqual([])
  })

  it('结果里逐行错误已就地本地化，渲染那层不用分辨两种来源', async () => {
    stubResults({ protocol: 'openai-completions', endpointUrl: null, success: false, durationMilliseconds: 1, errorCode: 'UPSTREAM_TIMEOUT', errorMessage: 'Connection timeout' })
    const view = renderHook(() => useModelConnectivityTest())

    await act(async () => { await view.result.current.run('prov_1', 'gpt-4o', TARGETS) })

    expect(view.result.current.results[0].errorMessage).toBe('localized:UPSTREAM_TIMEOUT')
  })

  it('reset 把结果清干净，好让下一次打开是白纸', async () => {
    stubResults({ protocol: 'openai-completions', endpointUrl: 'https://a.example.com', success: true, statusCode: 200, durationMilliseconds: 4 })
    const view = renderHook(() => useModelConnectivityTest())

    await act(async () => { await view.result.current.run('prov_1', 'gpt-4o', TARGETS) })
    expect(view.result.current.status).toBe('success')

    act(() => { view.result.current.reset() })
    expect(view.result.current.status).toBe('idle')
    expect(view.result.current.results).toEqual([])
  })
})
