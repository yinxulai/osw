import type { Protocol } from '@common/schemas'
import {
  type OpenAiToAnthropicState,
  finishOpenAiToAnthropic,
  openAiChunkToAnthropicEvents,
  openAiResponseToAnthropic,
} from './response-conversion-openai-to-anthropic'
import { openAiChunkToResponsesEvents, openAiResponseToResponses } from './response-conversion-openai-to-responses'
import {
  type AnthropicToOpenAiState,
  anthropicEventToOpenAiChunks,
  anthropicResponseToOpenAi,
} from './response-conversion-anthropic-to-openai'

/**
 * 响应转换：将上游端点协议的响应（含 SSE 流）转换回客户端协议的响应。
 * 流式转换采用增量方式：每个上游 SSE event 转换为一个下游 SSE event，
 * 不做跨 event 聚合，保证低延迟透传。
 */

type Json = Record<string, unknown>

// ========== SSE 解析与序列化 ==========

export interface SseEvent {
  event?: string
  data: string
}

/** 将 SSE 文本增量解析为完整事件；返回 [事件列表, 剩余不完整文本] */
export function parseSseIncremental(buffer: string): [SseEvent[], string] {
  const events: SseEvent[] = []
  let rest = buffer
  const boundary = /\r?\n\r?\n/
  for (;;) {
    const match = boundary.exec(rest)
    if (!match || match.index < 0) break
    const raw = rest.slice(0, match.index)
    rest = rest.slice(match.index + match[0].length)
    let eventName: string | undefined
    const dataLines: string[] = []
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue
      const separator = line.indexOf(':')
      const field = separator < 0 ? line : line.slice(0, separator)
      const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '')
      if (field === 'event') eventName = value
      else if (field === 'data') dataLines.push(value)
    }
    if (dataLines.length > 0) events.push({ event: eventName, data: dataLines.join('\n') })
  }
  return [events, rest]
}

export function serializeSseEvent(event: SseEvent): string {
  let out = ''
  if (event.event) out += `event: ${event.event}\n`
  out += `data: ${event.data}\n\n`
  return out
}

// ========== 响应转换入口 ==========

/** 非流式响应转换 */
export function convertResponseBody(clientProtocol: Protocol, endpointProtocol: Protocol, body: Buffer): Buffer {
  if (clientProtocol === endpointProtocol) {
    throw new Error(`同协议响应不应进入转换路径: ${clientProtocol}`)
  }

  const payload = JSON.parse(body.toString('utf8')) as Json

  if (endpointProtocol === 'openai-completions' && clientProtocol === 'anthropic-messages') {
    return Buffer.from(JSON.stringify(openAiResponseToAnthropic(payload)))
  }
  if (endpointProtocol === 'openai-completions' && clientProtocol === 'openai-responses') {
    return Buffer.from(JSON.stringify(openAiResponseToResponses(payload)))
  }
  if (endpointProtocol === 'anthropic-messages' && clientProtocol === 'openai-completions') {
    return Buffer.from(JSON.stringify(anthropicResponseToOpenAi(payload)))
  }
  throw new Error(`不支持的响应转换方向: ${endpointProtocol} -> ${clientProtocol}`)
}

/**
 * 流式响应转换器：喂入上游 SSE 文本增量，产出下游 SSE 文本。
 * 用法：const converter = createSseConverter(...); out = converter.push(chunk); out += converter.flush()
 */
export function createSseConverter(clientProtocol: Protocol, endpointProtocol: Protocol) {
  if (clientProtocol === endpointProtocol) {
    throw new Error(`同协议流式响应不应进入转换路径: ${clientProtocol}`)
  }

  let buffer = ''
  const openAiState: OpenAiToAnthropicState = { started: false, textBlock: false, toolBlocks: new Set(), stopped: false, id: '', model: '' }
  const anthropicState: AnthropicToOpenAiState = { id: '', model: '', toolCalls: new Map(), started: false }

  const convertEvent = (event: SseEvent): string => {
    let payload: Json
    try {
      payload = JSON.parse(event.data) as Json
    } catch {
      // OpenAI 的 [DONE] 只作为流结束信号，不应暴露为 Anthropic JSON 事件。
      return event.data.trim() === '[DONE]' && endpointProtocol === 'openai-completions' && clientProtocol === 'anthropic-messages'
        ? ''
        : serializeSseEvent(event)
    }

    let outputs: Json[] = []
    if (endpointProtocol === 'openai-completions' && clientProtocol === 'anthropic-messages') {
      outputs = openAiChunkToAnthropicEvents(payload, openAiState)
    } else if (endpointProtocol === 'openai-completions' && clientProtocol === 'openai-responses') {
      outputs = openAiChunkToResponsesEvents(payload)
    } else if (endpointProtocol === 'anthropic-messages' && clientProtocol === 'openai-completions') {
      outputs = anthropicEventToOpenAiChunks(payload, anthropicState)
    }

    let out = ''
    for (const item of outputs) out += serializeSseEvent({ data: JSON.stringify(item) })
    return out
  }

  return {
    push(chunk: string): string {
      buffer += chunk
      const [events, rest] = parseSseIncremental(buffer)
      buffer = rest
      let out = ''
      for (const event of events) out += convertEvent(event)
      return out
    },
    flush(): string {
      if (!buffer.trim()) return ''
      const raw = buffer
      buffer = ''
      // 剩余文本可能已含 data: 前缀，也可能只是裸 JSON
      const stripped = raw
        .split('\n')
        .map(line => (line.startsWith('data:') ? line.slice(5).trim() : line))
        .join('\n')
      let out = stripped.trim() ? convertEvent({ data: stripped }) : ''
      if (endpointProtocol === 'openai-completions' && clientProtocol === 'anthropic-messages') {
        for (const item of finishOpenAiToAnthropic(openAiState)) out += serializeSseEvent({ data: JSON.stringify(item) })
      }
      return out
    },
    finish: () => {
      let out = ''
      if (endpointProtocol === 'openai-completions' && clientProtocol === 'anthropic-messages') {
        for (const item of finishOpenAiToAnthropic(openAiState)) out += serializeSseEvent({ data: JSON.stringify(item) })
      }
      return out
    },
  }
}
