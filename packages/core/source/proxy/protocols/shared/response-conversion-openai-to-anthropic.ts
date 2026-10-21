import { firstNumber } from './usage'
import { asArray, asNumber, asObject, asString, safeJsonParse, type Json } from './conversion-utils'

/**
 * OpenAI Chat Completions 响应 → Anthropic Messages 响应。
 *
 * 流式转换难点：OpenAI 用 `tool_calls[].index` 标识工具调用，而 Anthropic 要求
 * content block 的 `index` 在全流内唯一且递增，文本块也不例外。因此流式状态机
 * 必须自行分配 Anthropic index，不能直接复用 OpenAI 的 tool index。
 */

function openAiUsageToAnthropic(usage: Json | null): Json | undefined {
  if (!usage) return undefined
  // Chat 字段的占位 0 不能盖住 Responses 字段里的真实值。选择规则就是用量观察器的
  // `firstNumber`：有正数用正数，候选全是 0 才回落到 0。这里不读 Anthropic 的
  // `cache_read_input_tokens`：正的 `prompt_tokens` 已经是含缓存的总输入。
  const input = firstNumber(usage.prompt_tokens, usage.input_tokens) ?? undefined
  const output = firstNumber(usage.completion_tokens, usage.output_tokens) ?? undefined
  if (input === undefined && output === undefined) return undefined
  const promptDetails = asObject(usage.prompt_tokens_details)
  const inputDetails = asObject(usage.input_tokens_details)
  const cached = firstNumber(promptDetails?.cached_tokens, inputDetails?.cached_tokens) ?? undefined
  const created = firstNumber(promptDetails?.cache_write_tokens, inputDetails?.cache_write_tokens) ?? undefined
  const uncached = Math.max(0, (input ?? 0) - (cached ?? 0) - (created ?? 0))
  return {
    input_tokens: uncached,
    output_tokens: output ?? 0,
    ...(cached !== undefined ? { cache_read_input_tokens: cached } : {}),
    ...(created !== undefined ? { cache_creation_input_tokens: created } : {}),
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

/** OpenAI message.content 可能是字符串，也可能是 content parts 数组。 */
function openAiContentToText(content: unknown): string {
  if (typeof content === 'string') return content
  return asArray(content)
    .map(part => asString(asObject(part)?.text) ?? '')
    .join('')
}

export function openAiResponseToAnthropic(body: Json): Json {
  const first = asObject(asArray(body.choices)[0])
  const message = asObject(first?.message)
  const content: Json[] = []
  const text = openAiContentToText(message?.content)
  if (text) content.push({ type: 'text', text })
  for (const rawCall of asArray(message?.tool_calls)) {
    const call = asObject(rawCall)
    const fn = asObject(call?.function)
    const name = asString(fn?.name)
    if (!call || !fn || !name) continue
    content.push({ type: 'tool_use', id: asString(call.id) ?? '', name, input: safeJsonParse(asString(fn.arguments), {}) })
  }
  const usage = openAiUsageToAnthropic(asObject(body.usage))
  return {
    id: asString(body.id) ?? '',
    type: 'message',
    role: 'assistant',
    model: asString(body.model) ?? '',
    content,
    stop_reason: content.some(block => block.type === 'tool_use') ? 'tool_use' : openAiFinishToAnthropicStop(asString(first?.finish_reason)),
    stop_sequence: null,
    ...(usage ? { usage } : {}),
  }
}

/** 名字还没到齐、因此还不能发出 `content_block_start` 的工具调用。 */
interface PendingToolUse {
  id: string
  name: string
}

export interface OpenAiToAnthropicState {
  started: boolean
  stopped: boolean
  id: string
  model: string
  usage?: Json
  finishReason?: string
  /** 下一个可分配的 Anthropic content block index。 */
  nextIndex: number
  /** 文本块占用的 index，未出现文本时为 null。 */
  textBlockIndex: number | null
  /** OpenAI tool_calls[].index → Anthropic content block index。 */
  toolBlockIndexes: Map<number, number>
  /** 已打开但未关闭的 block index，按打开顺序排列。 */
  openBlockIndexes: number[]
  /**
   * 名字还在增长的工具调用。`content_block_start` 发出去就不能改 name，
   * 所以要等名字收齐再开块。
   */
  pendingToolUses: Map<number, PendingToolUse>
}

export function createOpenAiToAnthropicState(): OpenAiToAnthropicState {
  return {
    started: false,
    stopped: false,
    id: '',
    model: '',
    nextIndex: 0,
    textBlockIndex: null,
    toolBlockIndexes: new Map(),
    openBlockIndexes: [],
    pendingToolUses: new Map(),
  }
}

function ensureStarted(state: OpenAiToAnthropicState, events: Json[]): void {
  if (state.started) return
  state.started = true
  events.push({
    type: 'message_start',
    message: {
      id: state.id,
      type: 'message',
      role: 'assistant',
      model: state.model,
      content: [],
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  })
}

/**
 * 名字收齐后才发 `content_block_start`。已经开过的块返回原 index，不再发一次。
 * 块一旦发出，name 就锁死了。
 */
function openPendingToolUse(state: OpenAiToAnthropicState, events: Json[], openAiIndex: number): number | undefined {
  const pending = state.pendingToolUses.get(openAiIndex)
  if (!pending) return state.toolBlockIndexes.get(openAiIndex)
  state.pendingToolUses.delete(openAiIndex)
  ensureStarted(state, events)
  const blockIndex = state.nextIndex++
  state.toolBlockIndexes.set(openAiIndex, blockIndex)
  state.openBlockIndexes.push(blockIndex)
  events.push({
    type: 'content_block_start',
    index: blockIndex,
    content_block: { type: 'tool_use', id: pending.id, name: pending.name, input: {} },
  })
  return blockIndex
}

function openPendingToolUses(state: OpenAiToAnthropicState, events: Json[]): void {
  for (const openAiIndex of [...state.pendingToolUses.keys()]) openPendingToolUse(state, events, openAiIndex)
}

function emitStop(state: OpenAiToAnthropicState, events: Json[]): void {
  if (state.stopped) return
  ensureStarted(state, events)
  state.stopped = true
  openPendingToolUses(state, events)
  for (const index of state.openBlockIndexes) events.push({ type: 'content_block_stop', index })
  state.openBlockIndexes = []
  events.push({
    type: 'message_delta',
    delta: { stop_reason: state.finishReason ?? 'end_turn', stop_sequence: null },
    ...(state.usage ? { usage: state.usage } : {}),
  })
  events.push({ type: 'message_stop' })
}

export function openAiChunkToAnthropicEvents(chunk: Json, state: OpenAiToAnthropicState): Json[] {
  const events: Json[] = []
  const first = asObject(asArray(chunk.choices)[0])
  const delta = asObject(first?.delta)
  state.id = asString(chunk.id) ?? state.id
  state.model = asString(chunk.model) ?? state.model

  const text = openAiContentToText(delta?.content)
  if (text && state.pendingToolUses.size > 0) {
    // 文本出现说明已经挂起的工具名不会再增长，与「下一个工具出现」同一条收齐规则。
    // 先按出现顺序开块，否则这段文本会占掉更小的 index，工具调用被排到文本后面。
    // 同一帧里如果还带着这些工具的名字片段，先拼上再开，避免把前缀锁死。
    // 本帧才出现的新工具不在这里开，仍走下面的循环，这样文本和工具在同一帧时文本仍在前面。
    for (const rawCall of asArray(delta?.tool_calls)) {
      const call = asObject(rawCall)
      if (!call || call.type === 'custom') continue
      const openAiIndex = asNumber(call.index) ?? 0
      const pending = state.pendingToolUses.get(openAiIndex)
      if (!pending) continue
      const fn = asObject(call.function)
      const id = asString(call.id)
      const nameFragment = asString(fn?.name)
      if (id && !pending.id) pending.id = id
      if (nameFragment) pending.name += nameFragment
    }
    openPendingToolUses(state, events)
  }
  if (text) {
    ensureStarted(state, events)
    if (state.textBlockIndex === null) {
      state.textBlockIndex = state.nextIndex++
      state.openBlockIndexes.push(state.textBlockIndex)
      events.push({ type: 'content_block_start', index: state.textBlockIndex, content_block: { type: 'text', text: '' } })
    }
    events.push({ type: 'content_block_delta', index: state.textBlockIndex, delta: { type: 'text_delta', text } })
  }

  for (const rawCall of asArray(delta?.tool_calls)) {
    const call = asObject(rawCall)
    if (!call) continue
    // 自定义工具（`type: "custom"`）在 Anthropic 无对应语义，与上面非流式分支一致整条丢弃；
    // 否则会开出一个没有名字、也永远填不上参数的 tool_use 块。
    if (call.type === 'custom') continue
    const openAiIndex = asNumber(call.index) ?? 0
    const fn = asObject(call.function)
    const nameFragment = asString(fn?.name)
    // 空字符串也算参数开始：官方流式会在带完整名字的首个 delta 里放 `arguments: ""`。
    // 名字一旦跟着参数出现，就可以开块，且不能为此多发出一条空的 input_json_delta。
    const argumentsText = asString(fn?.arguments)
    let blockIndex = state.toolBlockIndexes.get(openAiIndex)
    if (blockIndex === undefined) {
      let pending = state.pendingToolUses.get(openAiIndex)
      if (!pending) {
        // 下一个工具出现，说明前面那个名字已经不会再增长。
        openPendingToolUses(state, events)
        pending = { id: '', name: '' }
        state.pendingToolUses.set(openAiIndex, pending)
      }
      const id = asString(call.id)
      if (id && !pending.id) pending.id = id
      if (nameFragment) pending.name += nameFragment
      if (argumentsText !== undefined) blockIndex = openPendingToolUse(state, events, openAiIndex)
    }
    if (blockIndex !== undefined && argumentsText) {
      events.push({ type: 'content_block_delta', index: blockIndex, delta: { type: 'input_json_delta', partial_json: argumentsText } })
    }
  }

  const finish = asString(first?.finish_reason)
  if (finish) state.finishReason = openAiFinishToAnthropicStop(finish)
  const usage = openAiUsageToAnthropic(asObject(chunk.usage))
  if (usage) state.usage = { ...state.usage, ...usage }

  // 收尾条件：拿到 finish_reason 与 usage 后立即闭合；仅拿到 finish_reason 时留待
  // usage 所在的后继 chunk（stream_options.include_usage）或流结束时的 flush 处理。
  if (state.finishReason && state.usage) emitStop(state, events)
  return events
}

export function finishOpenAiToAnthropic(state: OpenAiToAnthropicState): Json[] {
  if (state.stopped) return []
  if (!state.started && state.pendingToolUses.size === 0) return []
  const events: Json[] = []
  emitStop(state, events)
  return events
}
