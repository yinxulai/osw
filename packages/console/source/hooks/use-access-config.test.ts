// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccessConfig } from './use-access-config'

/*
 * 这一组返回的是「客户端怎么连上本机服务」的几个事实，引导页与客户端配置页共用。
 *
 * 最容易错的是通配地址：`0.0.0.0` 是**监听**地址，不是**可连接**地址，直接拿去拼
 * Base URL 会得到一个谁也连不上的字符串。回落逻辑在 `@common/proxy-origin` 里，
 * 这里验证它确实被用上、且拼不出来时给的是空串而不是半个地址。
 *
 * 两个数据源都在外面：`useProxyStatus` 是 react-query 查询，`useProxyToggle` 会弹 toast，
 * 它们各自有自己的测试，这里只关心「状态 → 地址」这一步。
 */

const state = vi.hoisted(() => ({
  status: null as { host: string; port: number; running: boolean } | null,
  toggleProxy: vi.fn(),
}))

vi.mock('@/data/proxy', () => ({ useProxyStatus: () => state.status }))
vi.mock('@/pages/logical-models/hooks/use-proxy-toggle', () => ({ useProxyToggle: () => ({ toggleProxy: state.toggleProxy }) }))

beforeEach(() => {
  state.status = null
  state.toggleProxy.mockReset()
})

describe('useAccessConfig', () => {
  it('状态还没到时：host 空、port 未知、未运行、地址为空串', () => {
    const { result } = renderHook(() => useAccessConfig())

    expect(result.current.host).toBe('')
    expect(result.current.port).toBeNull()
    expect(result.current.running).toBe(false)
    expect(result.current.wildcardHost).toBe(false)
    // 空串是给复制按钮判「禁用」用的，不是半个地址。
    expect(result.current.origin).toBe('')
  })

  it('正常监听地址直接可用', () => {
    state.status = { host: '127.0.0.1', port: 19_300, running: true }

    const { result } = renderHook(() => useAccessConfig())

    expect(result.current.origin).toBe('http://127.0.0.1:19300')
    expect(result.current.running).toBe(true)
    expect(result.current.wildcardHost).toBe(false)
  })

  it('通配地址回落到 127.0.0.1，并告诉调用方这是通配', () => {
    state.status = { host: '0.0.0.0', port: 19_300, running: true }

    const { result } = renderHook(() => useAccessConfig())

    // 回落后的地址才是客户端能连的；`wildcardHost` 让卡片能顺带说明一句。
    expect(result.current.origin).toBe('http://127.0.0.1:19300')
    expect(result.current.wildcardHost).toBe(true)
  })

  it('IPv6 通配地址同样回落，并且不带方括号也认得出', () => {
    state.status = { host: '::', port: 19_300, running: true }

    const { result } = renderHook(() => useAccessConfig())

    expect(result.current.wildcardHost).toBe(true)
    expect(result.current.origin).toBe('http://127.0.0.1:19300')
  })

  it('IPv6 具体地址补方括号，否则端口会被当成地址的一部分', () => {
    state.status = { host: '::1', port: 19_300, running: true }

    const { result } = renderHook(() => useAccessConfig())

    expect(result.current.origin).toBe('http://[::1]:19300')
    expect(result.current.wildcardHost).toBe(false)
  })

  it('host 有但 port 还没起来时拼不出地址，origin 为空串', () => {
    state.status = { host: '127.0.0.1', port: 0, running: false }

    const { result } = renderHook(() => useAccessConfig())

    // 宁可让调用方禁用按钮，也不要拼出 `http://127.0.0.1:0` 这种能复制但连不上的地址。
    expect(result.current.origin).toBe('')
    expect(result.current.port).toBe(0)
  })

  it('切换开关直接透传出去，不在这一层包一层语义', () => {
    const { result } = renderHook(() => useAccessConfig())

    result.current.toggleProxy()

    expect(state.toggleProxy).toHaveBeenCalledTimes(1)
  })
})
