import type { IncomingMessage } from 'node:http'
import type { Protocol } from '@common/schemas'

export interface RequestContext {
  readonly requestId: string
  readonly logicalModelId: string
  readonly clientProtocol: Protocol
  readonly method: string
  readonly path: string
  readonly requestBody: Buffer
  readonly request: IncomingMessage
  readonly signal: AbortSignal
}

export type RequestContextInput = Omit<RequestContext, 'signal'> & { signal?: AbortSignal }

export function createRequestContext(input: RequestContextInput): RequestContext {
  return {
    ...input,
    signal: input.signal ?? new AbortController().signal,
  }
}
