import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabases, initDatabases } from '../database'
import { buildTestBody, modelTestRoutes, readUsage, StreamProbeResponse } from './routes/diagnostics/model-test'
import { mockResponse } from './test-support'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-model-test-'))
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

function responsePayload(response: ServerResponse): Record<string, unknown> {
  return JSON.parse(String(vi.mocked(response.end).mock.calls[0][0])) as Record<string, unknown>
}

function mockRequest(): IncomingMessage {
  return { once: vi.fn(), removeListener: vi.fn() } as unknown as IncomingMessage
}

describe('model test management route', () => {
  it('returns no results when no model can serve the requested protocol', async () => {
    const response = mockResponse()
    const request = mockRequest()

    await modelTestRoutes.invoke('/api/model-test/run', response, { protocol: 'openai-completions' }, request)

    expect(responsePayload(response)).toEqual({ success: true, data: { results: [] } })
  })

  it('rejects an invalid protocol before querying models', async () => {
    const response = mockResponse()
    const request = mockRequest()

    await expect(modelTestRoutes.invoke('/api/model-test/run', response, { protocol: 'unknown' }, request)).rejects.toThrow()
    expect(response.end).not.toHaveBeenCalled()
  })
})

describe('model test payload', () => {
  it('只给直连 anthropic 补 max_tokens，且压在最小值上', () => {
    expect(JSON.parse(buildTestBody('anthropic-messages', 'claude', false))).toEqual({
      model: 'claude',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Hi' }],
    })
  })

  it('走协议转换的 anthropic 不带 max_tokens（目标多是 OpenAI 形态）', () => {
    expect(JSON.parse(buildTestBody('anthropic-messages', 'gpt', true))).toEqual({
      model: 'gpt',
      messages: [{ role: 'user', content: 'Hi' }],
    })
  })

  it('两个 OpenAI 协议都不带输出上限，避免命中不支持 max_tokens 的模型', () => {
    expect(JSON.parse(buildTestBody('openai-completions', 'gpt', false))).toEqual({
      model: 'gpt',
      messages: [{ role: 'user', content: 'Hi' }],
    })
    expect(JSON.parse(buildTestBody('openai-responses', 'gpt', false))).toEqual({
      model: 'gpt',
      input: [{ role: 'user', content: 'Hi' }],
    })
  })

  it('不给模式时就是连通性：老的调用方写法一字不变', () => {
    const bare = buildTestBody('openai-completions', 'gpt', false)
    expect(buildTestBody('openai-completions', 'gpt', false, 'connectivity')).toBe(bare)
    expect(JSON.parse(bare)).not.toHaveProperty('stream')
  })

  it('流式诊断在三种协议下都声明 stream: true', () => {
    // 只靠 accept 头不够：三种协议都只认请求体里的 `stream`。
    expect(JSON.parse(buildTestBody('openai-completions', 'gpt', false, 'streaming'))).toMatchObject({ stream: true })
    expect(JSON.parse(buildTestBody('openai-responses', 'gpt', false, 'streaming'))).toMatchObject({ stream: true })
    expect(JSON.parse(buildTestBody('anthropic-messages', 'claude', false, 'streaming'))).toMatchObject({ stream: true })
  })

  it('速度诊断同样流式，并且换成一段够长的提示词', () => {
    const body = JSON.parse(buildTestBody('openai-completions', 'gpt', false, 'speed')) as {
      stream?: boolean
      messages: { content: string }[]
    }
    // 一句话的回答里，出字快慢全被首字节和连接开销盖住，所以速度诊断必须换提示词。
    expect(body.stream).toBe(true)
    expect(body.messages[0].content).not.toBe('Hi')
    expect(body.messages[0].content.length).toBeGreaterThan(20)
  })

  it('直连 anthropic 测速度时把 max_tokens 放大，走转换时仍然不加', () => {
    // 数到 200 会被 16 个 Token 掐断，测出来的就不是「出字速度」而是「上限速度」。
    expect(JSON.parse(buildTestBody('anthropic-messages', 'claude', false, 'speed')).max_tokens).toBeGreaterThan(16)
    expect(JSON.parse(buildTestBody('anthropic-messages', 'gpt', true, 'speed'))).not.toHaveProperty('max_tokens')
  })
})

describe('model test usage parsing', () => {
  it('认得 OpenAI、Responses 与 Anthropic 三套字段名', () => {
    expect(readUsage('{"usage":{"prompt_tokens":12,"completion_tokens":7}}')).toEqual({ inputTokens: 12, outputTokens: 7 })
    expect(readUsage('{"usage":{"input_tokens":12,"output_tokens":7}}')).toEqual({ inputTokens: 12, outputTokens: 7 })
  })

  it('同一个 usage 里混着占位 0 与真实值时要取真实值', () => {
    // 与 observers/usage.ts 同口径：Chat 风格字段是占位 0 时不能盖住 Responses 风格的真实值。
    const body = '{"usage":{"prompt_tokens":0,"completion_tokens":0,"input_tokens":38829,"output_tokens":477}}'
    expect(readUsage(body)).toEqual({ inputTokens: 38829, outputTokens: 477 })
  })

  it('读不到用量时返回 null，界面才好用 — 占位', () => {
    expect(readUsage('{"choices":[]}')).toEqual({ inputTokens: null, outputTokens: null })
    expect(readUsage('not json')).toEqual({ inputTokens: null, outputTokens: null })
    expect(readUsage('{"usage":{"prompt_tokens":"12"}}')).toEqual({ inputTokens: null, outputTokens: null })
  })
})

describe('model test stream probe', () => {
  it('首字认的是真实内容，不是第一帧', () => {
    const startedAt = Date.now()
    const probe = new StreamProbeResponse()
    // 起始帧只报角色、收尾帧只报用量，都不是用户看到的字；按字节打点会让首字虚低。
    probe.write('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n')
    expect(probe.firstOutputElapsed(startedAt)).toBeNull()
    probe.write('data: {"choices":[{"delta":{"content":"1"}}]}\n\n')
    expect(probe.firstOutputElapsed(startedAt)).not.toBeNull()
  })

  it('首字只记一次：后面每个字都往后推就变成「末字」了', () => {
    const startedAt = Date.now()
    const probe = new StreamProbeResponse()
    probe.write('data: {"choices":[{"delta":{"content":"1"}}]}\n\n')
    const first = probe.firstOutputElapsed(startedAt)
    probe.write('data: {"choices":[{"delta":{"content":"2"}}]}\n\n')
    expect(probe.firstOutputElapsed(startedAt)).toBe(first)
  })

  it('上游一个内容都没给时首字是 null，不是 0', () => {
    const probe = new StreamProbeResponse()
    probe.write('data: [DONE]\n\n')
    expect(probe.firstOutputElapsed(Date.now())).toBeNull()
    expect(probe.usage()).toEqual({ inputTokens: null, outputTokens: null })
  })

  it('用量从流里读，并且认得被切开的半截帧', () => {
    const probe = new StreamProbeResponse()
    probe.write('data: {"usage":{"prompt_tokens":12,')
    probe.write('"completion_tokens":7}}\n\n')
    probe.write('data: [DONE]\n\n')
    expect(probe.usage()).toEqual({ inputTokens: 12, outputTokens: 7 })
  })
})
