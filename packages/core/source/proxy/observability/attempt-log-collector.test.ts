import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpstreamTarget } from '@server/proxy/contracts'
import type { AttemptFinalizationInput, AttemptLoggingInput } from './logging-types'
import { createAttemptLogger } from './attempt-log-collector'

/**
 * 尝试级日志器要守住两件容易做错的事：
 *
 * 1. **写入顺序**。正文挂在尝试行下面，所以必须先拿到 `attemptId` 再写正文；反过来就成了
 *    一条没有归属的正文。
 * 2. **重复写入不覆盖**。取消竞态下 `finalizeAttempt` 会被调两次——后到的是更弱的事实
 *    （取消），不能盖掉已落库的用量与正文。数据库用返回值 `null` 表达「这一行已经在了」。
 *
 * 另外：日志写入失败绝不能反过来打断请求，两条路径的失败都只落一条 `console.error`。
 */
const state = vi.hoisted(() => ({
  attemptWriteResult: null as { id: string } | null,
  attemptWrites: [] as Array<Record<string, unknown>>,
  usageWrites: [] as Array<Record<string, unknown>>,
  contentWrites: [] as Array<Record<string, unknown>>,
  attemptWriteError: null as Error | null,
  usageWriteError: null as Error | null,
  contentWriteError: null as Error | null,
  consoleErrors: [] as string[],
}))

vi.mock('@server/database/request-log-store', () => ({
  createRequestAttempt: async (input: Record<string, unknown>) => {
    state.attemptWrites.push(input)
    if (state.attemptWriteError) throw state.attemptWriteError
    return state.attemptWriteResult
  },
  recordAttemptUsage: async (input: Record<string, unknown>) => {
    state.usageWrites.push(input)
    if (state.usageWriteError) throw state.usageWriteError
  },
  createAttemptContent: async (input: Record<string, unknown>) => {
    state.contentWrites.push(input)
    if (state.contentWriteError) throw state.contentWriteError
  },
}))

function targetOf(overrides: Partial<UpstreamTarget> = {}): UpstreamTarget {
  return {
    providerId: 'prov_1',
    providerName: 'Provider One',
    providerModelId: 'pm_1',
    providerModelName: 'gpt-4o',
    apiKeyReference: 'secret://prov_1',
    customAuthHeader: null,
    endpointId: 'ep_1',
    protocol: 'openai-completions',
    url: 'https://api.example.com/v1/chat/completions',
    timeoutMilliseconds: 30_000,
    ...overrides,
  }
}

function inputOf(overrides: Partial<AttemptLoggingInput> = {}): AttemptLoggingInput {
  return {
    requestId: 'req_1',
    attemptIndex: 0,
    startedAt: 1_000,
    target: targetOf(),
    upstreamRequestHeaders: { authorization: 'Bearer sk-upstream', 'content-type': 'application/json' },
    upstreamRequestBody: Buffer.from('{"model":"gpt-4o"}', 'utf8'),
    requestRewriteRuleIds: ['rule_a'],
    captureRequestContent: true,
    ...overrides,
  }
}

function finalizationOf(overrides: Partial<AttemptFinalizationInput> = {}): AttemptFinalizationInput {
  return {
    status: 'success',
    httpStatus: 200,
    retryable: false,
    upstreamTransport: 'http-stream',
    servesRequest: true,
    ...overrides,
  }
}

let errorSpy: ReturnType<typeof vi.spyOn>
let debugSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000)
  state.attemptWriteResult = { id: 'attempt_1' }
  state.attemptWrites = []
  state.usageWrites = []
  state.contentWrites = []
  state.attemptWriteError = null
  state.usageWriteError = null
  state.contentWriteError = null
  state.consoleErrors = []
  errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { state.consoleErrors.push(String(args[0])) })
  debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
  debugSpy.mockRestore()
  vi.useRealTimers()
})

