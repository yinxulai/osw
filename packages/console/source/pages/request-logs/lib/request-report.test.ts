import { describe, expect, it } from 'vitest'
import type { AttemptContent, RequestLogEntryAttempt } from '@common/schemas'
import { createAppTranslator } from '@common/i18n/catalogs'
import { buildRequestReport, type RequestReportInput } from './request-report'

const t = createAppTranslator('en')

// 段标题与事实标签一律从词条取，改文案时测试不用跟着改。
const TITLE = {
  report: t('requestLogs.contents.requestReport.title'),
  facts: t('requestLogs.contents.attemptFacts.title'),
  upstreamRequest: t('requestLogs.contents.stage.upstreamRequest'),
  upstreamResponse: t('requestLogs.contents.stage.upstreamResponse'),
  clientRequest: t('requestLogs.contents.stage.clientRequest'),
  clientResponse: t('requestLogs.contents.stage.clientResponse'),
}
const FACT = {
  provider: t('requestLogs.contents.fact.provider'),
  providerModel: t('requestLogs.contents.fact.providerModel'),
  upstreamRequestId: t('requestLogs.contents.fact.upstreamRequestId'),
  upstreamUrl: t('requestLogs.contents.fact.upstreamUrl'),
  requestId: t('requestLogs.detail.requestId'),
  generatedAt: t('requestLogs.contents.requestReport.generatedAt'),
}
const NOT_CAPTURED = t('requestLogs.contents.requestReport.notCaptured')
const NO_UPSTREAM_RESPONSE = t('requestLogs.contents.status.upstreamNoResponse')

// 记录里的 id 全部带 `_dev_` 前缀：报告里一个都不该出现，漏一个测试就红。
function attemptOf(overrides: Partial<RequestLogEntryAttempt> = {}): RequestLogEntryAttempt {
  return {
    id: 'att_dev_1',
    attemptIndex: 1,
    status: 'failed',
    providerId: 'prov_dev_1',
    providerName: 'Provider One',
    providerModelId: 'model_dev_1',
    providerModelName: 'model-one',
    upstreamProtocol: 'openai-responses',
    upstreamRequestId: null,
    url: 'https://api.provider.test/v1/responses',
    httpStatus: 429,
    retryable: true,
    upstreamTransport: 'http-stream',
    ttftMilliseconds: null,
    requestRewriteRuleIds: ['rule_dev_probe_header'],
    responseRewriteRuleIds: [],
    errorCode: 'upstream_rate_limited',
    errorMessage: 'Too many requests',
    durationMilliseconds: 321,
    createdTime: 1_700_000_000_000,
    ...overrides,
  }
}

