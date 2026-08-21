import type { IncomingHttpHeaders } from 'node:http'
import type { Protocol } from '@common/schemas'

export interface RequestContext {
  readonly requestId: string
  readonly logicalModelId: string
  readonly clientProtocol: Protocol
  readonly method: string
  readonly path: string
  readonly headers: IncomingHttpHeaders
  readonly requestBody: Buffer
  readonly signal: AbortSignal
}

export type RequestContextInput = Omit<RequestContext, 'signal' | 'headers'> & { headers?: IncomingHttpHeaders, signal?: AbortSignal }

export function createRequestContext(input: RequestContextInput): RequestContext {
  return {
    ...input,
    headers: input.headers ?? {},
    signal: input.signal ?? new AbortController().signal,
  }
}
