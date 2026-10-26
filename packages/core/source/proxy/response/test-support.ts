/**
 * 故障切换和凭据处理这两类单测共用的夹具。
 *
 * 第一层是 `response.test.ts` 与 `headers.test.ts`。它们用这里的状态码表和请求头夹具
 * 锁定三件最高风险的事：非 2xx 要换通道、报文错误才归到客户端、密钥不能进日志也不能原样转给上游。
 *
 * `audit*` 把这些断言收成可复用的检查：表还在不在，生产函数还能不能过。
 * `evaluate*` 是第二层：检查本身必须放行健康主体，并且拦住故意写坏的主体或夹具。
 * 第三层在 `test-support.meta.test.ts`，确认 `evaluate*` 不会把写坏的检查判成健康。
 */

import { readFileSync } from 'node:fs'
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http'
import type { ProtocolAuthHeaders } from '@common/protocols'
import { createUpstreamRequestHeaders, redactHeaders } from './headers'
import { classifyUpstreamStatus, isClientAttributableStatus } from './response'

export const SUCCESS_STATUS_CODES: readonly number[] = [200, 201, 204]
export const FAILOVER_STATUS_CODES: readonly number[] = [300, 301, 399, 400, 401, 403, 404, 405, 408, 409, 422, 429, 500, 502, 503, 599]
export const CLIENT_ATTRIBUTABLE_STATUS_CODES: readonly number[] = [400, 413, 414, 422]
export const NOT_CLIENT_ATTRIBUTABLE_STATUS_CODES: readonly number[] = [200, 300, 401, 403, 404, 405, 408, 409, 429, 500, 502, 503]

export const CREDENTIAL_HEADERS: OutgoingHttpHeaders = {
  authorization: 'Bearer client-token',
  'x-api-key': 'provider-key',
  cookie: 'session=secret',
  'set-cookie': ['session=secret'],
  'content-type': 'application/json',
}

export const REDACTED_CREDENTIAL_HEADERS: Record<string, string> = {
  authorization: '[REDACTED]',
  'x-api-key': '[REDACTED]',
  cookie: '[REDACTED]',
  'set-cookie': '[REDACTED]',
  'content-type': 'application/json',
}

export const CUSTOM_AUTH_HEADERS: OutgoingHttpHeaders = {
  'X-Custom-Key': 'provider-key',
  accept: 'application/json',
}

export const CUSTOM_AUTH_HEADER_NAMES: string[] = ['x-custom-key']

export const REDACTED_CUSTOM_AUTH_HEADERS: Record<string, string> = {
  'X-Custom-Key': '[REDACTED]',
  accept: 'application/json',
}

export const UPSTREAM_CLIENT_HEADERS: IncomingHttpHeaders = {
  accept: 'text/event-stream',
  'content-type': 'application/json',
  'x-goog-user-project': 'billing-project',
  'x-goog-api-client': 'genai-js/1.0',
  authorization: 'Bearer client-token',
  'x-goog-api-key': 'client-key',
  connection: 'keep-alive, x-remove-me',
  'x-remove-me': 'private',
  'transfer-encoding': 'chunked',
}

export const UPSTREAM_AUTH: ProtocolAuthHeaders = {
  replace: { 'x-goog-api-key': 'provider-key' },
  fill: {},
}

export const UPSTREAM_CONTENT_LENGTH = 42

export const UPSTREAM_FORWARDED_HEADERS: Record<string, string> = {
  accept: 'text/event-stream',
  'content-type': 'application/json',
  'x-goog-user-project': 'billing-project',
  'x-goog-api-client': 'genai-js/1.0',
  'x-goog-api-key': 'provider-key',
  'content-length': '42',
}

const CLIENT_BEARER = 'Bearer client-token'
const CLIENT_TOKEN = 'client-token'
const CLIENT_KEY = 'client-key'
const PROVIDER_KEY = 'provider-key'
const COOKIE_SECRET = 'session=secret'

export interface AuditReport {
  readonly ok: boolean
  readonly failures: readonly string[]
}