function attemptContentOf(overrides: Partial<AttemptContent> = {}): AttemptContent {
  return {
    id: 'attempt_content_1',
    attemptId: 'att_dev_1',
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

function inputOf(overrides: Partial<RequestReportInput> = {}): RequestReportInput {
  return {
    t,
    locale: 'en',
    attempt: attemptOf(),
    attemptContent: attemptContentOf(),
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

describe('buildRequestReport', () => {
  it('只写供应商能对上的两段：它收到的请求、它回的响应', () => {
    const report = buildRequestReport(inputOf())

    expect(sectionOf(report.text, TITLE.upstreamRequest)).not.toBeNull()
    expect(sectionOf(report.text, TITLE.upstreamResponse)).not.toBeNull()
    // 客户端那两份属于我们自己的链路；混进来会让供应商看到一份它从未见过的请求。
    expect(sectionOf(report.text, TITLE.clientRequest)).toBeNull()
    expect(sectionOf(report.text, TITLE.clientResponse)).toBeNull()
  })

  it('事实在前、请求与响应在后：供应商先看结论再看报文', () => {
    const report = buildRequestReport(inputOf())
    const facts = report.text.indexOf(`## ${TITLE.facts}`)

    expect(facts).toBeGreaterThan(0)
    expect(facts).toBeLessThan(report.text.indexOf(`## ${TITLE.upstreamRequest}`))
    expect(report.text.indexOf(`## ${TITLE.upstreamRequest}`)).toBeLessThan(report.text.indexOf(`## ${TITLE.upstreamResponse}`))
  })

  it('抬头只有生成时间，没有我们自己的请求 ID', () => {
    const report = buildRequestReport(inputOf())
    const header = report.text.slice(0, report.text.indexOf('## '))

    expect(report.text.startsWith(`# ${TITLE.report}\n`)).toBe(true)
    expect(header).toContain(`${FACT.generatedAt}:`)
    expect(header).not.toContain(FACT.requestId)
  })

  it('有上游请求 ID 时写进抬头 —— 那是供应商自己能查的号', () => {
    const report = buildRequestReport(inputOf({ attempt: attemptOf({ upstreamRequestId: 'resp_abc123' }) }))

    expect(report.text).toContain(`${FACT.upstreamRequestId}: resp_abc123`)
  })

  it('没有上游请求 ID 时整行不写，不留一个空值', () => {
    const report = buildRequestReport(inputOf())

    expect(report.text).not.toContain(`${FACT.upstreamRequestId}:`)
  })

  it('结论放在最前面：错误码、错误信息与耗时都在事实清单里', () => {
    const report = buildRequestReport(inputOf())
    const facts = sectionOf(report.text, TITLE.facts)

    expect(facts).toContain('upstream_rate_limited')
    expect(facts).toContain('Too many requests')
    // 错误码之后、上游报文之前，供应商先看到的是结论。
    expect(report.text.indexOf(`## ${TITLE.facts}`)).toBeLessThan(report.text.indexOf(`## ${TITLE.upstreamRequest}`))
  })

  it('事实清单只放供应商认得的名字与数字，我们本地的 id 一个都不写', () => {
    const report = buildRequestReport(inputOf())
    const facts = sectionOf(report.text, TITLE.facts)

    expect(facts).toContain('Provider One')
    expect(facts).toContain('model-one')
    // 这些 id 只在我们的库里有效，供应商既查不到也问不到。
    expect(report.text).not.toContain('att_dev_1')
    expect(report.text).not.toContain('prov_dev_1')
    expect(report.text).not.toContain('model_dev_1')
    expect(report.text).not.toContain('rule_dev_probe_header')
  })

  it('事实清单里不重复写地址', () => {
    const facts = sectionOf(buildRequestReport(inputOf()).text, TITLE.facts) ?? ''

    expect(facts).not.toContain(FACT.upstreamUrl)
  })

  it('上游地址只在一个地方出现：请求段的元信息', () => {
    const report = buildRequestReport(inputOf())
    const section = sectionOf(report.text, TITLE.upstreamRequest)

    expect(section).toContain('https://api.provider.test/v1/responses')
    expect(sectionOf(report.text, TITLE.facts)).not.toContain('https://api.provider.test/v1/responses')
  })

  it('地址没记下来时也照位写「未采集」，不让整段少一行', () => {
    const report = buildRequestReport(inputOf({ attempt: attemptOf({ url: '' }) }))
    const section = sectionOf(report.text, TITLE.upstreamRequest)

    expect(section).toContain(NOT_CAPTURED)
  })

  it('正文重排成可读 JSON，但内容一字不改', () => {
    const report = buildRequestReport(inputOf())
    const section = sectionOf(report.text, TITLE.upstreamRequest)

    expect(section).toContain('"model": "upstream"')
    expect(section).toContain('"input": "hi"')
  })

  it('上游没回响应时写明「上游未返回响应」，而不是留成 HTTP null', () => {
    const report = buildRequestReport(inputOf({
      attemptContent: attemptContentOf({ responseStatus: null, responseHeaders: null, responseBody: null }),
    }))
    const section = sectionOf(report.text, TITLE.upstreamResponse)

    expect(section).toContain(NO_UPSTREAM_RESPONSE)
    expect(section).toContain(NOT_CAPTURED)
    expect(section).not.toContain('HTTP null')
  })

  it('没有正文行时两段都写「未采集」，缺的字段正是要回来问的字段', () => {
    const report = buildRequestReport(inputOf({ attemptContent: null }))

    expect(sectionOf(report.text, TITLE.upstreamRequest)).toContain(NOT_CAPTURED)
    expect(sectionOf(report.text, TITLE.upstreamResponse)).toContain(NOT_CAPTURED)
  })

  it('正文是空串时也算未采集，不写出一个空围栏', () => {
    const report = buildRequestReport(inputOf({
      attemptContent: attemptContentOf({ requestBody: '' }),
    }))

    expect(sectionOf(report.text, TITLE.upstreamRequest)).toContain(NOT_CAPTURED)
  })

  it('文件名用上游请求 ID 与第几次尝试，非法字符换掉', () => {
    const report = buildRequestReport(inputOf({
      attempt: attemptOf({ upstreamRequestId: 'resp/ab:c 1' }),
    }))

    expect(report.name).toBe('request-report-resp-ab-c-1-att2.md')
  })

  it('没有上游请求 ID 时文件名只留尝试序号', () => {
    const report = buildRequestReport(inputOf())

    expect(report.name).toBe('request-report-att2.md')
  })

  it('结尾只有一个换行，直接发出去也干净', () => {
    const report = buildRequestReport(inputOf())

    expect(report.text.endsWith('\n')).toBe(true)
    expect(report.text.endsWith('\n\n')).toBe(false)
  })
})
