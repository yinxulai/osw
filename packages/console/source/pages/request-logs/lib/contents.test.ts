import { describe, expect, it } from 'vitest'
import type { AttemptContent, RequestContent, RequestLogBodies, RequestLogEntryAttempt } from '@common/schemas'
import { createAppTranslator } from '@common/i18n/catalogs'
import { PROTOCOL_LABEL } from './format'
import { buildContentStages, factsOf, formatCreatedTime, mergeAttemptContent, mergeClientContent, protocolLabel, type ContentStageInput } from './contents'

const t = createAppTranslator('en')

function attemptOf(overrides: Partial<RequestLogEntryAttempt> = {}): RequestLogEntryAttempt {
  return {
    id: 'att_1',
    attemptIndex: 0,
    status: 'success',
    providerId: 'prov_1',
    providerName: 'Provider One',
    providerModelId: 'model_1',
    providerModelName: 'model-one',
    upstreamProtocol: 'openai-responses',
    upstreamRequestId: null,
    url: 'https://example.com/v1/responses',
    httpStatus: 200,
    retryable: false,
    upstreamTransport: 'http-stream',
    ttftMilliseconds: 12,
    requestRewriteRuleIds: [],
    responseRewriteRuleIds: [],
    errorCode: null,
    errorMessage: null,
    durationMilliseconds: 100,
    createdTime: 0,
    ...overrides,
  }
}

function clientContentOf(overrides: Partial<RequestContent> = {}): RequestContent {
  return {
    id: 'content_1',
    requestId: 'req_1',
    captureStatus: 'captured',
    requestMethod: 'POST',
    requestPath: '/v1/responses',
    requestHeaders: '{}',
    requestBody: '{"model":"default"}',
    responseStatus: 200,
    responseHeaders: '{}',
    responseBody: '{"ok":true}',
    createdTime: 0,
    updatedTime: 0,
    ...overrides,
  }
}

function attemptContentOf(overrides: Partial<AttemptContent> = {}): AttemptContent {
  return {
    id: 'attempt_content_1',
    attemptId: 'att_1',
    captureStatus: 'captured',
    requestHeaders: '{}',
    requestBody: '{"model":"upstream"}',
    responseStatus: 200,
    responseHeaders: '{}',
    responseBody: '{"ok":true}',
    createdTime: 0,
    updatedTime: 0,
    ...overrides,
  }
}

function stageInputOf(overrides: Partial<ContentStageInput> = {}): ContentStageInput {
  return {
    clientContent: clientContentOf(),
    attemptContent: attemptContentOf(),
    clientProtocol: 'openai-responses',
    upstreamProtocol: 'openai-responses',
    converted: false,
    servesClient: true,
    ...overrides,
  }
}

const factLabels = (attempt: RequestLogEntryAttempt, advanced: boolean): string[] =>
  factsOf(t, 'en', attempt).filter(fact => Boolean(fact.advanced) === advanced).map(fact => fact.label)

describe('protocol label', () => {
  it('shows the contract-layer display name when the protocol is known', () => {
    expect(protocolLabel(t, 'openai-responses')).toBe(PROTOCOL_LABEL['openai-responses'])
  })

  it('falls back to the raw value for a protocol it does not know', () => {
    expect(protocolLabel(t, 'something-new')).toBe('something-new')
  })

  it('says the protocol was not recognised when there is none', () => {
    expect(protocolLabel(t, null)).toBe(t('requestLogs.contents.unknownProtocol'))
  })
})

describe('created time', () => {
  it('formats the timestamp with the interface language', () => {
    expect(formatCreatedTime('en', 1_700_000_000_000)).toBe(new Date(1_700_000_000_000).toLocaleString('en', { hour12: false }))
  })

  it('keeps an unparseable timestamp as-is instead of rendering "Invalid Date"', () => {
    expect(formatCreatedTime('en', Number.NaN)).toBe('NaN')
  })
})

