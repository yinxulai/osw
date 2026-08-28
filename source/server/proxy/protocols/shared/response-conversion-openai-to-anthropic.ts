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

export function openAiResponseToAnthropic(body: Json): Json {
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

export interface OpenAiToAnthropicState {
  started: boolean
  textBlock: boolean
  toolBlocks: Set<number>
  stopped: boolean
  stopReason?: string
  usage?: Json
  id: string
  model: string
}

export function openAiChunkToAnthropicEvents(chunk: Json, state: OpenAiToAnthropicState): Json[] {
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

export function finishOpenAiToAnthropic(state: OpenAiToAnthropicState): Json[] {
  if (!state.started || state.stopped) return []
  state.stopped = true
  const events: Json[] = []
  if (state.textBlock) events.push({ type: 'content_block_stop', index: 0 })
  for (const index of state.toolBlocks) events.push({ type: 'content_block_stop', index })
  events.push({ type: 'message_delta', delta: { stop_reason: state.stopReason ?? 'end_turn', stop_sequence: null }, ...(state.usage ? { usage: state.usage } : {}) })
  events.push({ type: 'message_stop' })
  return events
}
