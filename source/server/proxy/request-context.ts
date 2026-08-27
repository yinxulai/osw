import type { IncomingHttpHeaders } from 'node:http'
import type { Protocol, RequestAttribute } from '@common/schemas'

export interface RequestContext {
  readonly requestId: string
  readonly logicalModelId: string
  readonly clientProtocol: Protocol
  readonly method: string
  readonly path: string
  readonly headers: IncomingHttpHeaders
  readonly attributes: Array<Omit<RequestAttribute, 'requestId' | 'createdTime'>>
  readonly requestBody: Buffer
  readonly signal: AbortSignal
}

export type RequestContextInput = Omit<RequestContext, 'signal' | 'headers' | 'attributes'> & { headers?: IncomingHttpHeaders, attributes?: Array<Omit<RequestAttribute, 'requestId' | 'createdTime'>>, signal?: AbortSignal }

export function createRequestContext(input: RequestContextInput): RequestContext {
  return {
    ...input,
    headers: input.headers ?? {},
    attributes: input.attributes ?? [],
    signal: input.signal ?? new AbortController().signal,
  }
}