describe('attempt facts', () => {
  it('keeps the first-glance conclusions in the primary list and the lookup-only upstream ids in the advanced one', () => {
    const primary = factLabels(attemptOf(), false)
    const advanced = factLabels(attemptOf(), true)

    expect(primary).toContain(t('requestLogs.contents.fact.provider'))
    expect(primary).toContain(t('requestLogs.contents.fact.duration'))
    expect(primary).not.toContain(t('requestLogs.contents.fact.upstreamUrl'))
    expect(advanced).toContain(t('requestLogs.contents.fact.upstreamRequestId'))
    expect(advanced).toContain(t('requestLogs.contents.fact.upstreamUrl'))
  })

  it('leaves our own local ids out of both lists', () => {
    const facts = factsOf(t, 'en', attemptOf({ requestRewriteRuleIds: ['rule_1'], responseRewriteRuleIds: ['rule_2'] }))
    const values = facts.map(fact => fact.value)

    // 这些 id 在界面上既不能点也不能查，列出来只占位。
    expect(values).not.toContain('att_1')
    expect(values).not.toContain('prov_1')
    expect(values).not.toContain('model_1')
    expect(values).not.toContain('rule_1')
    expect(values).not.toContain('rule_2')
  })

  it('drops an error code that only restates the HTTP status', () => {
    const attempt = attemptOf({ httpStatus: 503, errorCode: 'Status_503', errorMessage: 'provider unavailable' })
    const advanced = factLabels(attempt, true)

    expect(advanced).not.toContain(t('requestLogs.contents.fact.errorCode'))
    // 错误信息也只是状态码的自然语言副本，同一个事实不说第二遍。
    expect(advanced).not.toContain(t('requestLogs.contents.fact.errorMessage'))
  })

  it('keeps an error code that adds something the status code cannot say', () => {
    const attempt = attemptOf({ httpStatus: 503, errorCode: 'upstream_timeout', errorMessage: 'timed out' })
    const advanced = factLabels(attempt, true)

    expect(advanced).toContain(t('requestLogs.contents.fact.errorCode'))
    expect(advanced).toContain(t('requestLogs.contents.fact.errorMessage'))
  })
})

describe('content stages', () => {
  it('walks the four positions of the chain for the attempt that served the request', () => {
    expect(buildContentStages(t, stageInputOf()).map(stage => stage.id)).toEqual([
      'client-request',
      'upstream-request',
      'upstream-response',
      'client-response',
    ])
  })

  it('leaves out the client response for an abandoned attempt', () => {
    const ids = buildContentStages(t, stageInputOf({ servesClient: false })).map(stage => stage.id)

    expect(ids).not.toContain('client-response')
    expect(ids).toEqual(['client-request', 'upstream-request', 'upstream-response'])
  })

  it('retitles the two converted stages when the protocol was translated', () => {
    const converted = buildContentStages(t, stageInputOf({
      clientProtocol: 'openai-completions',
      upstreamProtocol: 'anthropic-messages',
      converted: true,
    }))
    const direct = buildContentStages(t, stageInputOf())

    expect(converted[1]?.title).toBe(t('requestLogs.contents.stage.upstreamRequestConverted'))
    expect(direct[1]?.title).toBe(t('requestLogs.contents.stage.upstreamRequest'))
    expect(converted[3]?.title).toBe(t('requestLogs.contents.stage.clientResponseConverted'))
    // 协议名各自按链路两端显示，不会因为另一端的取值而串。
    expect(converted[1]?.protocol).toBe(PROTOCOL_LABEL['anthropic-messages'])
    expect(converted[3]?.protocol).toBe(PROTOCOL_LABEL['openai-completions'])
  })

  it('flags a partial capture on the response stage of its own perspective only', () => {
    const fromUpstream = buildContentStages(t, stageInputOf({ attemptContent: attemptContentOf({ captureStatus: 'partial' }) }))
    const fromClient = buildContentStages(t, stageInputOf({ clientContent: clientContentOf({ captureStatus: 'partial' }) }))
    const full = buildContentStages(t, stageInputOf())

    expect(fromUpstream[2]?.partialCapture).toBe(true)
    expect(fromClient[3]?.partialCapture).toBe(true)
    expect(full[2]?.partialCapture).toBe(false)
    expect(full[3]?.partialCapture).toBe(false)
  })

  it('reports the status of each response stage', () => {
    const stages = buildContentStages(t, stageInputOf({
      attemptContent: attemptContentOf({ responseStatus: 429 }),
      clientContent: clientContentOf({ responseStatus: null }),
    }))

    expect(stages[2]?.statusLabel).toBe('HTTP 429')
    expect(stages[3]?.statusLabel).toBe(t('requestLogs.contents.status.noResponse'))
  })

  it('does not call a locally observed failure an upstream response', () => {
    const localFailure = attemptContentOf({
      responseStatus: null,
      responseBody: JSON.stringify({ localFailure: true, errorCode: 'ECONNREFUSED', errorMessage: 'connect refused' }),
    })
    const stages = buildContentStages(t, stageInputOf({ attemptContent: localFailure }))
    const body = stages[2]?.sections.find(section => section.id === 'upstream-response.body')

    expect(body?.label).toBe(t('requestLogs.contents.section.localFailure'))
  })

  it('names the upstream body sections after the upstream protocol', () => {
    const stages = buildContentStages(t, stageInputOf({ upstreamProtocol: 'anthropic-messages' }))
    const header = stages[1]?.sections.find(section => section.id === 'upstream-request.headers')

    expect(header?.label).toBe(t('requestLogs.contents.section.requestHeader', { protocol: PROTOCOL_LABEL['anthropic-messages'] }))
  })
})

