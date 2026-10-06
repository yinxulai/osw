// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProxyServerStatus } from '@common/schemas'
import { proxyKeys, useProxy, useProxyActions, useProxyError, useProxyLoading, useProxyStatus } from '@/data/proxy'
import { createQueryFixture } from '@/test-support'

/*
 * 代理开关的启动 / 停止 / 重启走的是同一条「命令」路径：**成功就把服务端返回的状态写回缓存**，
 * 失败则原样把失败信封交给调用方（由它决定弹什么）。这一条以前分开写过，容易漏掉某一支。
 */

const state = vi.hoisted(() => ({
  status: { running: false, host: '127.0.0.1', port: 9300 } as ProxyServerStatus,
  stopResult: null as unknown,
  calls: [] as string[],
}))

vi.mock('@/api/runtime', () => ({
  proxyApi: {
    status: async () => {
      state.calls.push('status')
      return { success: true, data: state.status }
    },
    start: async () => {
      state.calls.push('start')
      return { success: true, data: { ...state.status, running: true } }
    },
    stop: async () => {
      state.calls.push('stop')
      if (state.stopResult) return state.stopResult
      return { success: true, data: { ...state.status, running: false } }
    },
    restart: async () => {
      state.calls.push('restart')
      return { success: true, data: { ...state.status, running: true, port: 9400 } }
    },
  },
}))

beforeEach(() => {
  state.status = { running: false, host: '127.0.0.1', port: 9300 }
  state.stopResult = null
  state.calls = []
})

async function mountProxy() {
  const fixture = createQueryFixture()
  const view = renderHook(() => useProxy(), { wrapper: fixture.wrapper })
  const actions = renderHook(() => useProxyActions(), { wrapper: fixture.wrapper })
  await waitFor(() => expect(view.result.current).not.toBeNull())
  return { ...fixture, view, actions }
}

describe('useProxy', () => {
  it('数据没到时是 null，而不是收口成一个假状态', () => {
    const { wrapper } = createQueryFixture()
    expect(renderHook(() => useProxy(), { wrapper }).result.current).toBeNull()
  })

  it('useProxyStatus 与 useProxy 是同一份数据', async () => {
    const { wrapper } = createQueryFixture()
    const status = renderHook(() => useProxyStatus(), { wrapper })
    await waitFor(() => expect(status.result.current).toEqual({ running: false, host: '127.0.0.1', port: 9300 }))
  })

  it('加载态与错误态出自同一次查询', async () => {
    const { wrapper } = createQueryFixture()
    const loading = renderHook(() => useProxyLoading(), { wrapper })
    const error = renderHook(() => useProxyError(), { wrapper })

    await waitFor(() => expect(loading.result.current).toBe(false))
    expect(error.result.current).toBeNull()
  })
})

describe('useProxyActions', () => {
  it('start 成功后把新状态写回缓存，调用方不用再拉一次', async () => {
    const { client, actions } = await mountProxy()

    await act(async () => actions.result.current.start())

    expect(state.calls).toContain('start')
    expect((client.getQueryData(proxyKeys.status) as ProxyServerStatus).running).toBe(true)
  })

  it('restart 带回的新端口同样写回缓存', async () => {
    const { client, actions } = await mountProxy()

    await act(async () => actions.result.current.restart())

    expect((client.getQueryData(proxyKeys.status) as ProxyServerStatus).port).toBe(9400)
  })

  it('失败时不动缓存，把失败信封原样交给调用方', async () => {
    const { client, actions } = await mountProxy()
    state.stopResult = { success: false, errorCode: 'PROXY_NOT_RUNNING', errorMessage: 'proxy is not running' }

    let result: unknown = null
    await act(async () => {
      result = await actions.result.current.stop()
    })

    expect(result).toMatchObject({ success: false, errorCode: 'PROXY_NOT_RUNNING' })
    // 请求前的状态原封不动：失败不该让界面上的开关先跳一下再跳回来。
    expect((client.getQueryData(proxyKeys.status) as ProxyServerStatus).running).toBe(false)
  })

  it('refresh 让状态重新取一次', async () => {
    const { actions } = await mountProxy()
    state.calls = []

    await act(async () => actions.result.current.refresh())

    await waitFor(() => expect(state.calls).toContain('status'))
  })
})
