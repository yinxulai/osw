import type { RawUsage } from '@common/schemas'
import type { ProtocolAdapter, StreamConverter } from './protocols/types'
import type { HeaderMap } from './headers'

export interface ExtractedUsage {
  inputTokens: number | null
  outputTokens: number | null
  cachedInputTokens: number | null
  cacheCreationInputTokens: number | null
  rawUsage: RawUsage | null
}

export interface ResponsePipelineResult {
  upstreamBody: string | null
  downstreamBody: string | null
  usage: ExtractedUsage
}

export interface ResponseSink {
  readonly writableEnded: boolean
  write(chunk: string): void
  end(): void
}

export interface ResponsePipelineOptions {
  adapter: ProtocolAdapter
  isStreaming: boolean
  captureEnabled: boolean
  response: ResponseSink
  upstreamHeaders: HeaderMap
  onStart?(headers: HeaderMap): void
  transformResponse?(body: Buffer, headers: HeaderMap): { body: Buffer; headers: HeaderMap }
  onUsage(usage: ExtractedUsage): void
  onUpstreamChunk(chunk: string): void
  onDownstreamChunk(chunk: string): void
}

export class ResponsePipeline {
  private responseBuffer = ''
  private readonly upstreamChunks: string[] = []
  private readonly downstreamChunks: string[] = []
  private readonly streamConverter: StreamConverter | null
  private usage: ExtractedUsage = emptyUsage()

  constructor(private readonly options: ResponsePipelineOptions) {
    this.streamConverter = options.adapter.requiresResponseConversion && options.isStreaming
      ? options.adapter.createStreamConverter()
      : null
  }

  push(chunk: Buffer | string, successful: boolean): void {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    if (this.options.captureEnabled) {
      this.upstreamChunks.push(text)
      this.options.onUpstreamChunk(text)
    }

    if (successful) {
      this.responseBuffer += text
      if (this.options.isStreaming) this.consumeSseLines()
    } else {
    }

    if (this.options.response.writableEnded) return
    if (this.streamConverter) {
      const converted = this.streamConverter.push(text)
      if (converted) this.writeDownstream(converted)
      return
    }
    if (this.options.isStreaming) {
      this.writeDownstream(text)
    }
  }

  finish(successful: boolean, errorBody: string | null): ResponsePipelineResult {
    if (successful) {
      if (this.options.isStreaming) {
        this.consumeSseLine(this.responseBuffer)
      } else {
        this.consumeJson(this.responseBuffer)
      }
    }

    let finalBody: Buffer<ArrayBufferLike> = this.responseBuffer ? Buffer.from(this.responseBuffer) : Buffer.from(errorBody ?? '')
    let finalHeaders: HeaderMap = { ...this.options.upstreamHeaders }
    if (!this.options.response.writableEnded) {
      if (this.streamConverter) {
        const tail = this.options.adapter.finishStream(this.streamConverter)
        if (tail) this.writeDownstream(tail)
      } else if (this.options.adapter.requiresResponseConversion && !this.options.isStreaming && this.responseBuffer) {
        try {
          finalBody = this.options.adapter.convertResponse(finalBody)
        } catch {
          finalBody = Buffer.from(this.responseBuffer)
        }
        if (this.options.transformResponse && successful) {
          const transformed = this.options.transformResponse(finalBody, finalHeaders)
          finalBody = transformed.body
          finalHeaders = transformed.headers
        }
        this.options.onStart?.(finalHeaders)
        this.writeDownstream(finalBody.toString('utf8'))
      } else if (!this.options.isStreaming && successful && this.options.transformResponse) {
        const transformed = this.options.transformResponse(finalBody, finalHeaders)
        finalBody = transformed.body
        finalHeaders = transformed.headers
        this.options.onStart?.(finalHeaders)
        this.writeDownstream(finalBody.toString('utf8'))
      } else {
        this.options.onStart?.(finalHeaders)
        if (this.options.adapter.requiresResponseConversion || !this.options.isStreaming) this.writeDownstream(finalBody.toString('utf8'))
      }
      this.options.response.end()
    }

    return {
      upstreamBody: this.options.isStreaming
        ? serializeStreamingChunks(this.upstreamChunks)
        : (successful ? this.responseBuffer : errorBody),
      downstreamBody: this.options.isStreaming
        ? serializeStreamingChunks(this.downstreamChunks)
        : (this.downstreamChunks.join('') || (successful ? finalBody.toString('utf8') : errorBody) || null),
      usage: this.usage,
    }
  }

