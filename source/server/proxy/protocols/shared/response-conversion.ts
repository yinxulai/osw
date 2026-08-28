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
  const content: Json[] = []
  const text = asString(message?.content)
  if (text) content.push({ type: 'text', text })
  for (const rawCall of asArray(message?.tool_calls)) {
    const call = asObject(rawCall)
    const fn = asObject(call?.function)
    if (fn && asString(fn.name)) {
      let input: unknown = {}
      try { input = JSON.parse(asString(fn.arguments) ?? '{}') } catch { /* preserve malformed arguments as empty input */ }
      content.push({ type: 'tool_use', id: asString(call?.id) ?? '', name: fn.name, input })
    }
  }
  const usage = openAiUsageToAnthropic(asObject(body.usage))
  return { id: asString(body.id) ?? '', type: 'message', role: 'assistant', model: asString(body.model) ?? '', content, stop_reason: content.some(block => block.type === 'tool_use') ? 'tool_use' : openAiFinishToAnthropicStop(asString(first?.finish_reason)), ...(usage ? { usage } : {}) }
}

interface OpenAiToAnthropicState {
  started: boolean
  textBlock: boolean
  toolBlocks: Set<number>
  stopped: boolean
  stopReason?: string
  usage?: Json
  id: string
  model: string
}

function openAiChunkToAnthropicEvents(chunk: Json, state: OpenAiToAnthropicState): Json[] {
  const events: Json[] = []
  const choices = asArray(chunk.choices)
  const first = asObject(choices[0])
  const delta = asObject(first?.delta)
  const id = asString(chunk.id) ?? state.id
  const model = asString(chunk.model) ?? state.model
  state.id = id
  state.model = model

  if (!state.started && (id || model || delta?.content || delta?.tool_calls || first?.finish_reason || chunk.usage)) {
    state.started = true
    events.push({ type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } } })
  }

  const text = asString(delta?.content)
  if (text) {
    if (!state.textBlock) {
      state.textBlock = true
      events.push({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    }
    events.push({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  }

  for (const rawCall of asArray(delta?.tool_calls)) {
    const call = asObject(rawCall)
    const index = asNumber(call?.index) ?? 0
    const fn = asObject(call?.function)
    if (!state.toolBlocks.has(index)) {
      state.toolBlocks.add(index)
      events.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: asString(call?.id) ?? '', name: asString(fn?.name) ?? '', input: {} } })
    }
    const argumentsDelta = asString(fn?.arguments)
    if (argumentsDelta) events.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: argumentsDelta } })
  }

  const finish = asString(first?.finish_reason)
  if (finish) state.stopReason = openAiFinishToAnthropicStop(finish)
  const usage = openAiUsageToAnthropic(asObject(chunk.usage))
  if (usage) state.usage = usage
  if ((usage || finish) && !state.stopped && usage) {
    state.stopped = true
    if (state.textBlock) events.push({ type: 'content_block_stop', index: 0 })
    for (const index of state.toolBlocks) events.push({ type: 'content_block_stop', index })
    events.push({ type: 'message_delta', delta: { stop_reason: state.stopReason ?? 'end_turn', stop_sequence: null }, usage })
    events.push({ type: 'message_stop' })
  }
  return events
}

function finishOpenAiToAnthropic(state: OpenAiToAnthropicState): Json[] {
  if (!state.started || state.stopped) return []
  state.stopped = true
  const events: Json[] = []
  if (state.textBlock) events.push({ type: 'content_block_stop', index: 0 })
  for (const index of state.toolBlocks) events.push({ type: 'content_block_stop', index })
  events.push({ type: 'message_delta', delta: { stop_reason: state.stopReason ?? 'end_turn', stop_sequence: null }, ...(state.usage ? { usage: state.usage } : {}) })
  events.push({ type: 'message_stop' })
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
  const content = asArray(body.content)
  const text = anthropicContentToText(content)
  const toolCalls = content.flatMap(raw => {
    const block = asObject(raw)
    return block?.type === 'tool_use' ? [{ id: asString(block.id) ?? '', type: 'function', function: { name: asString(block.name) ?? '', arguments: JSON.stringify(asObject(block.input) ?? {}) } }] : []
  })
  const usage = anthropicUsageToOpenAi(asObject(body.usage))
  return { id: asString(body.id) ?? '', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: asString(body.model) ?? '', choices: [{ index: 0, message: { role: 'assistant', content: text || null, ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) }, finish_reason: toolCalls.length > 0 ? 'tool_calls' : anthropicStopToOpenAiFinish(asString(body.stop_reason)) }], ...(usage ? { usage } : {}) }
}

interface AnthropicToOpenAiState {
  id: string
  model: string
  toolCalls: Map<number, { id: string; name: string }>
  started: boolean
}

function anthropicEventToOpenAiChunks(event: Json, state: AnthropicToOpenAiState): Json[] {
  const chunks: Json[] = []
  const message = asObject(event.message)
  if (event.type === 'message_start') {
    state.started = true
    state.id = asString(message?.id) ?? state.id
    state.model = asString(message?.model) ?? state.model
    chunks.push({ id: state.id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: state.model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })
  } else if (event.type === 'content_block_start') {
    const block = asObject(event.content_block)
    const index = asNumber(event.index) ?? 0
    if (block?.type === 'tool_use') {
      const id = asString(block.id) ?? ''
      const name = asString(block.name) ?? ''
      state.toolCalls.set(index, { id, name })
      chunks.push({ id: state.id, object: 'chat.completion.chunk', model: state.model, choices: [{ index: 0, delta: { tool_calls: [{ index, id, type: 'function', function: { name, arguments: '' } }] }, finish_reason: null }] })
    }
  } else if (event.type === 'content_block_delta') {
    const delta = asObject(event.delta)
    const index = asNumber(event.index) ?? 0
    const text = delta?.type === 'text_delta' ? asString(delta.text) : undefined
    const partialJson = delta?.type === 'input_json_delta' ? asString(delta.partial_json) : undefined
    if (text) chunks.push({ id: state.id, object: 'chat.completion.chunk', model: state.model, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })
    if (partialJson) chunks.push({ id: state.id, object: 'chat.completion.chunk', model: state.model, choices: [{ index: 0, delta: { tool_calls: [{ index, function: { arguments: partialJson } }] }, finish_reason: null }] })
  } else if (event.type === 'message_delta') {
    const usage = anthropicUsageToOpenAi(asObject(event.usage))
    chunks.push({ id: state.id, object: 'chat.completion.chunk', model: state.model, choices: [{ index: 0, delta: {}, finish_reason: anthropicStopToOpenAiFinish(asString(asObject(event.delta)?.stop_reason)) }], ...(usage ? { usage } : {}) })
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
