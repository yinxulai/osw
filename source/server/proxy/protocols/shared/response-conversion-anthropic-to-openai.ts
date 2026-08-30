export type Json = Record<string, unknown>

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
  const created = asNumber(usage.cache_creation_input_tokens)
  const details = {
    ...(cached !== undefined ? { cached_tokens: cached } : {}),
    ...(created !== undefined ? { cache_write_tokens: created } : {}),
  }
  return {
    prompt_tokens: (input ?? 0) + (cached ?? 0) + (created ?? 0),
    completion_tokens: output ?? 0,
    ...(Object.keys(details).length > 0 ? { prompt_tokens_details: details } : {}),
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

export function anthropicResponseToOpenAi(body: Json): Json {
  const content = asArray(body.content)
  const text = anthropicContentToText(content)
  const toolCalls = content.flatMap(raw => {
    const block = asObject(raw)
    return block?.type === 'tool_use' ? [{ id: asString(block.id) ?? '', type: 'function', function: { name: asString(block.name) ?? '', arguments: JSON.stringify(asObject(block.input) ?? {}) } }] : []
  })
  const usage = anthropicUsageToOpenAi(asObject(body.usage))
  return { id: asString(body.id) ?? '', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: asString(body.model) ?? '', choices: [{ index: 0, message: { role: 'assistant', content: text || null, ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) }, finish_reason: toolCalls.length > 0 ? 'tool_calls' : anthropicStopToOpenAiFinish(asString(body.stop_reason)) }], ...(usage ? { usage } : {}) }
}

export interface AnthropicToOpenAiState {
  id: string
  model: string
  toolCalls: Map<number, { id: string; name: string }>
  started: boolean
  usage?: Json
}

function mergeAnthropicUsage(current: Json | undefined, incoming: Json | null): Json | undefined {
  if (!incoming) return current
  return { ...(current ?? {}), ...incoming }
}

export function anthropicEventToOpenAiChunks(event: Json, state: AnthropicToOpenAiState): Json[] {
  const chunks: Json[] = []
  const message = asObject(event.message)
  if (event.type === 'message_start') {
    state.started = true
    state.id = asString(message?.id) ?? state.id
    state.model = asString(message?.model) ?? state.model
    state.usage = mergeAnthropicUsage(state.usage, asObject(message?.usage))
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
    state.usage = mergeAnthropicUsage(state.usage, asObject(event.usage))
    const usage = anthropicUsageToOpenAi(state.usage ?? null)
    chunks.push({ id: state.id, object: 'chat.completion.chunk', model: state.model, choices: [{ index: 0, delta: {}, finish_reason: anthropicStopToOpenAiFinish(asString(asObject(event.delta)?.stop_reason)) }], ...(usage ? { usage } : {}) })
  }
  return chunks
}
