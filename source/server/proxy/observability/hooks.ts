import type { Protocol, RawUsage, RequestStatus } from '@common/schemas'
import type { RequestContext } from '@server/proxy/request/request-context'

export interface AttemptObservation {
  requestId: string
  attemptIndex: number
  status: RequestStatus
  httpStatus: number | null
  retryable: boolean
  providerId: string
  providerModelId: string
  upstreamProtocol: Protocol
  durationMilliseconds: number
  usage?: {
    inputTokens: number | null
    outputTokens: number | null
    reasoningTokens: number | null
    cachedInputTokens: number | null
    cacheCreationInputTokens: number | null
    rawUsage: RawUsage | null
  }
}

export interface ContentObservation {
  requestId: string
  attemptId: string | null
  captureStatus: 'captured' | 'partial'
  responseStatus: number | null
  responseBody: string | null
}

export interface ProxyObservationHooks {
  onRequestStarted?(context: RequestContext): void | Promise<void>
  onAttemptRecorded?(observation: AttemptObservation): void | Promise<void>
  onContentCaptured?(observation: ContentObservation): void | Promise<void>
}

export const NOOP_PROXY_OBSERVATION_HOOKS: ProxyObservationHooks = {}
