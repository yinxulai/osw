import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { MODEL_TEST_STREAM_PROTOCOL_VERSION } from '@common/model-test-stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabases, initDatabases } from '../database'
import { modelTestRoutes } from './routes/diagnostics/model-test'
import { mockResponse } from './test-support'

/**
 * 路由层的边界：入参校验与空集。
 *
 * 请求体怎么拼、流怎么读、多轮怎么汇总，各自的断言在 `diagnostics/` 下同名的
 * `*.test.ts` 里；跑通与失败的完整场景在 `model-test-route.test.ts`；响应是流这件事
 * （分帧、逐轮到达、客户端断开）在 `model-test-stream-http.test.ts`。这里只留
 * 「HTTP 那一层没做多余的事」。
 */

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-model-test-'))
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

function writtenFrames(response: ServerResponse): Record<string, unknown>[] {
  return vi.mocked(response.write).mock.calls.map(call => JSON.parse(String(call[0])) as Record<string, unknown>)
}

function mockRequest(): IncomingMessage {
  return { once: vi.fn(), removeListener: vi.fn() } as unknown as IncomingMessage
}

describe('model test management route', () => {
  it('returns no results when no model can serve the requested protocol', async () => {
    const response = mockResponse()
    const request = mockRequest()

    await modelTestRoutes.invoke('/api/model-test/run', response, { protocol: 'openai-completions' }, request)

    // 一条目标都没有时只发汇总：没什么可逐轮报的，但汇总照发——界面据此把「筛选没命中」
    // 与「请求本身失败了」分开。
    expect(writtenFrames(response)).toEqual([
      { protocolVersion: MODEL_TEST_STREAM_PROTOCOL_VERSION, type: 'summary', results: [] },
    ])
  })

  it('rejects an invalid protocol before querying models', async () => {
    const response = mockResponse()
    const request = mockRequest()

    await expect(modelTestRoutes.invoke('/api/model-test/run', response, { protocol: 'unknown' }, request)).rejects.toThrow()
    expect(response.write).not.toHaveBeenCalled()
  })
})