export interface HarnessVerdict {
  readonly sound: boolean
  readonly healthyPasses: boolean
  readonly healthyFailures: readonly string[]
  readonly missedProbeIds: readonly string[]
}

export interface StatusClassifier {
  classifyUpstreamStatus: (statusCode: number) => string
  isClientAttributableStatus: (statusCode: number) => boolean
}

export interface FailoverCases {
  readonly success: readonly number[]
  readonly failover: readonly number[]
  readonly clientAttributable: readonly number[]
  readonly notClientAttributable: readonly number[]
}

export type HeaderRedactor = (
  source: IncomingHttpHeaders | OutgoingHttpHeaders,
  additionalSensitiveHeaders?: string[],
) => Record<string, string | string[]>

export interface RedactionCases {
  readonly headers: OutgoingHttpHeaders
  readonly redacted: Record<string, string>
  readonly customHeaders: OutgoingHttpHeaders
  readonly customNames: readonly string[]
  readonly customRedacted: Record<string, string>
}

export type UpstreamHeaderBuilder = (
  source: IncomingHttpHeaders,
  auth: ProtocolAuthHeaders,
  contentLength: number,
) => Record<string, string | string[]>

export interface UpstreamCases {
  readonly clientHeaders: IncomingHttpHeaders
  readonly auth: ProtocolAuthHeaders
  readonly contentLength: number
  readonly forwarded: Record<string, string>
}

export interface Layer1Sources {
  readonly responseTest: string
  readonly headersTest: string
}

export type FailoverAudit = (subject: StatusClassifier, cases?: FailoverCases) => AuditReport
export type RedactionAudit = (redact: HeaderRedactor, cases?: RedactionCases) => AuditReport
export type UpstreamAudit = (build: UpstreamHeaderBuilder, cases?: UpstreamCases) => AuditReport
export type WiringAudit = (sources: Layer1Sources) => AuditReport

interface ProbeResult {
  readonly id: string
  readonly caught: boolean
}

interface StatusTableRule {
  readonly label: string
  readonly actual: readonly number[]
  readonly required: readonly number[]
  readonly forbidden: readonly number[]
  readonly size: number
}

interface OverlapRule {
  readonly label: string
  readonly left: readonly number[]
  readonly right: readonly number[]
}

function report(failures: readonly string[]): AuditReport {
  return { ok: failures.length === 0, failures: [...failures] }
}

function failed(result: AuditReport): boolean {
  return !result.ok || result.failures.length > 0
}

function caught(id: string, result: AuditReport): ProbeResult {
  return { id, caught: failed(result) }
}

function verdictFrom(healthy: AuditReport, probes: readonly ProbeResult[]): HarnessVerdict {
  const missedProbeIds = probes.filter(probe => !probe.caught).map(probe => probe.id)
  const healthyPasses = !failed(healthy)
  return {
    sound: healthyPasses && missedProbeIds.length === 0,
    healthyPasses,
    healthyFailures: [...healthy.failures],
    missedProbeIds,
  }
}

function defaultFailoverCases(): FailoverCases {
  return {
    success: SUCCESS_STATUS_CODES,
    failover: FAILOVER_STATUS_CODES,
    clientAttributable: CLIENT_ATTRIBUTABLE_STATUS_CODES,
    notClientAttributable: NOT_CLIENT_ATTRIBUTABLE_STATUS_CODES,
  }
}

function defaultRedactionCases(): RedactionCases {
  return {
    headers: CREDENTIAL_HEADERS,
    redacted: REDACTED_CREDENTIAL_HEADERS,
    customHeaders: CUSTOM_AUTH_HEADERS,
    customNames: CUSTOM_AUTH_HEADER_NAMES,
    customRedacted: REDACTED_CUSTOM_AUTH_HEADERS,
  }
}

function defaultUpstreamCases(): UpstreamCases {
  return {
    clientHeaders: UPSTREAM_CLIENT_HEADERS,
    auth: UPSTREAM_AUTH,
    contentLength: UPSTREAM_CONTENT_LENGTH,
    forwarded: UPSTREAM_FORWARDED_HEADERS,
  }
}