describe('createAttemptLogger 的落库字段', () => {
  it('上游事实从 target 显式投影，而不是整体透传', async () => {
    await createAttemptLogger(inputOf()).finalizeAttempt(finalizationOf())

    expect(state.attemptWrites[0]).toMatchObject({
      requestId: 'req_1',
      attemptIndex: 0,
      providerId: 'prov_1',
      providerModelId: 'pm_1',
      providerName: 'Provider One',
      providerModelName: 'gpt-4o',
      upstreamProtocol: 'openai-completions',
      url: 'https://api.example.com/v1/chat/completions',
    })
    // 密钥引用不是上游事实的一部分，不该出现在日志里。
    expect(Object.keys(state.attemptWrites[0] ?? {})).not.toContain('apiKeyReference')
    expect(Object.keys(state.attemptWrites[0] ?? {})).not.toContain('target')
  })

  it('耗时按「收尾时刻减开始时刻」算，不是上游报的', async () => {
    vi.setSystemTime(4_500)
    await createAttemptLogger(inputOf({ startedAt: 1_000 })).finalizeAttempt(finalizationOf())

    expect(state.attemptWrites[0]?.durationMilliseconds).toBe(3_500)
  })

  it('没给的失败信息一律落成 null，而不是省略字段', async () => {
    await createAttemptLogger(inputOf()).finalizeAttempt(finalizationOf({ status: 'failed' }))

    expect(state.attemptWrites[0]).toMatchObject({
      errorCode: null,
      errorMessage: null,
      upstreamRequestId: null,
      ttftMilliseconds: null,
    })
  })

  it('命中的改写规则 id 落库，缺失时按空数组', async () => {
    await createAttemptLogger(inputOf({ requestRewriteRuleIds: ['r1', 'r2'] })).finalizeAttempt(finalizationOf({ responseRewriteRuleIds: ['r3'] }))
    expect(state.attemptWrites[0]).toMatchObject({ requestRewriteRuleIds: ['r1', 'r2'], responseRewriteRuleIds: ['r3'] })

    await createAttemptLogger(inputOf({ requestRewriteRuleIds: undefined })).finalizeAttempt(finalizationOf())
    expect(state.attemptWrites[1]).toMatchObject({ requestRewriteRuleIds: [], responseRewriteRuleIds: [] })
  })

  it('用量逐项落库，没给的都是 null 而不是 0', async () => {
    await createAttemptLogger(inputOf()).finalizeAttempt(finalizationOf({ usage: { inputTokens: 12, outputTokens: 34 } }))

    expect(state.usageWrites[0]).toEqual({
      attemptId: 'attempt_1',
      servesRequest: true,
      inputTokens: 12,
      outputTokens: 34,
      reasoningTokens: null,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
      rawUsage: null,
    })
  })

  it('完全没有用量时也写一行，五个 Token 字段都是 null', async () => {
    await createAttemptLogger(inputOf()).finalizeAttempt(finalizationOf())

    expect(state.usageWrites).toHaveLength(1)
    expect(state.usageWrites[0]).toMatchObject({ inputTokens: null, outputTokens: null, rawUsage: null })
  })
})