/**
 * 摘要在详情里，正文在另一份请求里，两者按行 id 对齐后才是一整条。
 *
 * 对齐不上只有一种含义：「正文还没取到」。因此正文列落 `null`（画骨架），
 * 而不是把「还没取到」写成「没采到」——后者是对数据的断言，由 `captureStatus` 说。
 */
describe('merging summary with bodies', () => {
  /** 默认正文与上面那份摘要同 id，即「已经取到了」。 */
  const bodiesOf = (overrides: Partial<RequestLogBodies> = {}): RequestLogBodies => ({
    contents: [clientContentOf()],
    attemptContents: [attemptContentOf()],
    ...overrides,
  })

  it('takes the body columns from the matching attempt row', () => {
    const merged = mergeAttemptContent(attemptContentOf(), bodiesOf({
      attemptContents: [attemptContentOf({ requestBody: '{"x":1}', responseBody: 'ok' })],
    }))

    expect(merged?.requestBody).toBe('{"x":1}')
    expect(merged?.responseBody).toBe('ok')
    // 摘要里的头与状态必须原样保留：去掉正文不该顺带丢掉报文身份。
    expect(merged?.requestHeaders).toBe('{}')
    expect(merged?.responseStatus).toBe(200)
  })

  it('matches by row id, not by attempt id or array position', () => {
    const summary = attemptContentOf({ id: 'attempt_content_2', attemptId: 'att_2' })
    const bodies = bodiesOf({
      attemptContents: [
        attemptContentOf({ id: 'attempt_content_1', requestBody: '{"wrong":true}' }),
        attemptContentOf({ id: 'attempt_content_2', requestBody: '{"right":true}' }),
      ],
    })

    expect(mergeAttemptContent(summary, bodies)?.requestBody).toBe('{"right":true}')
  })

  it('leaves the body columns empty while the bodies are still on the way', () => {
    // 正文还没到 → 画骨架；不能画成一条「已确认没采到」的行。
    expect(mergeAttemptContent(attemptContentOf(), null)).toMatchObject({ requestBody: null, responseBody: null })
    expect(mergeAttemptContent(attemptContentOf(), bodiesOf({ attemptContents: [] }))?.requestBody).toBeNull()
  })

  it('yields nothing when there is no summary for this attempt', () => {
    expect(mergeAttemptContent(null, bodiesOf())).toBeNull()
  })

  it('merges the single client row the same way', () => {
    const merged = mergeClientContent(clientContentOf(), bodiesOf({
      contents: [clientContentOf({ requestBody: '{"client":1}' })],
    }))

    expect(merged?.requestBody).toBe('{"client":1}')
    expect(mergeClientContent(null, bodiesOf())).toBeNull()
  })
})