function requireStatuses(failures: string[], rule: StatusTableRule): void {
  if (rule.actual.length !== rule.size) failures.push(`${rule.label} case table changed size`)
  for (const status of rule.required) {
    if (!rule.actual.includes(status)) failures.push(`${rule.label} case table dropped ${status}`)
  }
  for (const status of rule.forbidden) {
    if (rule.actual.includes(status)) failures.push(`${rule.label} case table includes ${status}`)
  }
}

function rejectOverlap(failures: string[], rule: OverlapRule): void {
  const right = new Set(rule.right)
  for (const status of rule.left) {
    if (right.has(status)) failures.push(`${rule.label} overlap on ${status}`)
  }
}

function containsText(value: string | string[] | number | undefined, needle: string): boolean {
  if (typeof value === 'string') return value.includes(needle)
  if (Array.isArray(value)) return value.some(item => item.includes(needle))
  return false
}

function serialized(value: unknown): string {
  return JSON.stringify(value) ?? ''
}

function sameRecord(left: Record<string, string | string[] | undefined>, right: Record<string, string | string[] | undefined>): boolean {
  const leftKeys = Object.keys(left).filter(key => left[key] !== undefined)
  const rightKeys = Object.keys(right).filter(key => right[key] !== undefined)
  if (leftKeys.length !== rightKeys.length) return false
  return rightKeys.every(key => JSON.stringify(left[key]) === JSON.stringify(right[key]))
}

function headerEntries(source: IncomingHttpHeaders | OutgoingHttpHeaders): Array<[string, string | string[]]> {
  const entries: Array<[string, string | string[]]> = []
  for (const [name, value] of Object.entries(source)) {
    if (typeof value === 'string' || Array.isArray(value)) entries.push([name, value])
  }
  return entries
}

function codeOf(source: string): string {
  return source.split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n')
}

function hasCode(source: string, needle: string): boolean {
  return codeOf(source).includes(needle)
}

function mutate(source: string, needle: string, replacement: string): string | null {
  const lines = source.split('\n')
  const index = lines.findIndex(line => line.replace(/\/\/.*$/, '').includes(needle))
  if (index < 0) return null
  const next = lines.slice()
  next[index] = next[index].replace(needle, replacement)
  return next.join('\n')
}

export function auditFailoverClassifier(subject: StatusClassifier, cases: FailoverCases = defaultFailoverCases()): AuditReport {
  const failures: string[] = []
  requireStatuses(failures, {
    label: 'success',
    actual: cases.success,
    required: [200, 201, 204],
    forbidden: [400, 401, 429, 500],
    size: 3,
  })
  requireStatuses(failures, {
    label: 'failover',
    actual: cases.failover,
    required: [300, 301, 399, 400, 401, 403, 404, 405, 408, 409, 422, 429, 500, 502, 503, 599],
    forbidden: [200, 201, 204],
    size: 16,
  })
  requireStatuses(failures, {
    label: 'client-attributable',
    actual: cases.clientAttributable,
    required: [400, 413, 414, 422],
    forbidden: [200, 401, 403, 404, 408, 409, 429, 500],
    size: 4,
  })
  requireStatuses(failures, {
    label: 'not-client-attributable',
    actual: cases.notClientAttributable,
    required: [200, 300, 401, 403, 404, 405, 408, 409, 429, 500, 502, 503],
    forbidden: [400, 413, 414, 422],
    size: 12,
  })
  rejectOverlap(failures, { label: 'success/failover', left: cases.success, right: cases.failover })
  rejectOverlap(failures, { label: 'client-fault/retryable', left: cases.clientAttributable, right: cases.notClientAttributable })

  // 行为对照用的是导出的整张表，而不是调用方传来的那一份。
  // 表被偷换成更短的版本时，上面的成员检查会失败；分类器被写坏时，这里仍按完整表验收。
  for (const status of SUCCESS_STATUS_CODES) {
    const disposition = subject.classifyUpstreamStatus(status)
    if (disposition !== 'success') failures.push(`status ${status} classified as ${disposition}, want success`)
  }
  for (const status of FAILOVER_STATUS_CODES) {
    const disposition = subject.classifyUpstreamStatus(status)
    if (disposition !== 'failover') failures.push(`status ${status} classified as ${disposition}, want failover`)
  }
  for (const status of CLIENT_ATTRIBUTABLE_STATUS_CODES) {
    if (!subject.isClientAttributableStatus(status)) failures.push(`status ${status} must be client-attributable`)
  }
  for (const status of NOT_CLIENT_ATTRIBUTABLE_STATUS_CODES) {
    if (subject.isClientAttributableStatus(status)) failures.push(`status ${status} must stay retryable across channels`)
  }
  return report(failures)
}

