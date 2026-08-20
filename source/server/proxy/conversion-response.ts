import type { Protocol } from '@common/schemas'

/**
 * 响应转换：将上游端点协议的响应（含 SSE 流）转换回客户端协议的响应。
 * 流式转换采用增量方式：每个上游 SSE event 转换为一个下游 SSE event，
 * 不做跨 event 聚合，保证低延迟透传。
 */

type Json = Record<string, unknown>

function asObject(value: unknown): Json | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

// ========== OpenAI Completions 响应 -> Anthropic Messages 响应 ==========

function openAiUsageToAnthropic(usage: Json | null): Json | undefined {
  if (!usage) return undefined
  const input = asNumber(usage.prompt_tokens)
  const output = asNumber(usage.completion_tokens)
  if (input === undefined && output === undefined) return undefined
  const cached = asNumber(asObject(usage.prompt_tokens_details)?.cached_tokens)
  return {
    input_tokens: input ?? 0,
    output_tokens: output ?? 0,
    ...(cached !== undefined ? { cache_read_input_tokens: cached } : {}),
  }
}

function openAiFinishToAnthropicStop(finish: string | undefined): string {
  switch (finish) {
    case 'stop': return 'end_turn'
    case 'length': return 'max_tokens'
    case 'content_filter': return 'refusal'
    case 'function_call':
    case 'tool_calls': return 'tool_use'
    default: return 'end_turn'
  }
}

function openAiResponseToAnthropic(body: Json): Json {
  const choices = asArray(body.choices)
  const first = asObject(choices[0])
  const message = asObject(first?.message)
  const text = asString(message?.content) ?? ''
  const usage = openAiUsageToAnthropic(asObject(body.usage))

  return {
    id: asString(body.id) ?? '',
    type: 'message',
    role: 'assistant',
    model: asString(body.model) ?? '',
    content: text ? [{ type: 'text', text }] : [],
    stop_reason: openAiFinishToAnthropicStop(asString(first?.finish_reason)),
    ...(usage ? { usage } : {}),
  }
}

function openAiChunkToAnthropicEvents(chunk: Json): Json[] {
  const events: Json[] = []
  const choices = asArray(chunk.choices)
  const delta = asObject(asObject(choices[0])?.delta)
  const text = asString(delta?.content)

  if (text) {
    events.push({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text },
    })
  }

  const usage = openAiUsageToAnthropic(asObject(chunk.usage))
  if (usage) {
    events.push({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage })
  }

  return events
}

// ========== OpenAI Completions 响应 -> OpenAI Responses 响应 ==========

function openAiResponseToResponses(body: Json): Json {
  const choices = asArray(body.choices)
  const first = asObject(choices[0])
  const message = asObject(first?.message)
  const text = asString(message?.content) ?? ''
  const usage = asObject(body.usage)

  return {
    id: asString(body.id) ?? '',
    object: 'response',
    status: 'completed',
    model: asString(body.model) ?? '',
    output: text
      ? [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }]
      : [],
    ...(usage ? { usage } : {}),
  }
}

function openAiChunkToResponsesEvents(chunk: Json): Json[] {
  const events: Json[] = []
  const choices = asArray(chunk.choices)
  const delta = asObject(asObject(choices[0])?.delta)
  const text = asString(delta?.content)

  if (text) {
    events.push({
      type: 'response.output_text.delta',
      delta: text,
    })
  }

  const usage = asObject(chunk.usage)
  if (usage) {
    events.push({ type: 'response.completed', response: { usage } })
  }

  return events
}

// ========== Anthropic Messages 响应 -> OpenAI Completions 响应 ==========

function anthropicContentToText(content: unknown): string {
  return asArray(content)
    .map(block => {
      const record = asObject(block)
      return record?.type === 'text' ? (asString(record.text) ?? '') : ''
    })
    .join('')
}

function anthropicUsageToOpenAi(usage: Json | null): Json | undefined {
  if (!usage) return undefined
  const input = asNumber(usage.input_tokens)
  const output = asNumber(usage.output_tokens)
  if (input === undefined && output === undefined) return undefined
  const cached = asNumber(usage.cache_read_input_tokens)
  return {
    prompt_tokens: input ?? 0,
    completion_tokens: output ?? 0,
    ...(cached !== undefined
      ? { prompt_tokens_details: { cached_tokens: cached } }
      : {}),
  }
}

function anthropicStopToOpenAiFinish(stop: string | undefined): string {
  switch (stop) {
    case 'end_turn': return 'stop'
    case 'max_tokens': return 'length'
    case 'stop_sequence': return 'stop'
    case 'tool_use': return 'tool_calls'
    default: return 'stop'
  }
}

function anthropicResponseToOpenAi(body: Json): Json {
  const text = anthropicContentToText(body.content)
  const usage = anthropicUsageToOpenAi(asObject(body.usage))

  return {
    id: asString(body.id) ?? '',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: asString(body.model) ?? '',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: anthropicStopToOpenAiFinish(asString(body.stop_reason)),
      },
    ],
    ...(usage ? { usage } : {}),
  }
}

function anthropicEventToOpenAiChunks(event: Json): Json[] {
  const chunks: Json[] = []

  if (event.type === 'content_block_delta') {
    const delta = asObject(event.delta)
    const text = delta?.type === 'text_delta' ? asString(delta.text) : undefined
    if (text) {
      chunks.push({
        id: '',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
      })
    }
  } else if (event.type === 'message_delta') {
    const usage = anthropicUsageToOpenAi(asObject(event.usage))
    chunks.push({
      id: '',
      object: 'chat.completion.chunk',
      choices: [{
        index: 0,
        delta: {},
        finish_reason: anthropicStopToOpenAiFinish(asString(asObject(event.delta)?.stop_reason)),
      }],
      ...(usage ? { usage } : {}),
    })
  }

  return chunks
}

// ========== SSE 解析与序列化 ==========

export interface SseEvent {
  event?: string
  data: string
}

/** 将 SSE 文本增量解析为完整事件；返回 [事件列表, 剩余不完整文本] */
export function parseSseIncremental(buffer: string): [SseEvent[], string] {
  const events: SseEvent[] = []
  let rest = buffer

  for (;;) {
    const index = rest.indexOf('\n\n')
    if (index === -1) break
    const raw = rest.slice(0, index)
    rest = rest.slice(index + 2)

    let eventName: string | undefined
    const dataLines: string[] = []
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
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
export function convertResponseBody(
  clientProtocol: Protocol,
  endpointProtocol: Protocol,
  body: Buffer,
): Buffer {
  if (clientProtocol === endpointProtocol) return body

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
    return {
      push: (chunk: string) => chunk,
      flush: () => '',
    }
  }

  let buffer = ''

  const convertEvent = (event: SseEvent): string => {
    let payload: Json
    try {
      payload = JSON.parse(event.data) as Json
    } catch {
      // 非 JSON 事件（如 [DONE]）直接透传
      return serializeSseEvent(event)
    }

    let outputs: Json[] = []
    if (endpointProtocol === 'openai-completions' && clientProtocol === 'anthropic-messages') {
      outputs = openAiChunkToAnthropicEvents(payload)
    } else if (endpointProtocol === 'openai-completions' && clientProtocol === 'openai-responses') {
      outputs = openAiChunkToResponsesEvents(payload)
    } else if (endpointProtocol === 'anthropic-messages' && clientProtocol === 'openai-completions') {
      outputs = anthropicEventToOpenAiChunks(payload)
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
      const out = convertEvent({ data: buffer })
      buffer = ''
      return out
    },
  }
}
