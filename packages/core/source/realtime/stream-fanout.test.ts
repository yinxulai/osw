import type { ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFanout } from './stream-fanout'
import { mockResponse } from '../management/test-support'

/**
 * 统一传输骨架的直接测试。
 *
 * 两条真实推送通道（进行中的请求、实时指标）各自还有一层适配测试；这里只盯 {@link createFanout}
 * 自己的契约：一源多订阅、序列化一次、合流、心跳、背压、以及「最后一个订阅者离开就收摊」。
 */

interface FakeResponse {
  res: ServerResponse
  written: string[]
  emitDrain: () => void
  markEnded: () => void
}

function responseOf(canWrite: (payload: string) => boolean = () => true): FakeResponse {
  const drainListeners = new Set<() => void>()
  const written: string[] = []
  const res = mockResponse({
    write: (payload: string) => {
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

describe('createFanout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  interface HarnessOptions {
    heartbeatFrame?: string
  }

  /** 一个带可变负载、可手动触发的数据源，外加计数用的快照/序列化调用次数。 */
  function harness(options: HarnessOptions = {}) {
    let payload = 'a'
    let onChange: (() => void) | null = null
    const snapshots: string[] = []
    const serializations: string[] = []
    const fanout = createFanout<string>({
      snapshot: () => {
        snapshots.push(payload)
        return payload
      },
      frameOf: value => {
        serializations.push(value)
        return `frame:${value}\n`
      },
      heartbeatFrame: options.heartbeatFrame ?? 'hb\n',
      subscribe: listener => {
        onChange = listener
        return () => { onChange = null }
      },
    })
    return {
      fanout,
      set: (value: string) => { payload = value },
      change: () => onChange?.(),
      connected: () => onChange !== null,
      snapshots,
      serializations,
    }
  }

  it('新订阅者连上就同步收到一帧', () => {
    vi.useFakeTimers()
    const h = harness()
    const { res, written } = responseOf()

    h.fanout.attach(res)

    expect(written).toEqual(['frame:a\n'])
    expect(h.connected()).toBe(true)
  })

  it('源变化后在节拍里推一帧，且多个订阅者共用同一份字节、快照只序列化一次', () => {
    vi.useFakeTimers()
    const h = harness()
    const first = responseOf()
    const second = responseOf()
    h.fanout.attach(first.res)
    h.fanout.attach(second.res)
    h.serializations.length = 0

    h.set('b')
    h.change()
    vi.advanceTimersByTime(150)

    expect(first.written.at(-1)).toBe('frame:b\n')
    expect(second.written.at(-1)).toBe(first.written.at(-1))
    expect(h.serializations).toEqual(['b'])
  })

  it('源长期不动时在心跳间隔推一帧无状态心跳', () => {
    vi.useFakeTimers()
    const h = harness()
    const { res, written } = responseOf()
    h.fanout.attach(res)

    vi.advanceTimersByTime(9_000)
    expect(written).toEqual(['frame:a\n'])

    vi.advanceTimersByTime(1_200)
    expect(written).toEqual(['frame:a\n', 'hb\n'])
  })

  it('背压期间跳过，drain 后按最新负载补一帧', () => {
    vi.useFakeTimers()
    const h = harness()
    let blocked = true
    const { res, written, emitDrain } = responseOf(() => !blocked)
    h.fanout.attach(res)

    h.set('b')
    h.change()
    vi.advanceTimersByTime(150)
    expect(written).toEqual(['frame:a\n'])

    blocked = false
    emitDrain()
    vi.advanceTimersByTime(150)
    expect(written.at(-1)).toBe('frame:b\n')
  })

  it('对端已经结束的响应被摘掉，之后不再写入、定时器也停掉', () => {
    vi.useFakeTimers()
    const h = harness()
    const { res, written, markEnded } = responseOf()
    h.fanout.attach(res)
    markEnded()

    h.set('b')
    h.change()
    vi.advanceTimersByTime(300)

    expect(written).toEqual(['frame:a\n'])
    expect(h.connected()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('最后一个订阅者离开就退订数据源并收掉定时器', () => {
    vi.useFakeTimers()
    const h = harness()
    const { res } = responseOf()

    const detach = h.fanout.attach(res)
    expect(h.connected()).toBe(true)

    detach()
    expect(h.connected()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