export function auditCredentialRedaction(redact: HeaderRedactor, cases: RedactionCases = defaultRedactionCases()): AuditReport {
  const failures: string[] = []
  if (!containsText(cases.headers.authorization, CLIENT_TOKEN)) failures.push('credential fixture lost the bearer secret')
  if (!containsText(cases.headers['x-api-key'], PROVIDER_KEY)) failures.push('credential fixture lost the api key')
  if (!containsText(cases.headers.cookie, COOKIE_SECRET)) failures.push('credential fixture lost the cookie')
  if (!containsText(cases.headers['set-cookie'], COOKIE_SECRET)) failures.push('credential fixture lost the set-cookie')
  if (cases.headers['content-type'] !== 'application/json') failures.push('credential fixture lost the non-secret content-type')
  if (cases.redacted.authorization !== '[REDACTED]') failures.push('redaction expectation no longer masks authorization')
  if (cases.redacted['x-api-key'] !== '[REDACTED]') failures.push('redaction expectation no longer masks x-api-key')
  if (cases.redacted.cookie !== '[REDACTED]') failures.push('redaction expectation no longer masks cookie')
  if (cases.redacted['set-cookie'] !== '[REDACTED]') failures.push('redaction expectation no longer masks set-cookie')
  if (cases.redacted['content-type'] !== 'application/json') failures.push('redaction expectation rewrote content-type')
  if (!cases.customNames.some(name => name.toLowerCase() === 'x-custom-key')) failures.push('custom auth names dropped x-custom-key')
  if (!containsText(cases.customHeaders['X-Custom-Key'], PROVIDER_KEY)) failures.push('custom auth fixture lost the provider key')
  if (cases.customRedacted['X-Custom-Key'] !== '[REDACTED]') failures.push('custom auth expectation no longer masks the header')
  if (cases.customRedacted.accept !== 'application/json') failures.push('custom auth expectation rewrote accept')

  const redacted = redact(CREDENTIAL_HEADERS)
  if (!sameRecord(redacted, REDACTED_CREDENTIAL_HEADERS)) failures.push('credential headers did not redact to the fixture')
  const redactedText = serialized(redacted)
  for (const secret of [CLIENT_TOKEN, PROVIDER_KEY, COOKIE_SECRET]) {
    if (redactedText.includes(secret)) failures.push(`credential redaction left ${secret}`)
  }

  const custom = redact(CUSTOM_AUTH_HEADERS, CUSTOM_AUTH_HEADER_NAMES)
  if (!sameRecord(custom, REDACTED_CUSTOM_AUTH_HEADERS)) failures.push('custom auth header did not redact to the fixture')
  if (serialized(custom).includes(PROVIDER_KEY)) failures.push('custom auth redaction left the provider key')
  return report(failures)
}

