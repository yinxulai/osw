import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachTaskStream } from '../infrastructure/task-stream'
import { taskQueue } from './index'

/**
 * 推送通道的「什么时候写什么」。
 *
 * 真连接那部分（背压、`close`、断开之后还能不能重连）交给 `tasks-http.test.ts`；
 * 这里用一个假响应验协议本身：**首帧必是快照**、变更即推快照、空闲时推心跳。
 * 心跳用假时钟推进，因为真实间隔是 10 秒——为了一条断言让套件等十秒，是用错了工具。
 */

const TEST_KIND = 'stream-test'

interface Frame {
  protocolVersion: number
  type: string
  tasks?: Array<{ key: string; status: string }>
}

interface FakeResponse {
  res: ServerResponse
  frames(): Frame[]
}

function fakeResponse(): FakeResponse {
  const writes: string[] = []
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    write: (chunk: string) => {
      writes.push(chunk)
      return true
    },
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as ServerResponse
  return {
    res,
    frames: () => writes.map(line => JSON.parse(line) as Frame),
  }
}

/** 由用例决定何时收尾的任务：这样才能观察到「进行中」那一帧。 */
const releases: Array<() => void> = []

beforeEach(() => {
  vi.useFakeTimers()
  releases.length = 0
  // 队列是进程级单例：每个用例开始时清空，免得上一个用例的终态项被推成首帧。
  taskQueue.clear()
  taskQueue.register({
    kind: TEST_KIND,
    parse: input => input as { id: string },
    keyOf: payload => payload.id,
    run: payload => new Promise<string>(resolve => {
      releases.push(() => resolve(payload.id))
    }),
  })
})

afterEach(() => {
  // 别把「在跑」留给下一条用例：终态之后 clear 才有意义。
  for (const release of releases.splice(0)) release()
  taskQueue.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('taskStream', () => {
  it('首帧就是完整快照，新连上来的客户端不必等一个节拍', () => {
    const fake = fakeResponse()
    const detach = attachTaskStream(fake.res)

    expect(fake.frames()).toEqual([{ protocolVersion: 1, type: 'snapshot', tasks: [] }])
    detach()
  })

  it('台账变了就推一帧完整快照（不是增量）', async () => {
    const fake = fakeResponse()
    const detach = attachTaskStream(fake.res)

    taskQueue.enqueue(TEST_KIND, [{ id: 'a' }])
    // 合流窗口内不立刻推：连续变更只该变成一帧，而不是一条变更一帧。
    expect(fake.frames()).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(150)
    expect(fake.frames().at(-1)).toMatchObject({ type: 'snapshot', tasks: [{ key: 'a', status: 'running' }] })

    // 任务收尾之后再来一帧：状态从 running 变成 success。
    releases[0]()
    await vi.advanceTimersByTimeAsync(150)
    expect(fake.frames().at(-1)).toMatchObject({ type: 'snapshot', tasks: [{ key: 'a', status: 'success' }] })
    detach()
  })

  it('空闲时推心跳：这条流不结束，连接活着的唯一证据就是它', async () => {
    const fake = fakeResponse()
    const detach = attachTaskStream(fake.res)

    // 心跳判据是「距上一帧 ≥ 10s」，而节拍是 150ms 一格：要跨过 10s 那一格得推到 10.05s 之后。
    await vi.advanceTimersByTimeAsync(10_200)

    expect(fake.frames().some(frame => frame.type === 'heartbeat')).toBe(true)
    // 心跳不携带状态：它不改任何东西，只证明这条连接还在。
    const heartbeat = fake.frames().find(frame => frame.type === 'heartbeat')!
    expect(heartbeat).toEqual({ protocolVersion: 1, type: 'heartbeat' })
    detach()
  })

  it('退订之后不再写任何东西（没人看时定时器也跟着收掉）', async () => {
    const fake = fakeResponse()
    const detach = attachTaskStream(fake.res)
    const before = fake.frames().length

    detach()
    await vi.advanceTimersByTimeAsync(30_000)

    expect(fake.frames()).toHaveLength(before)
  })
})
