// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveMetrics } from '@common/live-metrics'
import { LiveMetricsProvider, useLiveMetrics } from './live-metrics'

/*
 * 与「进行中的请求」同构（见 `live-requests.test.tsx`），区别只在数据源：
 * 这条读的是菜单栏标题用的**同一份**标准指标。所以这里重点验证「同一份数、两块画布」
 * 这件事在客户端也成立——Provider 不许对指标做二次加工，`data` 就是服务端算好的那一份。
 *
 * 同样用真的 `useResilientStream`，只把最底下那条传输换成假的。
 */

type Connection = {
  signal: AbortSignal
  emit: (message: unknown) => void
  finish: () => void
}

const streams = vi.hoisted(() => ({ requests: [] as Connection[], metrics: [] as Connection[] }))

interface ConnectOptions { signal: AbortSignal; onMessage: (message: never) => void }

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

function metrics(overrides: Partial<LiveMetrics> = {}): LiveMetrics {
  return { liveTps: 42.5, activeRequests: 2, ...overrides }
}

const control = { enabled: true }

interface WrapperProps { children: ReactNode }

function wrapper(props: WrapperProps) {
  return <LiveMetricsProvider enabled={control.enabled}>{props.children}</LiveMetricsProvider>
}

function mount() {
  return renderHook(() => useLiveMetrics(), { wrapper })
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

describe('LiveMetricsProvider', () => {
  it('在 Provider 外使用会立刻报错，并点名该用哪个 Provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => renderHook(() => useLiveMetrics())).toThrow('useLiveMetrics must be used inside LiveMetricsProvider')
  })

  it('只挂指标那条流，不顺手把请求流也挂上', () => {
    mount()

    expect(streams.metrics).toHaveLength(1)
    expect(streams.requests).toEqual([])
  })

  it('指标原样成为 data：不在 Provider 里再算一遍', () => {
    const { result } = mount()

    act(() => streams.metrics[0].emit({ type: 'snapshot', metrics: metrics({ liveTps: 12.25, activeRequests: 3 }) }))

    // 服务端算好的就是最终值，客户端不该有任何取整、聚合或兜底。
    expect(result.current.data).toEqual({ liveTps: 12.25, activeRequests: 3 })
  })

  it('null 与 0 各是各的：取不到速度不等于速度为零', () => {
    const { result } = mount()

    act(() => streams.metrics[0].emit({ type: 'snapshot', metrics: metrics({ liveTps: null, activeRequests: 0 }) }))

    expect(result.current.data?.liveTps).toBeNull()
    expect(result.current.data?.activeRequests).toBe(0)
  })

  it('心跳不改变 data', () => {
    const { result } = mount()

    act(() => streams.metrics[0].emit({ type: 'snapshot', metrics: metrics() }))
    act(() => streams.metrics[0].emit({ type: 'heartbeat' }))

    expect(result.current.data?.liveTps).toBe(42.5)
  })

  it('新快照覆盖旧快照', () => {
    const { result } = mount()

    act(() => streams.metrics[0].emit({ type: 'snapshot', metrics: metrics({ liveTps: 1 }) }))
    act(() => streams.metrics[0].emit({ type: 'snapshot', metrics: metrics({ liveTps: 2 }) }))

    expect(result.current.data?.liveTps).toBe(2)
  })

  it('enabled 关掉时清空 data 并断开连接', () => {
    const { result, rerender } = mount()

    act(() => streams.metrics[0].emit({ type: 'snapshot', metrics: metrics() }))
    expect(result.current.data).toBeDefined()

    control.enabled = false
    rerender()

    expect(streams.metrics[0].signal.aborted).toBe(true)
    expect(result.current.data).toBeUndefined()
  })

  it('断开重连后保留上一帧，直到新快照到达', async () => {
    const { result } = mount()
    act(() => streams.metrics[0].emit({ type: 'snapshot', metrics: metrics({ liveTps: 7 }) }))

    await act(async () => {
      streams.metrics[0].finish()
    })
    await flush()

    expect(streams.metrics).toHaveLength(2)
    expect(result.current.data?.liveTps).toBe(7)

    act(() => streams.metrics[1].emit({ type: 'snapshot', metrics: metrics({ liveTps: 8 }) }))
    expect(result.current.data?.liveTps).toBe(8)
  })

  it('卸载时断开连接', () => {
    const { unmount } = mount()

    unmount()

    expect(streams.metrics[0].signal.aborted).toBe(true)
  })
})
