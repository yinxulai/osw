import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Protocol } from '@common/schemas'
import { tokensPerSecondFromTotals } from '@common/metrics'
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

interface ExecuteProxyRequestInput {
  context: { transport: string; headers: IncomingHttpHeaders }
  response: BufferedResponseLike
}

/** 上游替身。允许异步：速度诊断的分母是耗时，秒回的替身量不出速度。 */
type MockUpstream = (response: BufferedResponseLike) => void | Promise<void>

let mockUpstreamHandler: MockUpstream | null = null

/**
 * 传输形态是「诊断请求怎么写」的一部分：诊断恒走分块形态，连「不给模式」也一样。
 * 这条只能从执行器入口看，替身把入口的参数留下来。
 */
const { reported, executeInputs } = vi.hoisted(() => ({
  reported: [] as TelemetryEventInput[],
  executeInputs: [] as ExecuteProxyRequestInput[],
}))

vi.mock('../proxy/execution/attempt-executor', () => ({
  executeProxyRequest: vi.fn(async (input: ExecuteProxyRequestInput) => {
    executeInputs.push(input)
    await mockUpstreamHandler?.(input.response)
  }),
}))

/**
 * 「用户点了一次测试」是产品行为，粒度是**一次测试**（里面可能包含好几个模型）。
 * 中途取消的不算：用户没看到结果，我也不能假装他看到了。
 */

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
  executeInputs.length = 0
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

/**
 * 响应体是一行一帧的 NDJSON（形状见 `@common/model-test-stream`），所以按帧读。
 * `progress` 是逐轮进度，`summary` 才是这一批的结论（旧版一次性 JSON 的 `data.results`）——
 * 下面的断言照旧只看结论，逐轮进度由第二条 describe 里的用例单独钉住。
 */
function frames(response: ServerResponse): Record<string, unknown>[] {
  return vi.mocked(response.write).mock.calls
    .map(call => String(call[0]))
    .flatMap(chunk => chunk.split('\n'))
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line) as Record<string, unknown>)
}

function summary(response: ServerResponse): Record<string, unknown> {
  const frame = frames(response).find(item => item.type === 'summary')
  expect(frame, '这一批必须以一条 summary 收尾').toBeDefined()
  return frame!
}

