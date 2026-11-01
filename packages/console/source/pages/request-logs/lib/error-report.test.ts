import { describe, expect, it } from 'vitest'
import type { AttemptContent, RequestContent, RequestLogEntryAttempt } from '@common/schemas'
import { createAppTranslator } from '@common/i18n/catalogs'
import { buildErrorReport, type ErrorReportInput } from './error-report'

const t = createAppTranslator('en')

// 段标题一律从词条取，改文案时测试不用跟着改。
const TITLE = {
  report: t('requestLogs.contents.errorReport.title'),
  facts: t('requestLogs.contents.attemptFacts.title'),
  upstreamRequest: t('requestLogs.contents.stage.upstreamRequest'),
  upstreamResponse: t('requestLogs.contents.stage.upstreamResponse'),
  clientRequest: t('requestLogs.contents.stage.clientRequest'),
  clientResponse: t('requestLogs.contents.stage.clientResponse'),
}
const NOT_CAPTURED = t('requestLogs.contents.errorReport.notCaptured')
const NO_UPSTREAM_RESPONSE = t('requestLogs.contents.status.upstreamNoResponse')

function attemptOf(overrides: Partial<RequestLogEntryAttempt> = {}): RequestLogEntryAttempt {
  return {
    id: 'att_1',
    attemptIndex: 1,
    status: 'failed',
    providerId: 'prov_1',
    providerName: 'Provider One',
    providerModelId: 'model_1',
    providerModelName: 'model-one',
    upstreamProtocol: 'openai-responses',
    upstreamRequestId: null,
    url: 'https://api.provider.test/v1/responses',
    httpStatus: 429,
    retryable: true,
    upstreamTransport: 'http-stream',
    ttftMilliseconds: null,
    requestRewriteRuleIds: [],
    responseRewriteRuleIds: [],
    errorCode: 'upstream_rate_limited',
    errorMessage: 'Too many requests',
    durationMilliseconds: 321,
    createdTime: 1_700_000_000_000,
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
    requestHeaders: '{"authorization":"Bearer ***"}',
    requestBody: '{"model":"default"}',
    responseStatus: 502,
    responseHeaders: '{"content-type":"application/json"}',
    responseBody: '{"error":"upstream"}',
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
    requestHeaders: '{"content-type":"application/json"}',
    requestBody: '{"model":"upstream","input":"hi"}',
    responseStatus: 429,
    responseHeaders: '{"retry-after":"30"}',
    responseBody: '{"error":{"message":"slow down"}}',
    createdTime: 0,
    updatedTime: 0,
    ...overrides,
  }
}

function inputOf(overrides: Partial<ErrorReportInput> = {}): ErrorReportInput {
  return {
    t,
    locale: 'en',
    requestId: 'req_1',
    attempt: attemptOf(),
    clientProtocol: 'openai-responses',
    attemptContent: attemptContentOf(),
    clientContent: clientContentOf(),
    servesClient: true,
    generatedTime: 1_700_000_100_000,
    ...overrides,
  }
}

/** 取出某个二级标题下的整段（到下一个 `## ` 或文末为止）。 */
function sectionOf(text: string, title: string): string | null {
  const start = text.indexOf(`## ${title}`)
  if (start === -1) return null
  const next = text.indexOf('\n## ', start + 1)
  return next === -1 ? text.slice(start) : text.slice(start, next)
}

