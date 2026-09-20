import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TelemetryBatch, TelemetryEnvelope, TelemetryEvent } from '@common/telemetry'
import { TELEMETRY_MAX_EVENTS_PER_BATCH } from '@common/telemetry'
import { createTelemetryQueue } from './queue'
import type { TelemetrySender } from './sender'

/**
 * 队列只跟「什么时候发、发多少、发不出去怎么办」有关，所以发送端一律是替身：
 * 真发送端要连网络，属于 `sender.test.ts` 的事。
 */

const ENDPOINT = 'https://telemetry.test/v1/track'
const COMMON_FIELDS: TelemetryEnvelope = {
  occurredAt: 1_700_000_000_000,
  installId: '0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d',
  version: '1.1.0-beta.14',
  os: 'win32',
  arch: 'x64',
  locale: 'zh-CN',
  runtime: 'desktop',
}

interface SenderSpy {
  sender: TelemetrySender
  calls: Array<{ endpoint: string; batch: TelemetryBatch }>
}

function createSenderSpy(): SenderSpy {
  const calls: SenderSpy['calls'] = []
  return {
    calls,
    sender: (endpoint, batch) => {
      calls.push({ endpoint, batch })
      return Promise.resolve()
    },
  }
}

function createQueue(spy: SenderSpy, batchSize?: number) {
  return createTelemetryQueue({
    endpoint: ENDPOINT,
    sender: spy.sender,
    createCommonFields: () => ({ ...COMMON_FIELDS }),
    batchSize,
    // 间隔取一个大到不会在断言之间自己触发的值；要测间隔的用例自己推时钟。
    flushIntervalMilliseconds: 60_000,
  })
}

