import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpstreamTarget } from '../proxy/contracts/transport'
import type { LiveRequestStore } from '../proxy/observability/live-request-store'

/**
 * 实时指标 hub 是**唯一计算点**：菜单栏标题与应用窗口角标是同一份数的两块画布，
 * 各算一遍迟早会算出两个不同的值。所以这里要验的是「谁算、什么时候算、算完推给谁」——
 * 而不是数字本身（那是 `@common/live-metrics` 的事）。
 *
 * 每个用例都重新取一份模块：hub 与台账都是模块级单例，`latest` 又刻意在停止后**保留**，
 * 共用一份会让上个用例的最后一帧漏进来。
 */
let hub: typeof import('./live-metrics-hub')
let store: LiveRequestStore

async function freshModules(): Promise<void> {
  vi.resetModules()
  hub = await import('./live-metrics-hub')
  store = (await import('../proxy/observability/live-request-store')).liveRequestStore
  store.clear()
}

/** 一次尝试要连到哪里。字段取全，免得以后加字段时这里的字面量悄悄过期。 */
function targetAt(index: number): UpstreamTarget {
  return {
    providerId: 'prov_1',
    providerName: 'Provider',
    providerModelId: `pm_${index}`,
    providerModelName: `model-${index}`,
    apiKeyReference: 'secret://prov_1',
    customAuthHeader: null,
    endpointId: 'endpoint_1',
    protocol: 'openai-completions',
    url: 'https://example.com/v1',
    timeoutMilliseconds: 30_000,
  }
}

/** 登记一条正在进行中的请求；返回它的写口。 */
function beginRequest(id: string) {
  const handle = store.begin({ id, method: 'POST', path: '/v1/chat/completions', transport: 'http-stream', clientProtocol: 'openai-completions' })
  handle.startAttempt(targetAt(1))
  return handle
}

beforeEach(async () => {
  vi.useFakeTimers()
  await freshModules()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('live-metrics-hub 的订阅生命周期', () => {
  // hub 不主动跑：没人看的时候不该有节拍器在空转。
  it('还没有订阅者时没有当前指标', () => {
    expect(hub.currentLiveMetrics()).toBeNull()
  })

  it('第一个订阅者连上来时立刻收到一帧，不必干等一个节拍', () => {
    const listener = vi.fn()
    hub.subscribeLiveMetrics(listener)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0]).toEqual({ liveTps: null, activeRequests: 0 })
    expect(hub.currentLiveMetrics()).not.toBeNull()
  })

  // 托盘画在原生菜单栏上，窗口角标走 HTTP 推送流；两边订阅同一个出口，天然是同一帧。
  it('两个订阅者拿到同一份数，后连上来的立刻收到最近一帧', () => {
    beginRequest('req_a')
    const first = vi.fn()
    hub.subscribeLiveMetrics(first)
    const second = vi.fn()
    hub.subscribeLiveMetrics(second)

    expect(second).toHaveBeenCalledTimes(1)
    expect(second.mock.calls[0][0]).toEqual(first.mock.calls[0][0])
    expect(second.mock.calls[0][0].activeRequests).toBe(1)
  })

  it('退订后不再收到推送，最后一个订阅者离开就停摆', async () => {
    const listener = vi.fn()
    const unsubscribe = hub.subscribeLiveMetrics(listener)
    listener.mockClear()

    beginRequest('req_b')
    await vi.advanceTimersByTimeAsync(500)
    expect(listener).toHaveBeenCalled()
    const callsBeforeLeave = listener.mock.calls.length

    unsubscribe()
    // 停摆之后台账继续变，但没人被叫醒（订阅台账、节拍器都已经收掉）。
    beginRequest('req_c')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(listener).toHaveBeenCalledTimes(callsBeforeLeave)
  })

  // 刻意保留：下一个订阅者连上来时先拿到最近一帧，界面不至于从空白开始闪一下。
  it('停摆后再订阅，第一帧就能拿到上次算出的数', async () => {
    beginRequest('req_d')
    const first = hub.subscribeLiveMetrics(vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    const beforeStop = hub.currentLiveMetrics()
    first()

    const second = vi.fn()
    hub.subscribeLiveMetrics(second)
    expect(second).toHaveBeenCalledTimes(1)
    expect(second.mock.calls[0][0]).toEqual(beforeStop)
  })
})

describe('live-metrics-hub 的合流与去抖', () => {
  // 流式响应每几毫秒写一次台账，逐次重算只会让数字每秒闪十几次。
  it('合流窗口内的多次写入只重算一帧', async () => {
    const listener = vi.fn()
    hub.subscribeLiveMetrics(listener)
    listener.mockClear()

    const handle = beginRequest('req_e')
    handle.setPhase('streaming')
    handle.pushEvent('chunk', 'info')

    // 窗口未到：一次都没推。
    await vi.advanceTimersByTimeAsync(199)
    expect(listener).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  // 数字没变就不该推：算一帧的成本不高，但让界面上每秒闪出十几帧同样的数字是错的。
  it('算出来数字与上一帧相同时不推送', async () => {
    const listener = vi.fn()
    hub.subscribeLiveMetrics(listener)
    listener.mockClear()

    // 第一次写入：并发数从 0 变成 1，推一帧。
    const handle = beginRequest('req_f')
    await vi.advanceTimersByTimeAsync(200)
    expect(listener).toHaveBeenCalledTimes(1)

    // 第二次写入只改阶段与事件：签名不变（liveTps 与 activeRequests 都没动），空推被挡下。
    handle.setPhase('streaming')
    await vi.advanceTimersByTimeAsync(200)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('并发数变化会推送——签名里就带着它', async () => {
    const listener = vi.fn()
    hub.subscribeLiveMetrics(listener)
    listener.mockClear()

    beginRequest('req_g')
    await vi.advanceTimersByTimeAsync(200)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].activeRequests).toBe(1)

    beginRequest('req_h')
    await vi.advanceTimersByTimeAsync(200)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener.mock.calls[1][0].activeRequests).toBe(2)
  })

  // 心跳与「脏了」走的是同一条 tick：心跳负责让 TPS 随时间自然回落，
  // 这里验的是节拍到了就会去算一遍（签名不变则照旧不推）。
  it('心跳到点也会算一遍，只是数字没变时仍旧不推', async () => {
    const listener = vi.fn()
    hub.subscribeLiveMetrics(listener)
    listener.mockClear()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(listener).not.toHaveBeenCalled()
  })

  it('请求落定后并发数回落，一帧把它推出去', async () => {
    const listener = vi.fn()
    hub.subscribeLiveMetrics(listener)
    const handle = beginRequest('req_i')
    await vi.advanceTimersByTimeAsync(200)
    listener.mockClear()

    handle.settle('success', 'request.settled', 'info')
    await vi.advanceTimersByTimeAsync(200)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].activeRequests).toBe(0)
  })
})