describe('createAttemptLogger 的正文捕获', () => {
  it('正文挂在尝试行下面：先落尝试拿到 id，再写正文', async () => {
    await createAttemptLogger(inputOf()).finalizeAttempt(finalizationOf({
      upstreamContent: { captureStatus: 'captured', responseStatus: 200, responseHeaders: { 'content-type': 'application/json' }, responseBody: '{"ok":true}' },
    }))

    expect(state.contentWrites[0]).toMatchObject({
      attemptId: 'attempt_1',
      captureStatus: 'captured',
      responseStatus: 200,
      responseBody: '{"ok":true}',
    })
  })

  it('上游视角的请求头脱敏，并且请求体原样留档', async () => {
    await createAttemptLogger(inputOf()).finalizeAttempt(finalizationOf({
      upstreamContent: { captureStatus: 'captured', responseStatus: 200, responseHeaders: null, responseBody: null },
    }))

    const headers = JSON.parse(String(state.contentWrites[0]?.requestHeaders))
    expect(headers.authorization).toBe('[REDACTED]')
    expect(headers['content-type']).toBe('application/json')
    expect(state.contentWrites[0]?.requestBody).toBe('{"model":"gpt-4o"}')
    // 上游一个响应头都没回时落 null：不造一个空壳。
    expect(state.contentWrites[0]?.responseHeaders).toBeNull()
  })

  it('自定义鉴权头名也会被脱敏', async () => {
    await createAttemptLogger(inputOf({
      target: targetOf({ customAuthHeader: 'X-Api-Key' }),
      upstreamRequestHeaders: { 'x-api-key': 'sk-custom', 'content-type': 'application/json' },
    })).finalizeAttempt(finalizationOf({
      upstreamContent: { captureStatus: 'captured', responseStatus: 200, responseHeaders: null, responseBody: null },
    }))

    const headers = JSON.parse(String(state.contentWrites[0]?.requestHeaders))
    expect(headers['x-api-key']).toBe('[REDACTED]')
  })

  it('关掉正文捕获时尝试行照写，只是不落正文', async () => {
    await createAttemptLogger(inputOf({ captureRequestContent: false })).finalizeAttempt(finalizationOf({
      upstreamContent: { captureStatus: 'captured', responseStatus: 200, responseHeaders: null, responseBody: null },
    }))

    expect(state.attemptWrites).toHaveLength(1)
    expect(state.contentWrites).toEqual([])
  })

  it('没给上游正文时也不写正文行', async () => {
    await createAttemptLogger(inputOf()).finalizeAttempt(finalizationOf())

    expect(state.contentWrites).toEqual([])
  })
})

describe('createAttemptLogger 的竞态与失败', () => {
  // 取消（客户端断连）与正常收尾会各调一次：第二次拿不到新 id，说明这行已经在了。
  it('尝试行已存在时跳过重复写入，且不覆盖用量与正文', async () => {
    state.attemptWriteResult = null
    await createAttemptLogger(inputOf()).finalizeAttempt(finalizationOf({
      status: 'cancelled',
      usage: { inputTokens: 999 },
      upstreamContent: { captureStatus: 'captured', responseStatus: 200, responseHeaders: null, responseBody: 'late' },
    }))

    expect(state.usageWrites).toEqual([])
    expect(state.contentWrites).toEqual([])
    // 这不是错误，级联的是 debug。
    expect(state.consoleErrors).toEqual([])
    expect(debugSpy).toHaveBeenCalled()
    expect(String(debugSpy.mock.calls[0]?.[0])).toContain('already exists')
  })

  it('写尝试行失败只记一条错误，不抛给调用方', async () => {
    state.attemptWriteError = new Error('database is locked')

    await expect(createAttemptLogger(inputOf()).finalizeAttempt(finalizationOf())).resolves.toBeUndefined()
    expect(state.consoleErrors).toEqual(['[proxy] failed to write the request attempt log: database is locked'])
    expect(state.usageWrites).toEqual([])
  })

  it('写用量失败同样不抛，正文也不再写', async () => {
    state.usageWriteError = new Error('disk full')

    await expect(createAttemptLogger(inputOf()).finalizeAttempt(finalizationOf({
      upstreamContent: { captureStatus: 'captured', responseStatus: 200, responseHeaders: null, responseBody: 'x' },
    }))).resolves.toBeUndefined()
    expect(state.consoleErrors).toEqual(['[proxy] failed to write the request attempt log: disk full'])
    expect(state.contentWrites).toEqual([])
  })

  // 正文那一层有自己的 try：它失败时尝试行与用量都已经落库了，错误信息也不同。
  it('写正文失败只记一条「request body」错误', async () => {
    state.contentWriteError = new Error('too large')

    await expect(createAttemptLogger(inputOf()).finalizeAttempt(finalizationOf({
      upstreamContent: { captureStatus: 'captured', responseStatus: 200, responseHeaders: null, responseBody: 'x' },
    }))).resolves.toBeUndefined()
    expect(state.attemptWrites).toHaveLength(1)
    expect(state.usageWrites).toHaveLength(1)
    expect(state.consoleErrors).toEqual(['[proxy] failed to write the request body: too large'])
  })
})
