import { asArray, asNumber, asObject, asString, safeJsonParse, type Json } from './conversion-utils'

/**
 * OpenAI Chat Completions 请求 → Anthropic Messages 请求。
 *
 * 字段依据见 apps/docs/upstream/openai-completions.md 与 apps/docs/upstream/anthropic-messages.md。
 *
 * 关键差异：OpenAI 用独立的 `role: tool` 消息承载工具结果，Anthropic 要求
 * `tool_result` block 出现在紧随 assistant `tool_use` 的用户消息中，因此连续的
 * tool 消息必须合并为同一个 user 消息的多个 block，而不是各占一条 user 消息。
 */

const CACHE_CONTROL: Json = { type: 'ephemeral' }
const DEFAULT_MAX_TOKENS = 4096

function anthropicCacheControlFrom(promptCacheBreakpoint: unknown): Json | undefined {
  const marker = asObject(promptCacheBreakpoint)
  if (!marker || (marker.mode !== undefined && marker.mode !== 'explicit')) return undefined
  return CACHE_CONTROL
}

/** OpenAI content → Anthropic content blocks（text / image）。 */
function contentToAnthropicBlocks(content: unknown): Json[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  const blocks: Json[] = []
  for (const raw of asArray(content)) {
    const part = asObject(raw)
    if (!part) continue
    if (part.type === 'text') {
      const text = asString(part.text)
      if (text === undefined) continue
      const cacheControl = anthropicCacheControlFrom(part.prompt_cache_breakpoint)
      blocks.push({ type: 'text', text, ...(cacheControl ? { cache_control: cacheControl } : {}) })
    } else if (part.type === 'image_url') {
      const url = asString(asObject(part.image_url)?.url) ?? ''
      const match = /^data:([^;,]+);base64,(.+)$/.exec(url)
      if (match) blocks.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } })
      else if (url) blocks.push({ type: 'image', source: { type: 'url', url } })
    }
    // refusal / input_audio / file 等单侧能力在 Anthropic 无对应 block，按保守转换丢弃
  }
  return blocks
}

/** OpenAI tool 消息内容 → Anthropic tool_result 的 content。 */
function toolContentToAnthropic(content: unknown): string | Json[] {
  if (typeof content === 'string') return content
  const blocks = contentToAnthropicBlocks(content)
  const textOnly = blocks.every(block => block.type === 'text')
  if (textOnly) return blocks.map(block => asString(block.text) ?? '').join('')
  return blocks
}

function openAiToolCallsToAnthropicBlocks(toolCalls: unknown): Json[] {
  const blocks: Json[] = []
  for (const raw of asArray(toolCalls)) {
    const call = asObject(raw)
    const fn = asObject(call?.function)
    const name = asString(fn?.name)
    if (!call || !fn || !name) continue
    // 只识别 `type: "function"`：自定义工具（`type: "custom"`）在 Anthropic 无对应语义，丢弃
    blocks.push({ type: 'tool_use', id: asString(call.id) ?? '', name, input: safeJsonParse(asString(fn.arguments), {}) })
  }
  return blocks
}

function openAiToolsToAnthropic(tools: unknown): Json[] {
  const result: Json[] = []
  for (const raw of asArray(tools)) {
    const fn = asObject(asObject(raw)?.function)
    const name = asString(fn?.name)
    if (!fn || !name) continue
    result.push({
      name,
      description: asString(fn.description) ?? '',
      input_schema: asObject(fn.parameters) ?? { type: 'object', properties: {} },
    })
  }
  return result
}

function openAiToolChoiceToAnthropic(choice: unknown, disableParallel: boolean): Json | undefined {
  const withParallel = (value: Json): Json => (disableParallel ? { ...value, disable_parallel_tool_use: true } : value)
  if (choice === 'auto') return withParallel({ type: 'auto' })
  if (choice === 'required') return withParallel({ type: 'any' })
  if (choice === 'none') return { type: 'none' }
  const record = asObject(choice)
  const name = asString(asObject(record?.function)?.name)
  if (record?.type === 'function' && name) return withParallel({ type: 'tool', name })
  if (disableParallel) return { type: 'auto', disable_parallel_tool_use: true }
  return undefined
}

export function openAiToAnthropicRequest(body: Json, model: string): Json {
  const system: Json[] = []
  const messages: Json[] = []
  let pendingToolResults: Json[] = []

  const flushToolResults = () => {
    if (pendingToolResults.length === 0) return
    messages.push({ role: 'user', content: pendingToolResults })
    pendingToolResults = []
  }

  for (const raw of asArray(body.messages)) {
    const message = asObject(raw)
    if (!message) continue
    const role = asString(message.role) ?? 'user'

    if (role === 'tool') {
      pendingToolResults.push({
        type: 'tool_result',
        tool_use_id: asString(message.tool_call_id) ?? '',
        content: toolContentToAnthropic(message.content),
      })
      continue
    }

    flushToolResults()

    if (role === 'system' || role === 'developer') {
      system.push(...contentToAnthropicBlocks(message.content))
      continue
    }

    if (role === 'assistant') {
      const content = [...contentToAnthropicBlocks(message.content), ...openAiToolCallsToAnthropicBlocks(message.tool_calls)]
      if (content.length > 0) messages.push({ role: 'assistant', content })
      continue
    }

    const content = contentToAnthropicBlocks(message.content)
    if (content.length > 0) messages.push({ role: 'user', content })
  }
  flushToolResults()

  const result: Json = {
    model,
    messages,
    // Chat Completions 已把 `max_tokens` 标为弃用并推荐 `max_completion_tokens`（后者才含推理 token，
    // o 系模型也只认它），所以优先读新字段。Anthropic 侧 `max_tokens` 必填，两者都缺时用 4096 兑底。
    max_tokens: asNumber(body.max_completion_tokens) ?? asNumber(body.max_tokens) ?? DEFAULT_MAX_TOKENS,
  }

  if (system.length > 0) {
    const hasCacheControl = system.some(block => block.cache_control !== undefined)
    result.system = hasCacheControl ? system : system.map(block => asString(block.text) ?? '').join('\n\n')
  }

  if (asObject(body.prompt_cache_options)?.mode === 'implicit') result.cache_control = CACHE_CONTROL

  const temperature = asNumber(body.temperature)
  if (temperature !== undefined) result.temperature = temperature
  const topP = asNumber(body.top_p)
  if (topP !== undefined) result.top_p = topP
  if (body.stream === true) result.stream = true
  if (body.stop !== undefined) {
    result.stop_sequences = typeof body.stop === 'string' ? [body.stop] : asArray(body.stop)
  }

  const tools = openAiToolsToAnthropic(body.tools)
  if (tools.length > 0) result.tools = tools

  const toolChoice = openAiToolChoiceToAnthropic(body.tool_choice, body.parallel_tool_calls === false)
  if (toolChoice !== undefined) result.tool_choice = toolChoice

  const userId = asString(body.user)
  if (userId) result.metadata = { user_id: userId }

  return result
}
