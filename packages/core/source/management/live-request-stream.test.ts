import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { liveRequestStore } from '@server/proxy/observability/live-request-store'
import { attachLiveRequestStream } from './infrastructure/live-request-stream'
import { mockResponse } from './test-support'

/**
 * 推送通道的测试全部围绕一件事：**什么时候写、写给谁、写不出时怎么办**。
 *
 * 这里不验 HTTP 头与路由（那是路由那一层的事，见 `request-logs.test.ts`），只验节拍器：
 * 新连上来的立刻给一帧、突发写入被合流、长期不动也有心跳、被背压挡住的人不拖累别人。
 */

/** 连上来的那条响应，外加两个测试用的口子：`emitDrain` 与 `markEnded`。 */
interface FakeStreamResponse {
  res: ServerResponse
  written: string[]
  emitDrain: () => void
  markEnded: () => void
}

/** `write` 的返回值决定这次写入有没有被内核缓冲区吃下（`false` 就是背压）。 */
function responseOf(canWrite: (payload: string) => boolean = () => true): FakeStreamResponse {
  const drainListeners = new Set<() => void>()
  const written: string[] = []
  const res = mockResponse({
    write: (payload: string) => {
      // 先问能不能写再记账：抛错的那次什么都没写出去，不该被当成一帧。
      const canPush = canWrite(payload)
      written.push(payload)
      return canPush
    },
    on: (_event: string, listener: () => void) => {
      drainListeners.add(listener)
      return res
    },
    off: (_event: string, listener: () => void) => {
      drainListeners.delete(listener)
      return res
    },
  } as unknown as Partial<ServerResponse>)

  return {
    res,
    written,
    emitDrain: () => {
      for (const listener of [...drainListeners]) listener()
    },
    markEnded: () => { Object.assign(res, { writableEnded: true }) },
  }
}

function frameOf(payload: string | undefined): { requests: { id: string }[] } {
  if (payload === undefined) throw new Error('expected a frame to have been written')
  // 一帧就是一行，行尾必须有换行——客户端靠它分帧。
  expect(payload.endsWith('\n')).toBe(true)
  return JSON.parse(payload.trimEnd()) as { requests: { id: string }[] }
}

function beginRequest(id: string, store = liveRequestStore) {
  return store.begin({ id, method: 'POST', path: '/v1/messages', transport: 'http', clientProtocol: null })
}