export function auditUpstreamCredentialSwap(build: UpstreamHeaderBuilder, cases: UpstreamCases = defaultUpstreamCases()): AuditReport {
  const failures: string[] = []
  if (cases.clientHeaders.authorization !== CLIENT_BEARER) failures.push('upstream fixture lost the client bearer')
  if (cases.clientHeaders['x-goog-api-key'] !== CLIENT_KEY) failures.push('upstream fixture lost the client api key')
  if (cases.auth.replace['x-goog-api-key'] !== PROVIDER_KEY) failures.push('upstream replacement lost the provider key')
  if (cases.contentLength !== UPSTREAM_CONTENT_LENGTH) failures.push('upstream fixture lost the rewritten content length')
  if (cases.forwarded.authorization !== undefined) failures.push('forwarded expectation kept client authorization')
  if (containsText(cases.forwarded['x-goog-api-key'], CLIENT_KEY)) failures.push('forwarded expectation kept the client api key')
  if (cases.forwarded['x-goog-api-key'] !== PROVIDER_KEY) failures.push('forwarded expectation lost the provider key')
  if (cases.forwarded.accept !== 'text/event-stream') failures.push('forwarded expectation dropped accept')
  if (cases.forwarded['content-length'] !== String(UPSTREAM_CONTENT_LENGTH)) failures.push('forwarded expectation lost content-length')
  if (serialized(cases.forwarded).includes(CLIENT_TOKEN)) failures.push('forwarded expectation contains a client secret')

  const built = build(UPSTREAM_CLIENT_HEADERS, UPSTREAM_AUTH, UPSTREAM_CONTENT_LENGTH)
  if (!sameRecord(built, UPSTREAM_FORWARDED_HEADERS)) failures.push('upstream headers did not match the forwarded fixture')
  const text = serialized(built)
  if (text.includes(CLIENT_TOKEN) || text.includes(CLIENT_KEY)) failures.push('upstream headers forwarded a client credential')
  if (built.authorization !== undefined) failures.push('client authorization was forwarded')
  if (built['x-goog-api-key'] !== PROVIDER_KEY) failures.push('provider key was not installed')
  if (built.accept !== 'text/event-stream') failures.push('accept was dropped')
  if (built['content-length'] !== String(UPSTREAM_CONTENT_LENGTH)) failures.push('content-length was not rewritten')
  for (const name of ['connection', 'transfer-encoding', 'x-remove-me']) {
    if (built[name] !== undefined) failures.push(`hop-by-hop header ${name} was forwarded`)
  }
  return report(failures)
}

const RESPONSE_TEST_NEEDLES = [
  "from './test-support'",
  'it.each(SUCCESS_STATUS_CODES)',
  'it.each(FAILOVER_STATUS_CODES)',
  'it.each(CLIENT_ATTRIBUTABLE_STATUS_CODES)',
  'it.each(NOT_CLIENT_ATTRIBUTABLE_STATUS_CODES)',
  ".toBe('success')",
  ".toBe('failover')",
  '.toBe(true)',
  '.toBe(false)',
]

const HEADERS_TEST_NEEDLES = [
  "from './test-support'",
  'redactHeaders(CREDENTIAL_HEADERS)',
  'toEqual(REDACTED_CREDENTIAL_HEADERS)',
  'redactHeaders(CUSTOM_AUTH_HEADERS, CUSTOM_AUTH_HEADER_NAMES)',
  'toEqual(REDACTED_CUSTOM_AUTH_HEADERS)',
  'createUpstreamRequestHeaders(UPSTREAM_CLIENT_HEADERS, UPSTREAM_AUTH, UPSTREAM_CONTENT_LENGTH)',
  'toEqual(UPSTREAM_FORWARDED_HEADERS)',
]

export function auditLayer1Wiring(sources: Layer1Sources): AuditReport {
  const failures: string[] = []
  for (const needle of RESPONSE_TEST_NEEDLES) {
    if (!hasCode(sources.responseTest, needle)) failures.push(`response tests missing ${needle}`)
  }
  for (const needle of HEADERS_TEST_NEEDLES) {
    if (!hasCode(sources.headersTest, needle)) failures.push(`header tests missing ${needle}`)
  }
  return report(failures)
}

export function loadLayer1Sources(): Layer1Sources {
  return {
    responseTest: readFileSync(new URL('./response.test.ts', import.meta.url), 'utf8'),
    headersTest: readFileSync(new URL('./headers.test.ts', import.meta.url), 'utf8'),
  }
}

function classifyWithOverride(statusOverride: number, disposition: string): StatusClassifier {
  return {
    classifyUpstreamStatus: status => status === statusOverride ? disposition : classifyUpstreamStatus(status),
    isClientAttributableStatus,
  }
}