  partialBody(): string | null {
    return this.options.isStreaming
      ? serializeStreamingChunks(this.upstreamChunks)
      : (this.responseBuffer || null)
  }

  getUsage(): ExtractedUsage {
    return this.usage
  }

  downstreamHeaders(): string {
    return JSON.stringify(this.options.upstreamHeaders)
  }

  private writeDownstream(chunk: string): void {
    if (this.options.captureEnabled) this.downstreamChunks.push(chunk)
    this.options.onDownstreamChunk(chunk)
    this.options.response.write(chunk)
  }

  private consumeSseLines(): void {
    const lines = this.responseBuffer.split('\n')
    this.responseBuffer = lines.pop() ?? ''
    for (const line of lines) this.consumeSseLine(line)
  }

  private consumeSseLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') return
    this.consumeJson(data)
  }

  private consumeJson(body: string): void {
    try {
      const data = JSON.parse(body) as Record<string, unknown>
      const usage = extractTokenUsage(data)
      this.usage = mergeUsage(this.usage, usage)
      this.options.onUsage(usage)
    } catch {
      // Usage is best-effort; malformed provider events must still be forwarded.
    }
  }
}

function emptyUsage(): ExtractedUsage {
  return { inputTokens: null, outputTokens: null, cachedInputTokens: null, cacheCreationInputTokens: null, rawUsage: null }
}

function extractTokenUsage(data: Record<string, unknown>): ExtractedUsage {
  const candidates: RawUsage[] = []
  collectUsage(data.usage, candidates)
  collectUsage(asRecord(data.message)?.usage, candidates)
  collectUsage(asRecord(data.response)?.usage, candidates)
  if (Array.isArray(data.output)) {
    for (const item of data.output) collectUsage(asRecord(item)?.usage, candidates)
  }

  let rawUsage: RawUsage | null = null
  for (const candidate of candidates) rawUsage = mergeRawUsage(rawUsage, candidate)
  const cacheCreation = asRecord(rawUsage?.cache_creation)
  return {
    inputTokens: firstNumber(rawUsage?.prompt_tokens, rawUsage?.input_tokens, rawUsage?.total_input_tokens, rawUsage?.promptTokenCount, data.input_tokens, data.prompt_tokens),
    outputTokens: firstNumber(rawUsage?.completion_tokens, rawUsage?.output_tokens, rawUsage?.total_output_tokens, rawUsage?.candidatesTokenCount, data.output_tokens, data.completion_tokens),
    cachedInputTokens: firstNumber(asRecord(rawUsage?.prompt_tokens_details)?.cached_tokens, asRecord(rawUsage?.input_tokens_details)?.cached_tokens, rawUsage?.cache_read_input_tokens, rawUsage?.cached_input_tokens, rawUsage?.cache_read_tokens, rawUsage?.cachedContentTokenCount),
    cacheCreationInputTokens: firstNumber(rawUsage?.cache_creation_input_tokens, rawUsage?.cache_creation_tokens, rawUsage?.cached_creation_input_tokens, sumNumbers(cacheCreation?.ephemeral_5m_input_tokens, cacheCreation?.ephemeral_1h_input_tokens)),
    rawUsage,
  }
}

function mergeUsage(current: ExtractedUsage, incoming: ExtractedUsage): ExtractedUsage {
  return {
    inputTokens: incoming.inputTokens ?? current.inputTokens,
    outputTokens: incoming.outputTokens ?? current.outputTokens,
    cachedInputTokens: incoming.cachedInputTokens ?? current.cachedInputTokens,
    cacheCreationInputTokens: incoming.cacheCreationInputTokens ?? current.cacheCreationInputTokens,
    rawUsage: mergeRawUsage(current.rawUsage, incoming.rawUsage),
  }
}

function collectUsage(value: unknown, target: RawUsage[]): void {
  const usage = asRecord(value)
  if (usage) target.push(usage)
}

function asRecord(value: unknown): RawUsage | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RawUsage : null
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

function sumNumbers(...values: unknown[]): number | null {
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) : null
}

function mergeRawUsage(current: RawUsage | null, incoming: RawUsage | null): RawUsage | null {
  if (!incoming) return current
  if (!current) return { ...incoming }
  const merged: RawUsage = { ...current }
  for (const [key, value] of Object.entries(incoming)) {
    const currentValue = asRecord(merged[key])
    const incomingValue = asRecord(value)
    merged[key] = currentValue && incomingValue ? mergeRawUsage(currentValue, incomingValue) : value
  }
  return merged
}

function serializeStreamingChunks(chunks: string[]): string {
  return JSON.stringify({ schemaVersion: 1, chunks })
}