function namesOf(events: TelemetryEvent[]): string[] {
  return events.map(event => event.name)
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createTelemetryQueue', () => {
  it('stays quiet until a full batch is collected', () => {
    const spy = createSenderSpy()
    const queue = createQueue(spy, 3)

    queue.report({ name: 'app_started' })
    queue.report({ name: 'logs_exported', withContent: false })

    expect(spy.calls).toHaveLength(0)
    expect(queue.pending()).toHaveLength(2)
  })

  it('sends a batch as soon as it is full', () => {
    const spy = createSenderSpy()
    const queue = createQueue(spy, 2)

    queue.report({ name: 'app_started' })
    queue.report({ name: 'logs_exported', withContent: false })

    expect(spy.calls).toHaveLength(1)
    expect(spy.calls[0]?.endpoint).toBe(ENDPOINT)
    expect(namesOf(spy.calls[0]?.batch.events ?? [])).toEqual(['app_started', 'logs_exported'])
    expect(queue.pending()).toEqual([])
  })

  it('stamps every event with the envelope computed at report time', () => {
    // 语言这类字段在运行中会被改，信封字段必须现算而不是建队时算一次。
    const spy = createSenderSpy()
    let locale: TelemetryEnvelope['locale'] = 'zh-CN'
    const queue = createTelemetryQueue({
      endpoint: ENDPOINT,
      sender: spy.sender,
      createCommonFields: () => ({ ...COMMON_FIELDS, locale }),
      batchSize: 2,
      flushIntervalMilliseconds: 60_000,
    })

    queue.report({ name: 'app_started' })
    locale = 'en'
    queue.report({ name: 'logs_exported', withContent: true })

    expect(spy.calls[0]?.batch.events.map(event => event.locale)).toEqual(['zh-CN', 'en'])
  })

  it('flushes on the interval even when the batch is not full', () => {
    const spy = createSenderSpy()
    const queue = createQueue(spy, 10)

    queue.report({ name: 'app_started' })
    expect(spy.calls).toHaveLength(0)

    vi.advanceTimersByTime(60_000)

    expect(spy.calls).toHaveLength(1)
    expect(queue.pending()).toEqual([])
  })

  it('does not re-arm the timer once the batch is full', () => {
    // 满批立刻发走，就不该再留一个定时器——否则每个满批都会多出一个空 flush。
    const spy = createSenderSpy()
    const queue = createQueue(spy, 1)

    queue.report({ name: 'app_started' })
    vi.advanceTimersByTime(60_000)

    expect(spy.calls).toHaveLength(1)
  })

  it('splits a long queue into batches of at most the batch size', () => {
    const spy = createSenderSpy()
    const queue = createQueue(spy, 3)

    for (let i = 0; i < 7; i += 1) queue.report({ name: 'app_started' })
    expect(spy.calls.map(call => call.batch.events.length)).toEqual([3, 3])
    expect(queue.pending()).toHaveLength(1)

    queue.flush()

    expect(spy.calls.map(call => call.batch.events.length)).toEqual([3, 3, 1])
  })

  it('caps the batch size at the protocol limit', () => {
    const spy = createSenderSpy()
    const queue = createQueue(spy, 10_000)

    for (let i = 0; i < TELEMETRY_MAX_EVENTS_PER_BATCH + 1; i += 1) queue.report({ name: 'app_started' })

    expect(spy.calls).toHaveLength(1)
    expect(spy.calls[0]?.batch.events).toHaveLength(TELEMETRY_MAX_EVENTS_PER_BATCH)
    expect(queue.pending()).toHaveLength(1)
  })

  it('treats a non-positive batch size as one event per batch', () => {
    const spy = createSenderSpy()
    const queue = createQueue(spy, 0)

    queue.report({ name: 'app_started' })

    expect(spy.calls[0]?.batch.events).toHaveLength(1)
  })

  it('never grows beyond one batch while the endpoint is unresponsive', () => {
    // 队列上限只是「写不出去时还留多少」的兜底：到批量就先发，所以真正可观察的不变量是
    // 「待发数量不会无限涨」，而不是某个具体的上限数字。
    const calls: TelemetryBatch[] = []
    const queue = createTelemetryQueue({
      endpoint: ENDPOINT,
      sender: (_endpoint, batch) => {
        calls.push(batch)
        return new Promise<void>(() => undefined)
      },
      createCommonFields: () => ({ ...COMMON_FIELDS }),
      batchSize: TELEMETRY_MAX_EVENTS_PER_BATCH,
      flushIntervalMilliseconds: 60_000,
    })

    for (let i = 0; i < TELEMETRY_MAX_EVENTS_PER_BATCH * 4; i += 1) queue.report({ name: 'app_started' })

    expect(calls).toHaveLength(4)
    expect(queue.pending()).toHaveLength(0)
  })

  it('swallows a rejecting sender instead of surfacing it to the caller', () => {
    // 统计不允许出现「上报失败」这个分支：失败就是丢弃，且不能变成未处理的拒绝。
    const queue = createTelemetryQueue({
      endpoint: ENDPOINT,
      sender: () => Promise.reject(new Error('endpoint responded with 500')),
      createCommonFields: () => ({ ...COMMON_FIELDS }),
      batchSize: 1,
      flushIntervalMilliseconds: 60_000,
    })

    expect(() => queue.report({ name: 'app_started' })).not.toThrow()
    expect(queue.pending()).toEqual([])
  })

  it('accepts a throwing sender without breaking the queue', () => {
    const queue = createTelemetryQueue({
      endpoint: ENDPOINT,
      sender: () => {
        throw new Error('boom')
      },
      createCommonFields: () => ({ ...COMMON_FIELDS }),
      batchSize: 1,
      flushIntervalMilliseconds: 60_000,
    })

    expect(() => queue.report({ name: 'app_started' })).not.toThrow()
  })

  it('hands out a snapshot that callers cannot use to mutate the queue', () => {
    const spy = createSenderSpy()
    const queue = createQueue(spy, 10)
    queue.report({ name: 'app_started' })

    const snapshot = queue.pending()
    snapshot.length = 0

    expect(queue.pending()).toHaveLength(1)
  })

  it('discards everything on stop and refuses later reports', () => {
    const spy = createSenderSpy()
    const queue = createQueue(spy, 10)
    queue.report({ name: 'app_started' })

    queue.stop()
    queue.report({ name: 'logs_exported', withContent: false })
    vi.advanceTimersByTime(60_000)

    expect(spy.calls).toHaveLength(0)
    expect(queue.pending()).toEqual([])
  })

  it('does nothing when flushed after stop', () => {
    const spy = createSenderSpy()
    const queue = createQueue(spy, 10)
    queue.report({ name: 'app_started' })

    queue.stop()
    queue.flush()

    expect(spy.calls).toHaveLength(0)
  })
})
