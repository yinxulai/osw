/**
 * 故障切换和凭据处理这两类单测共用的夹具。
 *
 * 第一层是 `response.test.ts` 与 `headers.test.ts`。它们用这里的**状态码区间**和请求头夹具
 * 锁定三件最高风险的事：非 2xx 要换通道、报文错误才归到客户端、密钥不能进日志也不能原样转给上游。
 *
 * `audit*` 把这些断言收成可复用的检查：生产函数能不能过，夹具还在不在。
 * `evaluate*` 是第二层：检查本身必须放行健康主体，并且拦住故意写坏的主体或夹具。
 * 第三层在 `test-support.meta.test.ts`，确认 `evaluate*` 不会把写坏的检查判成健康。
 *
 * 「测试有没有接线」不在这里：那由覆盖率回答，不用正则读回测试源码——那种检查格式化一下就误报、
 * 加一行 `.skip` 却照样放行（见 PR 说明）。
 */

import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http'
import type { ProtocolAuthHeaders } from '@common/protocols'
import { createUpstreamRequestHeaders, redactHeaders } from './headers'
import { classifyUpstreamStatus, isClientAttributableStatus } from './response'

/**
 * `isClientAttributableStatus` 的白名单：仅有的「报文格式不成立」类状态码。
 *
 * 它与 `response.ts` 里那份私有 `Set` 是同一件事实的两处声明；`response.test.ts` 拿它
 * 逐码比对生产函数，并单独钉住这四个字面量——「白名单和实现一起被改错」因此不可能变绿。
 */
export const CLIENT_ATTRIBUTABLE_STATUS_CODES: readonly number[] = [400, 413, 414, 422]

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

export type FailoverAudit = (subject: StatusClassifier) => AuditReport
export type RedactionAudit = (redact: HeaderRedactor, cases?: RedactionCases) => AuditReport
export type UpstreamAudit = (build: UpstreamHeaderBuilder, cases?: UpstreamCases) => AuditReport

