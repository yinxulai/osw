import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { IncomingHttpHeaders, Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabases, initDatabases } from '../database'
import { createProvider, createProviderEndpoint } from '@server/database/provider-store'
import { createProviderModelEndpoint, createProviderModelRoute } from '@server/database/model-store'
import { modelTestRoutes } from './routes/diagnostics/model-test'

const STREAM_PATH = '/api/model-test/run'

/** 处理器只用到这几个方法，替身按需实现，避免拖入真实的传输层。 */
interface BufferedResponseLike {
  start: (statusCode: number, headers: Record<string, string>) => void
  write: (chunk: string) => boolean
  end: () => void
  destroy: (error: Error) => void
}

interface ExecuteProxyRequestInput {
  context: { transport: string; headers: IncomingHttpHeaders; signal: AbortSignal }
  response: BufferedResponseLike
}

/** 上游替身。允许异步：这条用例靠「第二轮挂着不回来」证明第一帧是提前发出去的。 */
type MockUpstream = (response: BufferedResponseLike) => void | Promise<void>

let mockUpstreamHandler: MockUpstream | null = null

/** 每次上游请求拿到的信号。取消要**真的**掐到在飞的那一轮，只能从这里看。 */
const { signals } = vi.hoisted(() => ({ signals: [] as AbortSignal[] }))

vi.mock('../proxy/execution/attempt-executor', () => ({
  executeProxyRequest: vi.fn(async (input: ExecuteProxyRequestInput) => {
    signals.push(input.context.signal)
    await mockUpstreamHandler?.(input.response)
  }),
}))

// 遥测不在这条用例的射程里，但它会真的往外发东西。
vi.mock('@server/telemetry', () => ({ reportTelemetryEvent: vi.fn() }))

const SSE_CONTENT = '{"choices":[{"delta":{"content":"1 "}}]}'
const SSE_USAGE = '{"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":400}}'