describe('attachLiveRequestStream', () => {
  const detachers: (() => void)[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    liveRequestStore.clear()
  })

  afterEach(() => {
    // 模块级状态（订阅者集合、节拍器）必须在每个用例后收干净，否则会串到下一个用例。
    while (detachers.length > 0) detachers.pop()?.()
    liveRequestStore.clear()
    vi.useRealTimers()
  })

  function attach(res: ServerResponse): void {
    detachers.push(attachLiveRequestStream(res))
  }

  it('连上就立刻给一帧，新客户端不必等一个节拍', () => {
    const { res, written } = responseOf()

    attach(res)

    expect(written).toHaveLength(1)
    expect(frameOf(written[0])).toEqual({ requests: [] })
  })

  it('台账变了以后最多每 150ms 推一帧，突变被合流成一份快照', () => {
    const { res, written } = responseOf()
    attach(res)
    expect(written).toHaveLength(1)

    const handle = beginRequest('req_1')
    handle.pushEvent('attempt.start', 'info', { index: 0 })
    handle.pushEvent('upstream.head', 'success', { attempt: 1, httpStatus: 200 })
    // 节拍未到：台账变了三次，一个字节都还没写。
    expect(written).toHaveLength(1)

    vi.advanceTimersByTime(150)
    expect(written).toHaveLength(2)
    // 一帧是全量快照：两次事件、两条写入都在里面，不需要客户端重放增量。
    expect(frameOf(written[1])?.requests).toEqual([expect.objectContaining({ id: 'req_1' })])
    expect(frameOf(written[1])?.requests[0]).toMatchObject({ phase: 'routing' })

    // 台账没再变，就不该重复推同一份快照。
    vi.advanceTimersByTime(150)
    expect(written).toHaveLength(2)
  })

  it('台账一直不动时用心跳证明连接还活着', () => {
    const { res, written } = responseOf()
    attach(res)
    beginRequest('req_1')

    // 前 9 秒里只有合流那一帧，没有心跳。
    vi.advanceTimersByTime(9_000)
    expect(written).toHaveLength(2)

    // 满 10 秒一定有一帧，哪怕台账一个字都没变。
    vi.advanceTimersByTime(1_200)
    expect(written).toHaveLength(3)
  })

  it('新客户端插队时给它的那份快照不能替老客户端吃掉待推的一帧', () => {
    const first = responseOf()
    attach(first.res)
    expect(first.written).toHaveLength(1)

    // 台账变了，但节拍还没到——这一帧正等着下一次 tick 推出去。
    beginRequest('req_1')
    const second = responseOf()
    attach(second.res)
    expect(second.written).toHaveLength(1)

    vi.advanceTimersByTime(150)
    // 老客户端也必须在同一个节拍里看到这次变更，否则它要等到心跳（最多 10 秒）才发现台账变了。
    expect(frameOf(first.written[1])?.requests).toEqual([expect.objectContaining({ id: 'req_1' })])
  })

  it('被背压挡住的订阅者先跳过，等 drain 再补一帧', () => {
    let blocked = true
    const { res, written, emitDrain } = responseOf(() => !blocked)
    attach(res)
    // 第一次写入就把这个人标成「没写完」，连上的那一刻就已经在背压里了。
    expect(written).toHaveLength(1)

    beginRequest('req_1')
    vi.advanceTimersByTime(150)
    // 往一个没吃完缓冲区的对端继续塞，只会让内存堆在服务端。
    expect(written).toHaveLength(1)

    blocked = false
    emitDrain()
    vi.advanceTimersByTime(150)
    expect(written).toHaveLength(2)
    expect(frameOf(written[1])?.requests).toEqual([expect.objectContaining({ id: 'req_1' })])
  })

  it('没吃完缓冲区的那个人被跳过，其他人照样按时收到', () => {
    const slow = responseOf(() => false)
    const fast = responseOf()
    attach(slow.res)
    attach(fast.res)

    beginRequest('req_1')
    vi.advanceTimersByTime(150)

    expect(slow.written).toHaveLength(1)
    expect(fast.written).toHaveLength(2)
  })

  it('已经结束的响应会被摘掉，之后不再尝试写入', () => {
    const { res, written, markEnded } = responseOf()
    attach(res)
    markEnded()

    beginRequest('req_1')
    vi.advanceTimersByTime(150)
    // 这一帧在写之前发现对端已经收摊了，于是直接摘人。
    expect(written).toHaveLength(1)

    beginRequest('req_2')
    vi.advanceTimersByTime(300)
    // 摘掉之后连定时器一起收掉，台账再怎么变也不会再动这个响应。
    expect(written).toHaveLength(1)
  })

  it('写入抛错只丢这一个订阅者，异常不会回到台账那边', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    let throwing = false
    const { res, written } = responseOf(() => {
      if (throwing) throw new Error('socket closed')
      return true
    })
    attach(res)

    throwing = true
    beginRequest('req_1')
    // 台账的关键路径不能被一个正在死掉的 socket 带崩。
    expect(() => vi.advanceTimersByTime(150)).not.toThrow()
    expect(written).toHaveLength(1)

    beginRequest('req_2')
    vi.advanceTimersByTime(300)
    expect(written).toHaveLength(1)
    expect(debug).toHaveBeenCalled()
    debug.mockRestore()
  })

  it('多个订阅者共用同一份字节，快照只序列化一次', () => {
    const first = responseOf()
    const second = responseOf()
    attach(first.res)
    attach(second.res)

    beginRequest('req_1')
    vi.advanceTimersByTime(150)

    expect(second.written.at(-1)).toBe(first.written.at(-1))
  })

  it('最后一个人离开后就停止推帧，也不再把节拍器留在事件循环里', () => {
    const { res, written } = responseOf()
    const detach = attachLiveRequestStream(res)
    detach()

    beginRequest('req_1')
    vi.advanceTimersByTime(1_000)

    expect(written).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
