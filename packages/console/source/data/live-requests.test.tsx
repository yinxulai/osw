// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveRequest } from '@common/schemas'
import { LiveRequestsProvider, useLiveRequests } from './live-requests'

/*
 * 这里用的是**真的** `useResilientStream`，只把最底下那条传输换成假的：
 * Provider 自己的职责是「拿到的帧怎么进状态」，重连那部分由那个 hook 自己的测试盯着。
 *
 * 要守住的两件事：
 *
 * 1. **只有 `snapshot` 改状态**。心跳只证明连接还活着，如果它也进状态，「进行中的请求」
 *    会在空闲时被清空——那正是用户最不希望看到的。
 * 2. **`enabled` 关掉时清空**。没接流却还挂着上一页的残影，比空列表更误导。
 */

type Connection = {
  signal: AbortSignal
  emit: (message: unknown) => void
  finish: () => void
}

const streams = vi.hoisted(() => ({ requests: [] as Connection[], metrics: [] as Connection[] }))

interface ConnectOptions { signal: AbortSignal; onMessage: (message: never) => void }

/** 建一条假连接：把 `onMessage` 收下来，让用例自己决定什么时候推帧、什么时候断。 */
function connect(into: Connection[], options: ConnectOptions): Promise<void> {
  return new Promise<void>(resolve => {
    into.push({
      signal: options.signal,
      emit: message => options.onMessage(message as never),
      finish: resolve,
    })
  })
}

vi.mock('@/api/live-stream', () => ({
  readLiveRequestStream: (options: never) => connect(streams.requests, options),
  readLiveMetricsStream: (options: never) => connect(streams.metrics, options),
}))

function request(overrides: Partial<LiveRequest> = {}): LiveRequest {
  return {
    id: 'req_1',
    status: 'pending',
    phase: 'streaming',
    logicalModelId: 'logical_primary',
    clientProtocol: 'openai-responses',
    transport: 'http',
    method: 'POST',
    path: '/v1/responses',
    startedAt: 1,
    updatedAt: 1,
    endedAt: null,
    candidates: [],
    attempts: [],
    events: [],
    ...overrides,
  }
}

/** 是否接流的开关；`enabled` 在闭包里，改它再 rerender 就能驱动开关。 */
const control = { enabled: true }

interface WrapperProps { children: ReactNode }

function wrapper(props: WrapperProps) {
  return <LiveRequestsProvider enabled={control.enabled}>{props.children}</LiveRequestsProvider>
}

function mount() {
  return renderHook(() => useLiveRequests(), { wrapper })
}

/** 排干挂起的微任务，让 0 延时的重连排期落到实处。 */
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(0)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  streams.requests = []
  streams.metrics = []
  control.enabled = true
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('LiveRequestsProvider', () => {
  it('在 Provider 外使用会立刻报错，并点名该用哪个 Provider', () => {
    // React 会把这条渲染错误再往控制台吐一份，这里只关心它确实抛了。
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => renderHook(() => useLiveRequests())).toThrow('useLiveRequests must be used inside LiveRequestsProvider')
  })

  it('enabled 为真时挂上流，一开始还没有数据', () => {
    const { result } = mount()

    expect(streams.requests).toHaveLength(1)
    expect(result.current.data).toBeUndefined()
  })

  it('enabled 为假时一条连接都不挂', () => {
    control.enabled = false
    const { result } = mount()

    expect(streams.requests).toEqual([])
    expect(result.current.data).toBeUndefined()
  })

  it('快照直接成为 data', () => {
    const { result } = mount()

    act(() => streams.requests[0].emit({ type: 'snapshot', requests: [request({ id: 'req_a' }), request({ id: 'req_b' })] }))

    expect(result.current.data?.map(item => item.id)).toEqual(['req_a', 'req_b'])
  })

  it('心跳不改变 data：空闲时列表不该被清空', () => {
    const { result } = mount()

    act(() => streams.requests[0].emit({ type: 'snapshot', requests: [request()] }))
    act(() => streams.requests[0].emit({ type: 'heartbeat' }))
    act(() => streams.requests[0].emit({ type: 'heartbeat' }))

    expect(result.current.data).toHaveLength(1)
  })

  it('新快照整体替换旧快照，不是往里追加', () => {
    const { result } = mount()

    act(() => streams.requests[0].emit({ type: 'snapshot', requests: [request({ id: 'req_a' }), request({ id: 'req_b' })] }))
    act(() => streams.requests[0].emit({ type: 'snapshot', requests: [request({ id: 'req_c' })] }))

    expect(result.current.data?.map(item => item.id)).toEqual(['req_c'])
  })

  it('空快照就是空列表，而不是保留上一帧', () => {
    const { result } = mount()

    act(() => streams.requests[0].emit({ type: 'snapshot', requests: [request()] }))
    act(() => streams.requests[0].emit({ type: 'snapshot', requests: [] }))

    expect(result.current.data).toEqual([])
  })

  it('enabled 关掉时清空 data 并断开连接', () => {
    const { result, rerender } = mount()

    act(() => streams.requests[0].emit({ type: 'snapshot', requests: [request()] }))
    expect(result.current.data).toHaveLength(1)

    control.enabled = false
    rerender()

    expect(streams.requests[0].signal.aborted).toBe(true)
    // 没接流却还挂着上一页的残影，比空列表更误导。
    expect(result.current.data).toBeUndefined()
  })

  it('重新打开时另起一条连接', () => {
    const { rerender } = mount()

    control.enabled = false
    rerender()
    control.enabled = true
    rerender()

    expect(streams.requests).toHaveLength(2)
    expect(streams.requests[1].signal.aborted).toBe(false)
  })

  it('断开重连后保留上一帧，直到新快照到达', async () => {
    const { result } = mount()
    act(() => streams.requests[0].emit({ type: 'snapshot', requests: [request({ id: 'req_before' })] }))

    await act(async () => {
      streams.requests[0].finish()
    })
    await flush()

    expect(streams.requests).toHaveLength(2)
    expect(result.current.data?.map(item => item.id)).toEqual(['req_before'])

    act(() => streams.requests[1].emit({ type: 'snapshot', requests: [request({ id: 'req_after' })] }))
    expect(result.current.data?.map(item => item.id)).toEqual(['req_after'])
  })

  it('卸载时断开连接', () => {
    const { unmount } = mount()

    unmount()

    expect(streams.requests[0].signal.aborted).toBe(true)
  })
})
