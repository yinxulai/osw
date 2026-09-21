import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Protocol } from '@common/schemas'
import type { TelemetryEventInput } from '@common/telemetry'
import { closeDatabases, initDatabases } from '../database'
import { createProvider, createProviderEndpoint } from '@server/database/provider-store'
import {
  createProtocolConverter,
  createProviderModelEndpoint,
  createProviderModelRoute,
  updateProviderModelRoute,
} from '@server/database/model-store'
import { modelTestRoutes } from './routes/diagnostics/model-test'
import { mockResponse } from './test-support'

/** 处理器只用到这几个方法，替身按需实现，避免拖入真实的传输层。 */
interface BufferedResponseLike {
  start: (statusCode: number, headers: Record<string, string>) => void
  write: (chunk: string) => boolean
  end: () => void
  destroy: (error: Error) => void
}

let mockUpstreamHandler: ((response: BufferedResponseLike) => void) | null = null

interface ExecuteProxyRequestInput {
  response: BufferedResponseLike
}

vi.mock('../proxy/execution/attempt-executor', () => ({
  executeProxyRequest: vi.fn(async (input: ExecuteProxyRequestInput) => {
    mockUpstreamHandler?.(input.response)
  }),
}))

/**
 * 「用户点了一次测试」是产品行为，粒度是**一次测试**（里面可能包含好几个模型）。
 * 中途取消的不算：用户没看到结果，我也不能假装他看到了。
 */
const { reported } = vi.hoisted(() => ({ reported: [] as TelemetryEventInput[] }))

vi.mock('@server/telemetry', () => ({
  reportTelemetryEvent: (event: TelemetryEventInput) => {
    reported.push(event)
  },
}))

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-model-test-route-'))
  await initDatabases(temporaryDirectory)
  mockUpstreamHandler = null
  reported.length = 0
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

function payload(response: ServerResponse): Record<string, unknown> {
  return JSON.parse(String(vi.mocked(response.end).mock.calls[0][0])) as Record<string, unknown>
}

function results(response: ServerResponse): Record<string, unknown>[] {
  return (payload(response).data as { results: Record<string, unknown>[] }).results
}

interface TestRequest extends IncomingMessage {
  emitAborted: () => void
}

/**
 * `aborted` 可能在注册监听之前就已经发生（处理器是在路由入口才挂监听的），
 * 因此用参数表达「已经断开」，注册时立刻回调，避免依赖真实的事件时序。
 */
function mockRequest(alreadyAborted = false): TestRequest {
  const listeners = new Map<string, () => void>()
  return {
    once: (event: string, listener: () => void) => {
      listeners.set(event, listener)
      if (alreadyAborted && event === 'aborted') listener()
    },
    removeListener: vi.fn(),
    emitAborted: () => listeners.get('aborted')?.(),
  } as unknown as TestRequest
}

interface SeededModel {
  providerId: string
  modelId: string
}

/** 建一个「供应商 + 供应商端点 + 模型 + 模型端点绑定」，地址留空交给调用方决定。 */
async function seedModel(name: string, protocol: Protocol, providerUrl: string, modelUrl: string | null = null): Promise<SeededModel> {
  const provider = await createProvider({ name, apiKeyReference: `key_${name}`, enabled: true })
  const endpoint = await createProviderEndpoint({ providerId: provider.id, protocol, url: providerUrl })
  const model = await createProviderModelRoute({ providerId: provider.id, modelName: `${name}-model`, priority: 0 })
  await createProviderModelEndpoint({ providerModelId: model.id, providerEndpointId: endpoint.id, url: modelUrl })
  return { providerId: provider.id, modelId: model.id }
}

function jsonBody(value: unknown) {
  return (response: BufferedResponseLike) => {
    response.start(200, { 'content-type': 'application/json' })
    response.write(JSON.stringify(value))
    response.end()
  }
}

function failure(statusCode: number, body: string) {
  return (response: BufferedResponseLike) => {
    response.start(statusCode, { 'content-type': 'application/json' })
    response.write(body)
    response.end()
  }
}

function run(body: Record<string, unknown>, response: ServerResponse = mockResponse(), request = mockRequest()) {
  return modelTestRoutes.invoke('/api/model-test/run', response, body, request)
}