function results(response: ServerResponse): Record<string, unknown>[] {
  return summary(response).results as Record<string, unknown>[]
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

/** 上游以 SSE 逐帧回——流式诊断唯一合格的形态。 */
function sseBody(...frames: string[]) {
  return (response: BufferedResponseLike) => {
    response.start(200, { 'content-type': 'text/event-stream' })
    for (const frame of frames) response.write(`data: ${frame}\n\n`)
    response.end()
  }
}

const SSE_CONTENT = '{"choices":[{"delta":{"content":"1 "}}]}'
const SSE_USAGE = '{"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":400}}'

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
    // 用量只能从流的收尾帧里读到：整包正文里没有它（这也是诊断恒为流式的原因之一）。
    mockUpstreamHandler = sseBody(SSE_CONTENT, '{"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":34}}')

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
    mockUpstreamHandler = sseBody(SSE_CONTENT, '{"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":7}}')

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
    // 现在这个信号也挂在响应上（真实连接上只有它会发，见路由里的注释），同样要摘干净。
    expect(response.removeListener).toHaveBeenCalledWith('close', expect.any(Function))
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

describe('model test run route — 诊断模式', () => {
  it('不给模式就是流式：分块形态 + SSE 头，首字也量得到', async () => {
    await seedModel('default-mode', 'openai-completions', 'https://api.example.com/v1/chat/completions')
    // 耗时要真的大于 0，否则速度没有分母——替身秒回会让所有速度断言都退化成 null。
    mockUpstreamHandler = async response => {
      await new Promise(resolve => setTimeout(resolve, 5))
      sseBody(SSE_CONTENT, SSE_USAGE)(response)
    }

    const response = mockResponse()
    await run({ protocol: 'openai-completions' }, response)

    expect(executeInputs[0].context.transport).toBe('http-stream')
    expect(executeInputs[0].context.headers.accept).toBe('text/event-stream')
    expect(results(response)[0]).toMatchObject({
      mode: 'streaming',
      success: true,
    })
    expect(typeof results(response)[0].ttftMilliseconds).toBe('number')
    // 速度是派生值，与模式无关：分子分母在流式诊断里同样齐备，界面不该整列空着。
    expect(results(response)[0].tokensPerSecond as number).toBeGreaterThan(0)
  })

  it('流式诊断走分块形态，并要求上游按 SSE 回', async () => {
    await seedModel('stream', 'openai-completions', 'https://api.example.com/v1/chat/completions')
    // 起始帧只报角色：它不算首字，所以首字只能由后面那帧内容决定。
    mockUpstreamHandler = async response => {
      await new Promise(resolve => setTimeout(resolve, 5))
      sseBody('{"choices":[{"delta":{"role":"assistant"}}]}', SSE_CONTENT, SSE_USAGE)(response)
    }

    const response = mockResponse()
    await run({ protocol: 'openai-completions', mode: 'streaming' }, response)

    expect(executeInputs[0].context.transport).toBe('http-stream')
    expect(executeInputs[0].context.headers.accept).toBe('text/event-stream')
    expect(results(response)[0]).toMatchObject({
      mode: 'streaming',
      success: true,
      inputTokens: 20,
      outputTokens: 400,
    })
    expect(typeof results(response)[0].ttftMilliseconds).toBe('number')
    // 与速度诊断同一口径：输出 Token ÷ 本次尝试耗时（含首字），不按模式另算一套。
    const [result] = results(response)
    expect(result.tokensPerSecond).toBeCloseTo(
      tokensPerSecondFromTotals(result.outputTokens as number, result.durationMilliseconds as number)!,
      1,
    )
    expect(reported).toEqual([{ name: 'provider_tested', result: 'success' }])
  })

  it('上游没按 SSE 回时首字是 null，而不是 0', async () => {
    await seedModel('buffered-stream', 'openai-completions', 'https://api.example.com/v1/chat/completions')
    mockUpstreamHandler = jsonBody({ choices: [{ message: { content: 'Hi' } }] })

    const response = mockResponse()
    await run({ protocol: 'openai-completions', mode: 'streaming' }, response)

    // 整包正文里解不出任何一帧，连用量也读不到——界面只能显示「不知道」。
    expect(results(response)[0]).toMatchObject({ ttftMilliseconds: null, inputTokens: null, outputTokens: null })
  })

  it('速度诊断在流式用量上算出出字速度', async () => {
    await seedModel('speed', 'openai-completions', 'https://api.example.com/v1/chat/completions')
    mockUpstreamHandler = async response => {
      // 分母是这次尝试的耗时：替身秒回的话耗时为 0，速度就成了无意义的数。
      await new Promise(resolve => setTimeout(resolve, 5))
      sseBody(SSE_CONTENT, SSE_USAGE)(response)
    }

    const response = mockResponse()
    await run({ protocol: 'openai-completions', mode: 'speed' }, response)

    const [result] = results(response)
    const durationMilliseconds = result.durationMilliseconds as number
    expect(result).toMatchObject({ mode: 'speed', success: true, outputTokens: 400 })
    expect(typeof result.ttftMilliseconds).toBe('number')
    expect(durationMilliseconds).toBeGreaterThan(0)
    expect(result.tokensPerSecond as number).toBeGreaterThan(0)
    // 与观测页同一口径：输出 Token 除以整次尝试耗时（含首字），不是除以「出字那段时间」，
    // 也不是除以首字之后的耗时——换了分母，同一个渠道在诊断面板和观测页上就是两个数。
    // 比的是**口径**不是浮点位：汇总结论会把速度保留两位小数，而耗时是实测的毫秒数，
    // 一条 6ms 的替身响应就会让 400/0.006 舍成 66666.67，精确相等只在耗时整除时才成立。
    expect(result.tokensPerSecond).toBeCloseTo(tokensPerSecondFromTotals(400, durationMilliseconds)!, 1)
  })

  it('拿不到输出 Token 时不编一个速度出来', async () => {
    await seedModel('no-usage', 'openai-completions', 'https://api.example.com/v1/chat/completions')
    mockUpstreamHandler = async response => {
      await new Promise(resolve => setTimeout(resolve, 5))
      sseBody(SSE_CONTENT, '{"choices":[]}')(response)
    }

    // 两种模式都要守同一条：没有分子就没有速度，「没测到」不能写成 0。
    for (const mode of ['streaming', 'speed'] as const) {
      const response = mockResponse()
      await run({ protocol: 'openai-completions', mode }, response)

      expect(results(response)[0]).toMatchObject({ mode, success: true, outputTokens: null, tokensPerSecond: null })
    }
  })

  it('失败轮次不给速度：上游没交付，比值不描述任何真实速度', async () => {
    await seedModel('failed', 'openai-completions', 'https://api.example.com/v1/chat/completions')
    mockUpstreamHandler = failure(401, JSON.stringify({ error: { message: 'invalid api key' } }))

    const response = mockResponse()
    await run({ protocol: 'openai-completions' }, response)

    expect(results(response)[0]).toMatchObject({ success: false, tokensPerSecond: null })
  })

  it('未知模式在查模型之前就被拒掉', async () => {
    const response = mockResponse()
    await expect(run({ protocol: 'openai-completions', mode: 'turbo' }, response)).rejects.toThrow()
    expect(response.end).not.toHaveBeenCalled()
  })
})

describe('model test run route — 逐轮进度', () => {
  it('每一轮跑完就写出一条 progress，最后一条是 summary', async () => {
    await seedModel('progressive', 'openai-completions', 'https://api.example.com/v1/chat/completions')
    // 慢上游是这条用例的重点：帧要在下一轮开始之前就已经写出去，而不是攒到收尾。
    mockUpstreamHandler = async response => {
      await new Promise(resolve => setTimeout(resolve, 5))
      sseBody(SSE_CONTENT, SSE_USAGE)(response)
    }

    const response = mockResponse()
    await run({ protocol: 'openai-completions', rounds: 2 }, response)

    const list = frames(response)
    expect(list.map(frame => frame.type)).toEqual(['progress', 'progress', 'summary'])
    expect(list[0]).toMatchObject({ protocolVersion: 1, type: 'progress', round: 1, totalRounds: 2 })
    expect(list[1]).toMatchObject({ type: 'progress', round: 2, totalRounds: 2 })
    // 进度帧是「到此为止」的汇总：第一帧里只有第一轮的明细。
    expect((list[0].result as { rounds: unknown[] }).rounds).toHaveLength(1)
    expect((list[1].result as { rounds: unknown[] }).rounds).toHaveLength(2)
    // 汇总帧与最后一帧进度算的是同一份结论：界面据它刷新那一行，不该有两个口径。
    expect(list[1].result).toEqual((list[2].results as unknown[])[0])
  })

  it('没配上游地址时只回一轮：进度帧说「第 1/1 轮」，不是用户填的 N', async () => {
    await seedModel('no-url', 'openai-completions', '')

    const response = mockResponse()
    await run({ protocol: 'openai-completions', rounds: 3 }, response)

    const list = frames(response)
    expect(list.map(frame => frame.type)).toEqual(['progress', 'summary'])
    expect(list[0]).toMatchObject({
      type: 'progress',
      round: 1,
      totalRounds: 1,
      result: { success: false, errorMessage: 'No upstream url is configured for protocol openai-completions' },
    })
  })
})