function attributeWithOverride(statusOverride: number, attributable: boolean): StatusClassifier {
  return {
    classifyUpstreamStatus,
    isClientAttributableStatus: status => status === statusOverride ? attributable : isClientAttributableStatus(status),
  }
}

function swapNumbers(values: readonly number[], from: number, to: number): readonly number[] {
  return values.map(status => status === from ? to : status)
}

function swapFailoverStatus(cases: FailoverCases, from: number, to: number): FailoverCases {
  return { ...cases, failover: swapNumbers(cases.failover, from, to) }
}

function swapClientStatus(cases: FailoverCases, from: number, to: number): FailoverCases {
  return { ...cases, clientAttributable: swapNumbers(cases.clientAttributable, from, to) }
}

function echoHeaders(source: IncomingHttpHeaders | OutgoingHttpHeaders): Record<string, string | string[]> {
  return Object.fromEntries(headerEntries(source))
}

function redactExceptApiKey(source: IncomingHttpHeaders | OutgoingHttpHeaders, additionalSensitiveHeaders: string[] = []): Record<string, string | string[]> {
  const sensitive = new Set(['authorization', 'cookie', 'set-cookie', ...additionalSensitiveHeaders.map(name => name.toLowerCase())])
  return Object.fromEntries(headerEntries(source).map(([name, value]) => [name, sensitive.has(name.toLowerCase()) ? '[REDACTED]' : value]))
}

function redactAllHeaders(source: IncomingHttpHeaders | OutgoingHttpHeaders): Record<string, string | string[]> {
  return Object.fromEntries(headerEntries(source).map(([name]) => [name, '[REDACTED]']))
}

function redactWithoutExtraNames(source: IncomingHttpHeaders | OutgoingHttpHeaders): Record<string, string | string[]> {
  return redactHeaders(source, [])
}

function forwardClientHeaders(source: IncomingHttpHeaders): Record<string, string | string[]> {
  return Object.fromEntries(headerEntries(source))
}

function dropProviderKey(source: IncomingHttpHeaders, auth: ProtocolAuthHeaders, contentLength: number): Record<string, string | string[]> {
  return createUpstreamRequestHeaders(source, { replace: {}, fill: auth.fill }, contentLength)
}

function dropAccept(source: IncomingHttpHeaders, auth: ProtocolAuthHeaders, contentLength: number): Record<string, string | string[]> {
  const built = { ...createUpstreamRequestHeaders(source, auth, contentLength) }
  delete built.accept
  return built
}

function keepHopByHop(source: IncomingHttpHeaders, auth: ProtocolAuthHeaders, contentLength: number): Record<string, string | string[]> {
  return { ...createUpstreamRequestHeaders(source, auth, contentLength), connection: 'keep-alive' }
}

function credentialFixtureWithoutBearer(): RedactionCases {
  return { ...defaultRedactionCases(), headers: { ...CREDENTIAL_HEADERS, authorization: 'Bearer ok' } }
}

function expectationStoresBearer(): RedactionCases {
  return { ...defaultRedactionCases(), redacted: { ...REDACTED_CREDENTIAL_HEADERS, authorization: CLIENT_BEARER } }
}

function customExpectationKeepsKey(): RedactionCases {
  return {
    ...defaultRedactionCases(),
    customNames: [],
    customRedacted: { 'X-Custom-Key': PROVIDER_KEY, accept: 'application/json' },
  }
}

function upstreamFixtureWithoutBearer(): UpstreamCases {
  return { ...defaultUpstreamCases(), clientHeaders: { ...UPSTREAM_CLIENT_HEADERS, authorization: 'Bearer ok' } }
}

function forwardedKeepsBearer(): UpstreamCases {
  return { ...defaultUpstreamCases(), forwarded: { ...UPSTREAM_FORWARDED_HEADERS, authorization: CLIENT_BEARER } }
}

