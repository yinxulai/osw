import { asArray, asNumber, asObject, asString, type Json } from './conversion-utils'

/**
 * Anthropic Messages 响应 → OpenAI Chat Completions 响应。
 *
 * 字段依据见 apps/docs/upstream/anthropic-messages.md 与 apps/docs/upstream/openai-completions.md。
 *
 * 流式注意两点：
 * 1. Anthropic 的 content block index 覆盖全部块类型（文本块也占一个），而 OpenAI 的
 *    `tool_calls[].index` 只在工具调用之间递增，因此必须重新编号。
 * 2. Anthropic 的 usage 分散在 `message_start`（输入侧）与 `message_delta`（输出侧），
 *    需要跨事件合并后再换算，否则 token 数会失真。
 */

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
    total_tokens: (input ?? 0) + (cached ?? 0) + (created ?? 0) + (output ?? 0),
    ...(Object.keys(details).length > 0 ? { prompt_tokens_details: details } : {}),
  }
}

function anthropicStopToOpenAiFinish(stop: string | undefined): string {
  switch (stop) {
    case 'end_turn': return 'stop'
    case 'max_tokens': return 'length'
    // `model_context_window_exceeded` 表示输入+输出把上下文窗口耗尽，
    // 在 Chat Completions 里语义最接近 `length`（唯一与「被上限截断」等价的取值）。
    case 'model_context_window_exceeded': return 'length'
    case 'stop_sequence': return 'stop'
    case 'tool_use': return 'tool_calls'
    case 'refusal': return 'content_filter'
    // `pause_turn`（长任务暂停）在 Chat Completions 无对应取值，退回 `stop`。
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
  created: number
  /** Anthropic content block index → OpenAI tool_calls index */
  toolIndexes: Map<number, number>
  started: boolean
  stopped: boolean
  usage?: Json
}

export function createAnthropicToOpenAiState(): AnthropicToOpenAiState {
  return { id: '', model: '', created: Math.floor(Date.now() / 1000), toolIndexes: new Map(), started: false, stopped: false }
}

function chunk(state: AnthropicToOpenAiState, delta: Json, finishReason: string | null): Json {
  return {
    id: state.id,
    object: 'chat.completion.chunk',
    created: state.created,
    model: state.model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }
}

/**
 * Anthropic usage 分散在 message_start / message_delta，需浅合并后换算。
 *
 * `MessageDeltaUsage` 的 `input_tokens` / `cache_read_input_tokens` /
 * `cache_creation_input_tokens` 规范上允许为 null（只在 message_start 里给准确值），
 * 因此 null 不能覆盖 message_start 已有的计数，否则 prompt_tokens 会凭空变小。
 */
function mergeAnthropicUsage(current: Json | undefined, incoming: Json | null): Json | undefined {
  if (!incoming) return current
  const merged: Json = { ...(current ?? {}) }
  for (const [key, value] of Object.entries(incoming)) {
    if (value === null || value === undefined) continue
    merged[key] = value
  }
  return merged
}

/** 复用/分配某个 Anthropic 工具块的 OpenAI tool_calls index。 */
function toolIndexOf(state: AnthropicToOpenAiState, anthropicIndex: number): number {
  const existing = state.toolIndexes.get(anthropicIndex)
  if (existing !== undefined) return existing
  const assigned = state.toolIndexes.size
  state.toolIndexes.set(anthropicIndex, assigned)
  return assigned
}

function finishChunk(state: AnthropicToOpenAiState, finishReason: string): Json {
  const usage = anthropicUsageToOpenAi(state.usage ?? null)
  state.stopped = true
  return { ...chunk(state, {}, finishReason), ...(usage ? { usage } : {}) }
}

export function anthropicEventToOpenAiChunks(event: Json, state: AnthropicToOpenAiState): Json[] {
  const chunks: Json[] = []
  const message = asObject(event.message)
  if (event.type === 'message_start') {
    state.started = true
    state.id = asString(message?.id) ?? state.id
    state.model = asString(message?.model) ?? state.model
    state.usage = mergeAnthropicUsage(state.usage, asObject(message?.usage))
    chunks.push(chunk(state, { role: 'assistant' }, null))
  } else if (event.type === 'content_block_start') {
    state.started = true
    const block = asObject(event.content_block)
    if (block?.type === 'tool_use' || block?.type === 'server_tool_use') {
      const index = toolIndexOf(state, asNumber(event.index) ?? 0)
      const id = asString(block.id) ?? ''
      const name = asString(block.name) ?? ''
      chunks.push(chunk(state, { tool_calls: [{ index, id, type: 'function', function: { name, arguments: '' } }] }, null))
    }
    // thinking / redacted_thinking / text 块起始无对应 Chat Completions 输出
  } else if (event.type === 'content_block_delta') {
    const delta = asObject(event.delta)
    const text = delta?.type === 'text_delta' ? asString(delta.text) : undefined
    const partialJson = delta?.type === 'input_json_delta' ? asString(delta.partial_json) : undefined
    if (text) chunks.push(chunk(state, { content: text }, null))
    if (partialJson) {
      const index = toolIndexOf(state, asNumber(event.index) ?? 0)
      chunks.push(chunk(state, { tool_calls: [{ index, function: { arguments: partialJson } }] }, null))
    }
  } else if (event.type === 'message_delta') {
    state.usage = mergeAnthropicUsage(state.usage, asObject(event.usage))
    const stopReason = asString(asObject(event.delta)?.stop_reason)
    if (stopReason) {
      chunks.push(finishChunk(state, anthropicStopToOpenAiFinish(stopReason)))
    } else {
      const usage = anthropicUsageToOpenAi(state.usage ?? null)
      chunks.push({ ...chunk(state, {}, null), ...(usage ? { usage } : {}) })
    }
  } else if (event.type === 'message_stop') {
    // 正常情况 message_delta 已带 stop_reason 收尾；这里兜底，避免客户端等不到 finish_reason。
    if (state.started && !state.stopped) chunks.push(finishChunk(state, 'stop'))
  }
  return chunks
}

export function finishAnthropicToOpenAiChunks(state: AnthropicToOpenAiState): Json[] {
  if (!state.started || state.stopped) return []
  return [finishChunk(state, 'stop')]
}