describe('buildErrorReport', () => {
  it('把四段原文按复现顺序排好：上游请求、上游响应、客户端请求、客户端响应', () => {
    const report = buildErrorReport(inputOf())
    const order = [
      TITLE.upstreamRequest,
      TITLE.upstreamResponse,
      TITLE.clientRequest,
      TITLE.clientResponse,
    ].map(title => report.text.indexOf(`## ${title}`))

    expect(order.every(index => index >= 0)).toBe(true)
    // 顺序就是供应商复现的顺序，不是字典序。
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('标题带上请求 ID 与生成时间，方便回信里引用', () => {
    const report = buildErrorReport(inputOf())

    expect(report.text.startsWith(`# ${TITLE.report}\n`)).toBe(true)
    expect(report.text).toContain('req_1')
    expect(report.text).toContain(`${t('requestLogs.contents.errorReport.generatedAt')}:`)
  })

  it('结论放在最前面：错误码、错误信息与耗时都在事实清单里', () => {
    const report = buildErrorReport(inputOf())
    const facts = sectionOf(report.text, TITLE.facts)

    expect(facts).toContain('upstream_rate_limited')
    expect(facts).toContain('Too many requests')
    // 错误码之后、上游报文之前，供应商先看到的是结论。
    expect(report.text.indexOf(`## ${TITLE.facts}`)).toBeLessThan(report.text.indexOf(`## ${TITLE.upstreamRequest}`))
  })

  it('上游地址写成绝对 URL —— 供应商要能拿它复现', () => {
    const report = buildErrorReport(inputOf())

    expect(sectionOf(report.text, TITLE.upstreamRequest)).toContain('https://api.provider.test/v1/responses')
  })

  it('正文重排成可读 JSON，但内容一字不改', () => {
    const report = buildErrorReport(inputOf())
    const section = sectionOf(report.text, TITLE.upstreamRequest)

    expect(section).toContain('"model": "upstream"')
    expect(section).toContain('"input": "hi"')
  })

  it('上游没回响应时写明「上游未返回响应」，而不是留成 HTTP null', () => {
    const report = buildErrorReport(inputOf({
      attemptContent: attemptContentOf({ responseStatus: null, responseHeaders: null, responseBody: null }),
    }))
    const section = sectionOf(report.text, TITLE.upstreamResponse)

    expect(section).toContain(NO_UPSTREAM_RESPONSE)
    expect(section).toContain(NOT_CAPTURED)
    expect(section).not.toContain('HTTP null')
  })

  it('没有正文行时整段写「未采集」，缺的字段正是要回来问的字段', () => {
    const report = buildErrorReport(inputOf({ attemptContent: null, clientContent: null }))

    expect(sectionOf(report.text, TITLE.upstreamRequest)).toContain(NOT_CAPTURED)
    expect(sectionOf(report.text, TITLE.upstreamResponse)).toContain(NOT_CAPTURED)
    expect(sectionOf(report.text, TITLE.clientRequest)).toContain(NOT_CAPTURED)
  })

  it('正文是空串时也算未采集，不写出一个空围栏', () => {
    const report = buildErrorReport(inputOf({
      attemptContent: attemptContentOf({ requestBody: '' }),
    }))

    expect(sectionOf(report.text, TITLE.upstreamRequest)).toContain(NOT_CAPTURED)
  })

  it('这次尝试没把响应交回客户端时，不写「客户端响应」', () => {
    // 故障转移里客户端拿到的是另一次尝试的结果，甚至是我们合成的 502；
    // 写进这份报告会让供应商以为那是它回的。
    const report = buildErrorReport(inputOf({ servesClient: false }))

    expect(sectionOf(report.text, TITLE.clientResponse)).toBeNull()
    expect(sectionOf(report.text, TITLE.clientRequest)).not.toBeNull()
  })

  it('文件名带请求 ID 与第几次尝试，非法字符换掉', () => {
    const report = buildErrorReport(inputOf({ requestId: 'req/1:a b' }))

    expect(report.name).toBe('error-report-req-1-a-b-att2.md')
  })

  it('请求 ID 为空时文件名仍可用', () => {
    expect(buildErrorReport(inputOf({ requestId: '' })).name).toBe('error-report-request-att2.md')
  })

  it('结尾只有一个换行，直接发出去也干净', () => {
    const report = buildErrorReport(inputOf())

    expect(report.text.endsWith('\n')).toBe(true)
    expect(report.text.endsWith('\n\n')).toBe(false)
  })
})
