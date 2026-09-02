import type http from 'node:http'
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http'
import type { Protocol, RawUsage, RequestAttribute, RequestStatus } from '@common/schemas'
import type { ProxyObservationHooks } from '@server/proxy/observability/hooks'

export interface RequestLoggingInput {
  requestId: string
  logicalModelId: string
  clientProtocol: Protocol
  method: string
  path: string
  headers: http.IncomingHttpHeaders
  attributes?: Array<Omit<RequestAttribute, 'requestId' | 'createdTime'>>
  requestBody: Buffer
  captureRequestContent: boolean
}

export interface RequestLogMetrics {
  ttftMilliseconds?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  cachedInputTokens?: number | null
  cacheCreationInputTokens?: number | null
  reasoningTokens?: number | null
  promptCacheHit?: boolean | null
  rawUsage?: RawUsage | null
  upstreamProtocol?: Protocol | null
}

export interface RequestLogOutcome {
  statusCode: number
  captureStatus?: 'captured' | 'partial'
  responseStatus?: number
  responseHeaders?: string
  upstreamResponseHeaders?: string
  clientResponseHeaders?: string
  responseBody?: string | null
}

export interface AttemptLogSnapshot {
  providerId: string
  providerModelId: string
  providerName: string
  providerModelName: string
  upstreamProtocol: Protocol
  url: string
}

export interface AttemptUsageInput {
  inputTokens?: number | null
  outputTokens?: number | null
  reasoningTokens?: number | null
  cachedInputTokens?: number | null
  cacheCreationInputTokens?: number | null
  rawUsage?: RawUsage | null
}

export interface AttemptFinalizationInput {
  status: RequestStatus
  httpStatus: number | null
  retryable: boolean
  errorCode?: string
  errorMessage?: string
  upstreamRequestId?: string | null
  usage?: AttemptUsageInput
  content?: Omit<AttemptContentInput, 'attemptId'>
}

export interface AttemptContentInput {
  attemptId: string | null
  captureStatus: 'captured' | 'partial'
  responseStatus: number | null
  upstreamResponseHeaders: IncomingHttpHeaders | null
  clientResponseHeaders: IncomingHttpHeaders | OutgoingHttpHeaders | null
  responseBody: string | null
  convertedResponseBody?: string | null
  streaming?: boolean
}

export interface AttemptLoggingInput {
  requestId: string
  attemptIndex: number
  startedAt: number
  snapshot: AttemptLogSnapshot
  method: string
  path: string
  requestHeaders: http.IncomingHttpHeaders
  requestBody: Buffer
  upstreamRequestHeaders: http.OutgoingHttpHeaders
  upstreamRequestBody: Buffer
  requestRewriteRuleIds?: string[]
  customAuthHeader?: string | null
  clientProtocol: Protocol
  upstreamProtocol: Protocol
  requiresResponseConversion: boolean
  captureRequestContent: boolean
  hooks: ProxyObservationHooks
}

export interface RequestLogger {
  readonly requestContentId: string | null
  finalizeRequestLog(status: RequestStatus, startedAt: number, metrics?: RequestLogMetrics): Promise<void>
  finalizeRequestContent(outcome: RequestLogOutcome): Promise<void>
  finalizeLocalErrorContent(statusCode: number, responseHeaders: IncomingHttpHeaders | OutgoingHttpHeaders, responseBody: string): Promise<void>
  recordAttempt(status: RequestStatus, httpStatus: number | null, retryable: boolean, errorCode?: string, errorMessage?: string, upstreamRequestId?: string | null, usage?: AttemptUsageInput): Promise<{ id: string } | null>
  recordAttemptContent(input: AttemptContentInput): Promise<void>
}