function wiringProbe(id: string, audit: WiringAudit, sources: Layer1Sources, responseNeedle: string, responseReplacement: string, headersNeedle: string, headersReplacement: string): ProbeResult {
  const responseTest = responseNeedle === '' ? sources.responseTest : mutate(sources.responseTest, responseNeedle, responseReplacement)
  const headersTest = headersNeedle === '' ? sources.headersTest : mutate(sources.headersTest, headersNeedle, headersReplacement)
  if (responseTest === null || headersTest === null) return { id, caught: false }
  return caught(id, audit({ responseTest, headersTest }))
}

export function evaluateFailoverHarness(audit: FailoverAudit): HarnessVerdict {
  const classifier: StatusClassifier = { classifyUpstreamStatus, isClientAttributableStatus }
  const cases = defaultFailoverCases()
  return verdictFrom(audit(classifier), [
    caught('five-hundred-counted-as-success', audit(classifyWithOverride(500, 'success'))),
    caught('two-hundred-counted-as-failover', audit(classifyWithOverride(200, 'failover'))),
    caught('auth-failure-blamed-on-client', audit(attributeWithOverride(401, true))),
    caught('rate-limit-blamed-on-client', audit(attributeWithOverride(429, true))),
    caught('malformed-request-treated-as-retryable', audit(attributeWithOverride(422, false))),
    caught('failover-table-swaps-401-for-418', audit(classifier, swapFailoverStatus(cases, 401, 418))),
    caught('failover-table-swaps-429-for-418', audit(classifier, swapFailoverStatus(cases, 429, 418))),
    caught('client-table-swaps-422-for-401', audit(classifier, swapClientStatus(cases, 422, 401))),
  ])
}

export function evaluateCredentialHarness(audit: RedactionAudit): HarnessVerdict {
  return verdictFrom(audit(redactHeaders), [
    caught('echoes-secrets', audit(echoHeaders)),
    caught('leaks-api-key', audit(redactExceptApiKey)),
    caught('redacts-content-type', audit(redactAllHeaders)),
    caught('ignores-custom-auth-header', audit(redactWithoutExtraNames)),
    caught('fixture-drops-bearer-secret', audit(redactHeaders, credentialFixtureWithoutBearer())),
    caught('expectation-stores-bearer', audit(redactHeaders, expectationStoresBearer())),
    caught('custom-expectation-keeps-key', audit(redactHeaders, customExpectationKeepsKey())),
  ])
}

export function evaluateUpstreamHarness(audit: UpstreamAudit): HarnessVerdict {
  return verdictFrom(audit(createUpstreamRequestHeaders), [
    caught('forwards-client-bearer', audit(forwardClientHeaders)),
    caught('drops-provider-key', audit(dropProviderKey)),
    caught('drops-accept', audit(dropAccept)),
    caught('forwards-hop-by-hop', audit(keepHopByHop)),
    caught('fixture-drops-client-bearer', audit(createUpstreamRequestHeaders, upstreamFixtureWithoutBearer())),
    caught('forwarded-expectation-keeps-bearer', audit(createUpstreamRequestHeaders, forwardedKeepsBearer())),
  ])
}

export function evaluateLayer1Wiring(audit: WiringAudit, sources: Layer1Sources): HarnessVerdict {
  return verdictFrom(audit(sources), [
    wiringProbe('response-test-drops-failover-table', audit, sources, 'it.each(FAILOVER_STATUS_CODES)', 'it.each([500])', '', ''),
    wiringProbe('response-test-drops-harness-import', audit, sources, "from './test-support'", "from './not-the-harness'", '', ''),
    wiringProbe('headers-test-drops-credential-fixture', audit, sources, '', '', 'redactHeaders(CREDENTIAL_HEADERS)', 'redactHeaders(CREDENTIAL_HEADERS_INLINE)'),
    wiringProbe(
      'headers-test-drops-upstream-swap',
      audit,
      sources,
      '',
      '',
      'createUpstreamRequestHeaders(UPSTREAM_CLIENT_HEADERS, UPSTREAM_AUTH, UPSTREAM_CONTENT_LENGTH)',
      'createUpstreamRequestHeaders(UPSTREAM_CLIENT_HEADERS, { replace: {}, fill: {} }, 0)',
    ),
  ])
}