interface ProbeResult {
  readonly id: string
  readonly caught: boolean
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

function containsText(value: string | string[] | number | undefined, needle: string): boolean {
  if (typeof value === 'string') return value.includes(needle)
  if (Array.isArray(value)) return value.some(item => item.includes(needle))
  return false
}

function serialized(value: unknown): string {
  return JSON.stringify(value) ?? ''
}

function sameRecord(left: Record<string, string | string[] | undefined>, right: Record<string, string | string[] | undefined>): boolean {
  const rightKeys = Object.keys(right).filter(key => right[key] !== undefined)
  if (Object.keys(left).filter(key => left[key] !== undefined).length !== rightKeys.length) return false
  return rightKeys.every(key => JSON.stringify(left[key]) === JSON.stringify(right[key]))
}

function headerEntries(source: IncomingHttpHeaders | OutgoingHttpHeaders): Array<[string, string | string[]]> {
  const entries: Array<[string, string | string[]]> = []
  for (const [name, value] of Object.entries(source)) {
    if (typeof value === 'string' || Array.isArray(value)) entries.push([name, value])
  }
  return entries
}

export function auditFailoverClassifier(subject: StatusClassifier): AuditReport {
  const failures: string[] = []
  // 穷举 100..599，而不是抽查几个点：把 `statusCode < 300` 误写成 `< 250` 这类
  // 区间漂移，抽样表照不到，穷举一条都跑不掉。
  for (let status = 100; status <= 599; status++) {
    const expected = status >= 200 && status < 300 ? 'success' : 'failover'
    const actual = subject.classifyUpstreamStatus(status)
    if (actual !== expected) failures.push(`status ${status} classified as ${actual}, want ${expected}`)
  }
  const attributable = new Set(CLIENT_ATTRIBUTABLE_STATUS_CODES)
  for (let status = 100; status <= 599; status++) {
    const expected = attributable.has(status)
    const actual = subject.isClientAttributableStatus(status)
    if (actual !== expected) failures.push(`status ${status} client-attributable=${actual}, want ${expected}`)
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

function classifyWithShrunkenSuccessInterval(upperBound: number): StatusClassifier {
  // 把「200<=s<300 成功」的上界写窄（如 `< 250`）。区间穷举应该在这个点上失败，
  // 而只抽 200 / 299 / 300 几个点的表是发现不了的。
  return {
    classifyUpstreamStatus: status => status >= 200 && status < upperBound ? 'success' : 'failover',
    isClientAttributableStatus,
  }
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

/**
 * 每一类探针的编号。
 *
 * 第二层生成探针、第三层断言行空都从这几组常量取，两边不可能各写一份编号。
 */
export const FAILOVER_PROBE_IDS = [
  'five-hundred-counted-as-success',
  'shrunken-success-interval',
  'two-hundred-counted-as-failover',
  'auth-failure-blamed-on-client',
  'rate-limit-blamed-on-client',
  'malformed-request-treated-as-retryable',
] as const

export function evaluateFailoverHarness(audit: FailoverAudit): HarnessVerdict {
  const [fiveHundredAsSuccess, shrunkenInterval, twoHundredAsFailover, authBlamedOnClient, rateLimitBlamedOnClient, malformedTreatedAsRetryable] = FAILOVER_PROBE_IDS
  const classifier: StatusClassifier = { classifyUpstreamStatus, isClientAttributableStatus }
  return verdictFrom(audit(classifier), [
    caught(fiveHundredAsSuccess, audit(classifyWithOverride(500, 'success'))),
    caught(shrunkenInterval, audit(classifyWithShrunkenSuccessInterval(250))),
    caught(twoHundredAsFailover, audit(classifyWithOverride(200, 'failover'))),
    caught(authBlamedOnClient, audit(attributeWithOverride(401, true))),
    caught(rateLimitBlamedOnClient, audit(attributeWithOverride(429, true))),
    caught(malformedTreatedAsRetryable, audit(attributeWithOverride(422, false))),
  ])
}

export const CREDENTIAL_PROBE_IDS = [
  'echoes-secrets',
  'leaks-api-key',
  'redacts-content-type',
  'ignores-custom-auth-header',
  'fixture-drops-bearer-secret',
  'expectation-stores-bearer',
  'custom-expectation-keeps-key',
] as const

export function evaluateCredentialHarness(audit: RedactionAudit): HarnessVerdict {
  const [echoesSecrets, leaksApiKey, redactsContentType, ignoresCustomAuthHeader, fixtureDropsBearer, expectationStoresBearerProbe, customExpectationKeepsKeyProbe] = CREDENTIAL_PROBE_IDS
  return verdictFrom(audit(redactHeaders), [
    caught(echoesSecrets, audit(echoHeaders)),
    caught(leaksApiKey, audit(redactExceptApiKey)),
    caught(redactsContentType, audit(redactAllHeaders)),
    caught(ignoresCustomAuthHeader, audit(redactWithoutExtraNames)),
    caught(fixtureDropsBearer, audit(redactHeaders, credentialFixtureWithoutBearer())),
    caught(expectationStoresBearerProbe, audit(redactHeaders, expectationStoresBearer())),
    caught(customExpectationKeepsKeyProbe, audit(redactHeaders, customExpectationKeepsKey())),
  ])
}

export const UPSTREAM_PROBE_IDS = [
  'forwards-client-bearer',
  'drops-provider-key',
  'drops-accept',
  'forwards-hop-by-hop',
  'fixture-drops-client-bearer',
  'forwarded-expectation-keeps-bearer',
] as const

export function evaluateUpstreamHarness(audit: UpstreamAudit): HarnessVerdict {
  const [forwardsClientBearer, dropsProviderKey, dropsAccept, forwardsHopByHop, fixtureDropsClientBearer, forwardedExpectationKeepsBearer] = UPSTREAM_PROBE_IDS
  return verdictFrom(audit(createUpstreamRequestHeaders), [
    caught(forwardsClientBearer, audit(forwardClientHeaders)),
    caught(dropsProviderKey, audit(dropProviderKey)),
    caught(dropsAccept, audit(dropAccept)),
    caught(forwardsHopByHop, audit(keepHopByHop)),
    caught(fixtureDropsClientBearer, audit(createUpstreamRequestHeaders, upstreamFixtureWithoutBearer())),
    caught(forwardedExpectationKeepsBearer, audit(createUpstreamRequestHeaders, forwardedKeepsBearer())),
  ])
}