describe('model test run route', () => {
  it('跑通直连模型并回传用量', async () => {
    const { modelId } = await seedModel('direct', 'openai-completions', 'https://api.example.com/v1/chat/completions')
    mockUpstreamHandler = jsonBody({ usage: { prompt_tokens: 12, completion_tokens: 34 } })

    const response = mockResponse()
    await run({ protocol: 'openai-completions' }, response)

    expect(results(response)).toEqual([
      expect.objectContaining({
        modelId,
        success: true,
        statusCode: 200,
        inputTokens: 12,
        outputTokens: 34,
      }),
    ])
    expect(results(response)[0].errorMessage).toBeUndefined()
    expect(typeof results(response)[0].durationMilliseconds).toBe('number')
    // 一次测试一条事件，结果取整批的聚合值。
    expect(reported).toEqual([{ name: 'provider_tested', result: 'success' }])
  })

  it('端点地址为空时借用供应商级地址', async () => {
    await seedModel('borrow', 'openai-completions', 'https://api.example.com/v1/chat/completions')
    mockUpstreamHandler = jsonBody({})

    const response = mockResponse()
    await run({ protocol: 'openai-completions' }, response)

    expect(results(response)[0]).toMatchObject({ success: true, statusCode: 200 })
  })

  it('模型与供应商都没有地址时给出可读的失败原因', async () => {
    await seedModel('nowhere', 'openai-completions', '')

    const response = mockResponse()
    await run({ protocol: 'openai-completions' }, response)

    expect(results(response)).toEqual([
      expect.objectContaining({
        success: false,
        errorMessage: 'No upstream url is configured for protocol openai-completions',
      }),
    ])
  })

  it('上游出网失败时把错误回给界面', async () => {
    await seedModel('boom', 'openai-completions', 'https://api.example.com/v1/chat/completions')
    mockUpstreamHandler = failure(500, JSON.stringify({ errorMessage: '上游返回了 500' }))

    const response = mockResponse()
    await run({ protocol: 'openai-completions' }, response)

    expect(results(response)[0]).toMatchObject({
      success: false,
      statusCode: 500,
      errorMessage: '上游返回了 500',
    })
    expect(reported).toEqual([{ name: 'provider_tested', result: 'failed' }])
  })

  it('上游给 Anthropic 风格错误体时读嵌套 message', async () => {
    await seedModel('nested', 'anthropic-messages', 'https://api.anthropic.com/v1/messages')
    mockUpstreamHandler = failure(400, JSON.stringify({ error: { message: 'invalid request' } }))

    const response = mockResponse()
    await run({ protocol: 'anthropic-messages' }, response)

    expect(results(response)[0]).toMatchObject({ success: false, statusCode: 400, errorMessage: 'invalid request' })
  })

  it('空白错误字段被跳过，回落到 HTTP 状态码', async () => {
    await seedModel('blank', 'openai-completions', 'https://api.example.com/v1/chat/completions')
    mockUpstreamHandler = failure(429, JSON.stringify({ errorMessage: '   ', error: { message: '' } }))

    const response = mockResponse()
    await run({ protocol: 'openai-completions' }, response)

    expect(results(response)[0].errorMessage).toBe('HTTP 429')
  })

  it('非 JSON 响应体回落到 HTTP 状态码', async () => {
    await seedModel('plain', 'openai-completions', 'https://api.example.com/v1/chat/completions')
    mockUpstreamHandler = failure(503, '<html>bad gateway</html>')

    const response = mockResponse()
    await run({ protocol: 'openai-completions' }, response)

    expect(results(response)[0]).toMatchObject({ success: false, statusCode: 503, errorMessage: 'HTTP 503' })
  })

  it('没有状态码也没有正文时兜底成 502', async () => {
    await seedModel('nocode', 'openai-completions', 'https://api.example.com/v1/chat/completions')
    mockUpstreamHandler = response => { response.write('still nothing'); response.end() }

    const response = mockResponse()
    await run({ protocol: 'openai-completions' }, response)

    expect(results(response)[0]).toMatchObject({ success: false, errorMessage: 'HTTP 502' })
    expect(results(response)[0].statusCode).toBeUndefined()
  })

  it('传输层直接销毁响应时优先用它的 failureMessage', async () => {
    await seedModel('destroyed', 'openai-completions', 'https://api.example.com/v1/chat/completions')
    mockUpstreamHandler = response => { response.destroy(new Error('socket hang up')) }

    const response = mockResponse()
    await run({ protocol: 'openai-completions' }, response)

    expect(results(response)[0]).toMatchObject({ success: false, errorMessage: 'socket hang up' })
  })

  it('执行器抛出异常时记下异常信息', async () => {
    await seedModel('throwing', 'openai-completions', 'https://api.example.com/v1/chat/completions')
    mockUpstreamHandler = () => { throw new Error('routing planner exploded') }

    const response = mockResponse()
    await run({ protocol: 'openai-completions' }, response)

    expect(results(response)[0]).toMatchObject({ success: false, errorMessage: 'routing planner exploded' })
  })

  it('没开协议转换的模型接不住别的协议', async () => {
    await seedModel('native-only', 'anthropic-messages', 'https://api.anthropic.com/v1/messages')
    mockUpstreamHandler = jsonBody({})

    const response = mockResponse()
    await run({ protocol: 'openai-completions' }, response)

    expect(results(response)).toEqual([])
    // 一个模型都没跑，就没有「一次测试」可报（空结果与「全失败」是两回事）。
    expect(reported).toEqual([])
  })

  it('协议转换开启后可以拿别的协议的模型做诊断', async () => {
    const provider = await createProvider({ name: 'convertible', apiKeyReference: 'key_convertible', enabled: true })
    const endpoint = await createProviderEndpoint({ providerId: provider.id, protocol: 'anthropic-messages', url: 'https://api.anthropic.com/v1/messages' })
    const model = await createProviderModelRoute({ providerId: provider.id, modelName: 'convertible-model', priority: 0 })
    const binding = await createProviderModelEndpoint({ providerModelId: model.id, providerEndpointId: endpoint.id })
    await createProtocolConverter({ providerModelEndpointId: binding.id, clientProtocol: 'openai-completions' })
    mockUpstreamHandler = jsonBody({ usage: { input_tokens: 5, output_tokens: 7 } })

    const response = mockResponse()
    await run({ protocol: 'openai-completions' }, response)

    expect(results(response)).toEqual([
      expect.objectContaining({ modelId: model.id, success: true, inputTokens: 5, outputTokens: 7 }),
    ])
  })

  it('停用的模型不会被诊断', async () => {
    const { modelId } = await seedModel('disabled', 'openai-completions', 'https://api.example.com/v1/chat/completions')
    await updateProviderModelRoute(modelId, { enabled: false })

    const response = mockResponse()
    await run({ protocol: 'openai-completions' }, response)

    expect(results(response)).toEqual([])
  })

  it('支持按模型与供应商筛选诊断范围', async () => {
    const kept = await seedModel('kept', 'openai-completions', 'https://kept.example.com/v1/chat/completions')
    const skipped = await seedModel('skipped', 'openai-completions', 'https://skipped.example.com/v1/chat/completions')
    mockUpstreamHandler = jsonBody({})

    const byModel = mockResponse()
    await run({ protocol: 'openai-completions', modelIds: [kept.modelId] }, byModel)
    expect(results(byModel)).toHaveLength(1)
    expect(results(byModel)[0].modelId).toBe(kept.modelId)

    const byProvider = mockResponse()
    await run({ protocol: 'openai-completions', providerIds: [skipped.providerId] }, byProvider)
    expect(results(byProvider)).toHaveLength(1)
    expect(results(byProvider)[0].providerId).toBe(skipped.providerId)
  })

  it('客户端提前断开时不再补测后面的模型', async () => {
    await seedModel('aborted', 'openai-completions', 'https://api.example.com/v1/chat/completions')
    mockUpstreamHandler = jsonBody({})

    const request = mockRequest(true)
    const response = mockResponse()
    await run({ protocol: 'openai-completions' }, response, request)

    expect(results(response)).toEqual([])
    expect(request.removeListener).toHaveBeenCalledWith('aborted', expect.any(Function))
    // 取消掉的测试不上报：既没有结果，也不该被算成一次「用户试过了」。
    expect(reported).toEqual([])
  })

  it('响应已经结束时不再写回结果', async () => {
    await seedModel('ended', 'openai-completions', 'https://api.example.com/v1/chat/completions')
    mockUpstreamHandler = jsonBody({})

    const response = mockResponse({ writableEnded: true })
    await run({ protocol: 'openai-completions' }, response)

    expect(response.end).not.toHaveBeenCalled()
  })
})