/** 上游以 SSE 逐帧回——流式诊断唯一合格的形态。 */
function sseBody(...frames: string[]): MockUpstream {
  return response => {
    response.start(200, { 'content-type': 'text/event-stream' })
    for (const frame of frames) response.write(`data: ${frame}\n\n`)
    response.end()
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>(inner => { resolve = inner })
  return { promise, resolve }
}

/** 等一个由服务进程推进的条件；超时说明它压根没走到那一步。 */
async function waitFor(predicate: () => boolean, timeoutMilliseconds = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the server to catch up')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

/**
 * 渠道诊断走一条**真实的** HTTP 连接验一遍。
 *
 * 上面那些用例把 `ServerResponse` 换成假对象，验的是「哪些帧、按什么顺序写出去」；这里验的是
 * 假对象永远证不了的那一件事：**第一帧在整批还没跑完时就到了客户端**。假对象上「每轮写一次」
 * 与「攒到最后一起写」在断言层面看不出区别——真连接上「先读到第一帧、第二轮还挂着」才是
 * 「边跑边出」的定义，而它正是这个 issue 要修的东西。
 */
describe('渠道诊断的流式路由走真实 HTTP 连接', () => {
  let server: Server | null = null
  let baseUrl = ''
  let temporaryDirectory = ''

  beforeEach(async () => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-model-test-stream-'))
    await initDatabases(temporaryDirectory)
    mockUpstreamHandler = null
    signals.length = 0

    const stream = modelTestRoutes[STREAM_PATH]
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk as Buffer))
      req.on('end', () => {
        void stream(req, res, JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
      })
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    await closeDatabases()
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
    const closing = server
    server = null
    if (!closing) return
    await new Promise<void>(resolve => closing.close(() => resolve()))
  })

  /** 建一个「供应商 + 供应商端点 + 模型 + 模型端点绑定」。 */
  async function seedModel(): Promise<void> {
    const provider = await createProvider({ name: 'streaming', apiKeyReference: 'key_streaming', enabled: true })
    const endpoint = await createProviderEndpoint({ providerId: provider.id, protocol: 'openai-completions', url: 'https://api.example.com/v1/chat/completions' })
    const model = await createProviderModelRoute({ providerId: provider.id, modelName: 'streaming-model', priority: 0 })
    await createProviderModelEndpoint({ providerModelId: model.id, providerEndpointId: endpoint.id })
  }

  /**
   * 逐行读一条 NDJSON 响应。
   *
   * 必须自己攒缓冲区：一次 `read()` 拿到的是**字节块**，不是一帧——两轮连着回来时
   * 两帧会挤在同一次读取里（上游秒回时这是常态）。
   */
  function openLineReader(reader: ReadableStreamDefaultReader<Uint8Array>): () => Promise<string> {
    const decoder = new TextDecoder()
    let buffer = ''
    return async () => {
      for (;;) {
        const newline = buffer.indexOf('\n')
        if (newline !== -1) {
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          return line
        }
        const { value, done } = await reader.read()
        if (done) throw new Error('the stream ended before the next frame arrived')
        buffer += decoder.decode(value, { stream: true })
      }
    }
  }

  async function openRun(body: Record<string, unknown>, signal?: AbortSignal): Promise<{
    response: Response
    nextLine: () => Promise<string>
  }> {
    const response = await fetch(`${baseUrl}${STREAM_PATH}`, {
      method: 'POST',
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    })
    expect(response.status).toBe(200)
    return { response, nextLine: openLineReader(response.body!.getReader()) }
  }

  it('第一轮跑完就发出一帧，不必等第二轮回来', async () => {
    await seedModel()
    const secondRound = deferred()
    let rounds = 0
    mockUpstreamHandler = async response => {
      rounds += 1
      // 第二轮挂着不回来：第一帧必须在这之前就到客户端。
      if (rounds > 1) await secondRound.promise
      sseBody(SSE_CONTENT, SSE_USAGE)(response)
    }

    const { response, nextLine } = await openRun({ protocol: 'openai-completions', rounds: 2 })
    // NDJSON：一帧一行，客户端按行切就行。
    expect(response.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store, no-transform')

    const first = JSON.parse(await nextLine()) as Record<string, unknown>
    expect(first).toMatchObject({
      protocolVersion: 1,
      type: 'progress',
      round: 1,
      totalRounds: 2,
      result: { success: true, rounds: [{ round: 1 }] },
    })
    // 第一帧到手时第二轮还挂在 `secondRound` 上（它只有下面那行才会放行）——收到这一帧
    // 就证明它不是「攒到最后」才发出来的。

    secondRound.resolve()
    const second = JSON.parse(await nextLine()) as Record<string, unknown>
    expect(second).toMatchObject({ type: 'progress', round: 2, totalRounds: 2 })
    expect((second.result as { rounds: unknown[] }).rounds).toHaveLength(2)

    const summary = JSON.parse(await nextLine()) as Record<string, unknown>
    expect(summary).toMatchObject({ protocolVersion: 1, type: 'summary' })
    // 汇总与最后一帧进度是同一份结论：界面据进度帧刷新那一行，不该出现第二个口径。
    expect(summary.results).toEqual([second.result])

    // 汇总之后连接结束：这条流会收尾，与「进行中的请求」那条不结束的推送流不同。
    await expect(nextLine()).rejects.toThrow('the stream ended before the next frame arrived')
  })

  it('客户端断开后掐掉在飞的那一轮，也不再补后面的轮次', async () => {
    await seedModel()
    const secondRound = deferred()
    let rounds = 0
    mockUpstreamHandler = async response => {
      rounds += 1
      if (rounds > 1) await secondRound.promise
      sseBody(SSE_CONTENT, SSE_USAGE)(response)
    }

    const controller = new AbortController()
    const { nextLine } = await openRun({ protocol: 'openai-completions', rounds: 3 }, controller.signal)
    expect(JSON.parse(await nextLine())).toMatchObject({ type: 'progress', round: 1 })
    // 等第二轮真的在飞再取消：这条要验的是「取消掐得到在飞的那一轮」，不是「取消得够快」。
    await waitFor(() => rounds === 2)

    // 换页/关窗口：客户端把这条连接掐掉。
    controller.abort()
    await waitFor(() => signals[1]?.aborted === true)

    // 在飞的那一轮拿到的信号已经被掐掉：上游请求是**真的**断了。
    expect(signals).toHaveLength(2)

    // 让它落定：这一轮是在取消之后回来的，不进结论，更不会接着跑第三轮。
    secondRound.resolve()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(rounds).toBe(2)
  })
})
