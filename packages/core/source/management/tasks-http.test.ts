import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { taskRoutes } from './routes/tasks'
import { taskQueue } from './tasks'

/**
 * 任务队列那五条接口走**真实的** HTTP 连接验一遍。
 *
 * `tasks/queue.test.ts` 验的是引擎、`tasks/task-stream.test.ts` 验的是帧协议；这里验的是
 * 假对象永远证不了的两件事：
 *
 * 1. **这条连接不会在推完第一帧就结束**——队列是进程级台账，没有「推完了」这个时刻；
 * 2. **客户端断开之后队列继续跑**——这是把队列从客户端搬到服务端要换来的东西本身。
 *    没有这条断言，整个改动就只剩一句设计说明。
 */

const KIND = 'http-test'

interface Pending {
  key: string
  release: () => void
}

const pendings: Pending[] = []

function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

async function releaseAll(): Promise<void> {
  for (const pending of pendings.splice(0)) pending.release()
  await settle()
}

describe('任务队列的真实 HTTP 连接', () => {
  let server: Server | null = null
  let baseUrl = ''

  beforeEach(async () => {
    pendings.length = 0
    taskQueue.clear()
    taskQueue.register({
      // 每条任务都要等用例放行：这样才能在有客户端看着的时候停在「运行中」。
      kind: KIND,
      concurrency: 1,
      parse: input => {
        const candidate = input as { id?: unknown }
        if (typeof candidate.id !== 'string') throw new Error('bad payload')
        return { id: candidate.id }
      },
      keyOf: payload => payload.id,
      run: payload => new Promise<string>(resolve => {
        pendings.push({ key: payload.id, release: () => resolve(payload.id) })
      }),
    })

    server = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk as Buffer))
      req.on('end', () => {
        const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString()) : {}
        const handler = taskRoutes[req.url!]
        if (!handler) {
          res.statusCode = 404
          res.end()
          return
        }
        void handler(req, res, body)
      })
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    await releaseAll()
    taskQueue.clear()
    const closing = server
    server = null
    if (!closing) return
    // fetch 默认复用长连接；不等它们走完，`close` 会拖到 socket 自己超时。
    closing.closeAllConnections()
    await new Promise<void>(resolve => closing.close(() => resolve()))
  })

  function post(path: string, body: unknown = {}): Promise<Response> {
    return fetch(`${baseUrl}${path}`, { method: 'POST', body: JSON.stringify(body) })
  }

  /** 读一行 NDJSON。每帧是一次独立的 `write`，所以一次 read 就是一行。 */
  async function nextFrame(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Record<string, unknown>> {
    const { value } = await reader.read()
    return JSON.parse(new TextDecoder().decode(value)) as Record<string, unknown>
  }

  it('首帧是快照，随后同一条连接持续推新的快照', async () => {
    const response = await post('/api/tasks/stream')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store, no-transform')

    const reader = response.body!.getReader()
    expect(await nextFrame(reader)).toEqual({ protocolVersion: 1, type: 'snapshot', tasks: [] })

    const enqueued = await post('/api/tasks/enqueue', { kind: KIND, items: [{ id: 'a' }] })
    expect(await enqueued.json()).toEqual({ success: true, data: { accepted: 1, skipped: 0 } })

    // 变更即推：不需要客户端再问一次。
    expect(await nextFrame(reader)).toMatchObject({
      protocolVersion: 1,
      type: 'snapshot',
      tasks: [{ key: 'a', status: 'running' }],
    })

    await reader.cancel()
  })

  it('客户端断开之后队列继续跑，重连就能看到结局', async () => {
    // 任务先跑起来，然后才有人来看。
    await post('/api/tasks/enqueue', { kind: KIND, items: [{ id: 'a' }] })

    const controller = new AbortController()
    const response = await fetch(`${baseUrl}/api/tasks/stream`, { method: 'POST', signal: controller.signal })
    const reader = response.body!.getReader()
    expect(await nextFrame(reader)).toMatchObject({ tasks: [{ key: 'a', status: 'running' }] })

    // 用户换页 / 关窗口：这条长连接断掉。
    controller.abort()
    await expect(reader.read()).rejects.toThrow()

    // 断开之后放行任务——如果队列跟客户端同生共死，这一条会永远停在 running。
    await releaseAll()

    const reconnected = await post('/api/tasks/stream')
    const nextReader = reconnected.body!.getReader()
    expect(await nextFrame(nextReader)).toMatchObject({
      protocolVersion: 1,
      type: 'snapshot',
      tasks: [{ key: 'a', status: 'success' }],
    })
    await nextReader.cancel()
  })

  it('按 id 取消排队中的任务：零上游请求', async () => {
    await post('/api/tasks/enqueue', { kind: KIND, items: [{ id: 'a' }, { id: 'b' }] })
    // 串行：只有第一条在跑，第二条还在排队。
    expect(pendings).toHaveLength(1)

    const snapshot = await (await post('/api/tasks/snapshot')).json() as { data: { tasks: Array<{ id: string; key: string }> } }
    const second = snapshot.data.tasks.find(task => task.key === 'b')!

    const cancelled = await (await post('/api/tasks/cancel', { taskIds: [second.id] })).json()
    expect(cancelled).toEqual({ success: true, data: { cancelled: 1 } })
    // 「零上游请求」就是这条承诺的全部：第二条从未开始过。
    expect(pendings).toHaveLength(1)

    const after = await (await post('/api/tasks/snapshot')).json() as { data: { tasks: Array<{ key: string; status: string }> } }
    expect(after.data.tasks.map(task => task.status)).toEqual(['running', 'cancelled'])
  })

  it('按 kind 取消返回真的落到的数量（已经结束的不算）', async () => {
    await post('/api/tasks/enqueue', { kind: KIND, items: [{ id: 'a' }] })

    const cancelled = await (await post('/api/tasks/cancel', { kind: KIND })).json()
    expect(cancelled).toEqual({ success: true, data: { cancelled: 1 } })

    // 在跑的那条要等它自己收尾：引擎只发信号，不替 kind 编一个结局。
    await releaseAll()
    const after = await (await post('/api/tasks/snapshot')).json() as { data: { tasks: Array<{ key: string; status: string }> } }
    expect(after.data.tasks).toEqual([expect.objectContaining({ key: 'a', status: 'cancelled' })])
  })

  it('有任务在跑时 clear 是空操作；结束后再清才真的清掉', async () => {
    await post('/api/tasks/enqueue', { kind: KIND, items: [{ id: 'a' }] })

    const blocked = await (await post('/api/tasks/clear')).json()
    expect(blocked).toEqual({ success: true, data: { cleared: 0 } })

    await releaseAll()
    const cleared = await (await post('/api/tasks/clear')).json()
    expect(cleared).toEqual({ success: true, data: { cleared: 1 } })
  })

  it('畸形载荷被算成 skipped，不把整个请求带下水', async () => {
    const response = await (await post('/api/tasks/enqueue', { kind: KIND, items: [{ id: 'a' }, {}, { id: 'a' }] })).json()
    // 第二项解析不过、第三项与第一项同键去重。
    expect(response).toEqual({ success: true, data: { accepted: 1, skipped: 2 } })
  })
})
