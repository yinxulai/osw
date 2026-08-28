import type { Protocol } from '@common/schemas'

// ========== 类型定义（宽松结构，转换时按需取字段） ==========

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

// ========== Anthropic Messages -> OpenAI Completions ==========

function contentToOpenAiText(content: unknown): string {
  if (typeof content === 'string') return content
  return asArray(content)
    .map(block => {
      const record = asObject(block)
      if (!record) return ''
      if (record.type === 'text') return asString(record.text) ?? ''
      return ''
    })
    .join('')
}

function contentToOpenAiParts(content: unknown): Json[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  const parts: Json[] = []
  for (const block of asArray(content)) {
    const record = asObject(block)
    if (!record) continue
    if (record.type === 'text') {
      const text = asString(record.text)
      if (text) parts.push({ type: 'text', text, ...(record.cache_control ? { cache_control: record.cache_control } : {}) })
    } else if (record.type === 'image' && asObject(record.source)) {
      const source = record.source as Json
      if (source.type === 'base64' && asString(source.media_type) && asString(source.data)) {
        parts.push({ type: 'image_url', image_url: { url: `data:${source.media_type};base64,${source.data}` } })
      } else if (source.type === 'url' && asString(source.url)) {
        parts.push({ type: 'image_url', image_url: { url: source.url } })
      }
    }
  }
  return parts
}

function anthropicToolToOpenAi(tool: Json): Json | null {
  const name = asString(tool.name)
  if (!name) return null
  return { type: 'function', function: { name, description: asString(tool.description) ?? '', parameters: asObject(tool.input_schema) ?? { type: 'object', properties: {} } } }
}

function anthropicToOpenAiRequest(body: Json, model: string): Json {
  const system = asString(body.system) ?? contentToOpenAiText(body.system)
  const messages: Json[] = []
  if (system) messages.push({ role: 'system', content: system })

  for (const raw of asArray(body.messages)) {
    const message = asObject(raw)
    if (!message) continue
    const role = asString(message.role) === 'assistant' ? 'assistant' : 'user'
    const parts = contentToOpenAiParts(message.content)
    const toolCalls = parts.length === 0 ? asArray(message.content).flatMap(block => {
      const record = asObject(block)
      if (record?.type !== 'tool_use' || !asString(record.name)) return []
      return [{ id: asString(record.id) ?? '', type: 'function', function: { name: record.name, arguments: JSON.stringify(asObject(record.input) ?? {}) } }]
    }) : []
    if (toolCalls.length > 0) messages.push({ role: 'assistant', content: null, tool_calls: toolCalls })
    else if (parts.length === 1 && parts[0].type === 'text') messages.push({ role, content: parts[0].text })
    else if (parts.length > 0) messages.push({ role, content: parts })
  }

  for (const raw of asArray(body.messages)) {
    const message = asObject(raw)
    if (!message || message.role !== 'user') continue
    for (const block of asArray(message.content)) {
      const record = asObject(block)
      if (record?.type === 'tool_result') messages.push({ role: 'tool', tool_call_id: asString(record.tool_use_id) ?? '', content: contentToOpenAiText(record.content) })
    }
  }

  const result: Json = { model, messages }
  const tools = asArray(body.tools).map(tool => anthropicToolToOpenAi(asObject(tool) ?? {})).filter((tool): tool is Json => tool !== null)
  if (tools.length > 0) result.tools = tools
  const choice = asObject(body.tool_choice)
  if (choice?.type === 'auto' || choice?.type === 'any') result.tool_choice = choice.type === 'any' ? 'required' : 'auto'
  else if (choice?.type === 'tool' && asString(choice.name)) result.tool_choice = { type: 'function', function: { name: choice.name } }

  const maxTokens = asNumber(body.max_tokens)
  if (maxTokens !== undefined) result.max_tokens = maxTokens
  const temperature = asNumber(body.temperature)
  if (temperature !== undefined) result.temperature = temperature
  const topP = asNumber(body.top_p)
  if (topP !== undefined) result.top_p = topP
  if (body.stream === true) result.stream = true
  if (body.stop_sequences) result.stop = body.stop_sequences

  return result
}

// ========== OpenAI Responses -> OpenAI Completions ==========

function responsesToOpenAiRequest(body: Json, model: string): Json {
  const messages: Json[] = []
  const instructions = asString(body.instructions)
  if (instructions) messages.push({ role: 'system', content: instructions })

  for (const raw of asArray(body.input)) {
    const item = asObject(raw)
    if (!item) {
      if (typeof raw === 'string') messages.push({ role: 'user', content: raw })
      continue
    }
    const role = asString(item.role) === 'assistant' ? 'assistant' : 'user'
    const parts: Json[] = []
    if (typeof item.content === 'string') {
      if (item.content) parts.push({ type: 'text', text: item.content })
    } else {
      for (const part of asArray(item.content)) {
        const record = asObject(part)
        if (!record) continue
        if (record.type === 'input_text' || record.type === 'output_text') {
          const text = asString(record.text)
          if (text) parts.push({ type: 'text', text })
        } else if (record.type === 'input_image' && asObject(record.image_url)) {
          const url = asString((record.image_url as Json).url)
          if (url) parts.push({ type: 'image_url', image_url: { url } })
        } else if (record.type === 'function_call_output') {
          messages.push({ role: 'tool', tool_call_id: asString(record.call_id) ?? '', content: asString(record.output) ?? '' })
        } else if (record.type === 'function_call') {
          messages.push({ role: 'assistant', content: null, tool_calls: [{ id: asString(record.call_id) ?? '', type: 'function', function: { name: asString(record.name) ?? '', arguments: asString(record.arguments) ?? '{}' } }] })
        }
      }
    }
    if (parts.length === 1 && parts[0].type === 'text') {
      messages.push({ role, content: parts[0].text })
    } else if (parts.length > 0) {
      messages.push({ role, content: parts })
    }
  }

  const result: Json = { model, messages }

  const maxTokens = asNumber(body.max_output_tokens)
  if (maxTokens !== undefined) result.max_tokens = maxTokens
  const temperature = asNumber(body.temperature)
  if (temperature !== undefined) result.temperature = temperature
  const topP = asNumber(body.top_p)
  if (topP !== undefined) result.top_p = topP
  if (body.stream === true) result.stream = true

  return result
}

// ========== OpenAI Completions -> Anthropic Messages ==========

function openAiToAnthropicRequest(body: Json, model: string): Json {
  const system: string[] = []
  const messages: Json[] = []

  for (const raw of asArray(body.messages)) {
    const message = asObject(raw)
    if (!message) continue
    const role = asString(message.role) ?? 'user'

    if (role === 'system' || role === 'developer') {
      const text = contentToOpenAiText(message.content)
      if (text) system.push(text)
      continue
    }

    const content: Json[] = []
    for (const rawCall of asArray(message.tool_calls)) {
      const call = asObject(rawCall)
      const fn = asObject(call?.function)
      if (fn && asString(fn.name)) content.push({ type: 'tool_use', id: asString(call?.id) ?? '', name: fn.name, input: (() => { try { return JSON.parse(asString(fn.arguments) ?? '{}') } catch { return {} } })() })
    }
    if (role === 'tool') {
      messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: asString(message.tool_call_id) ?? '', content: asString(message.content) ?? '' }] })
      continue
    }
    if (typeof message.content === 'string') {
      if (message.content) content.push({ type: 'text', text: message.content })
    } else {
      for (const part of asArray(message.content)) {
        const record = asObject(part)
        if (!record) continue
        if (record.type === 'text') {
          const text = asString(record.text)
          if (text) content.push({ type: 'text', text })
        } else if (record.type === 'image_url' && asObject(record.image_url)) {
          const url = asString((record.image_url as Json).url) ?? ''
          const match = /^data:([^;]+);base64,(.+)$/.exec(url)
          if (match) content.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } })
          else if (url) content.push({ type: 'image', source: { type: 'url', url } })
        }
      }
    }

    messages.push({ role: role === 'assistant' ? 'assistant' : 'user', content })
  }

  const result: Json = {
    model,
    messages,
    max_tokens: asNumber(body.max_tokens) ?? 4096,
  }
  if (system.length > 0) result.system = system.join('\n\n')
  const temperature = asNumber(body.temperature)
  if (temperature !== undefined) result.temperature = temperature
  const topP = asNumber(body.top_p)
  if (topP !== undefined) result.top_p = topP
  if (body.stream === true) result.stream = true
  if (body.stop) result.stop_sequences = body.stop
  const tools: Json[] = asArray(body.tools).map(raw => {
    const tool = asObject(raw)
    const fn = asObject(tool?.function)
    return fn && asString(fn.name) ? { name: fn.name, description: asString(fn.description) ?? '', input_schema: asObject(fn.parameters) ?? { type: 'object', properties: {} } } : null
  }).filter(tool => tool !== null)
  if (tools.length > 0) result.tools = tools
  const choice = body.tool_choice
  if (choice === 'auto' || choice === 'none') result.tool_choice = { type: choice === 'none' ? 'none' : 'auto' }
  else if (choice === 'required') result.tool_choice = { type: 'any' }
  else if (asObject(choice)?.type === 'function' && asString(asObject(asObject(choice)?.function)?.name)) result.tool_choice = { type: 'tool', name: asString(asObject(asObject(choice)?.function)?.name) }

  return result
}

// ========== 请求转换入口 ==========

/**
 * 将 clientProtocol 的请求体转换为 endpointProtocol 的请求体。
 * model 字段会被替换为 ProviderModel 的远端模型名称。
 * 不支持的转换方向抛出 Error。
 */
export function convertRequestBody(clientProtocol: Protocol, endpointProtocol: Protocol, requestBody: Buffer, providerModelName: string): Buffer {
  if (clientProtocol === endpointProtocol) {
    // 原生路径：仅重写 model
    const payload = JSON.parse(requestBody.toString('utf8')) as Json
    return Buffer.from(JSON.stringify({ ...payload, model: providerModelName }))
  }

  const payload = JSON.parse(requestBody.toString('utf8')) as Json

  let converted: Json
  if (clientProtocol === 'anthropic-messages' && endpointProtocol === 'openai-completions') {
    converted = anthropicToOpenAiRequest(payload, providerModelName)
  } else if (clientProtocol === 'openai-responses' && endpointProtocol === 'openai-completions') {
    converted = responsesToOpenAiRequest(payload, providerModelName)
  } else if (clientProtocol === 'openai-completions' && endpointProtocol === 'anthropic-messages') {
    converted = openAiToAnthropicRequest(payload, providerModelName)
  } else {
    throw new Error(`不支持的协议转换方向: ${clientProtocol} -> ${endpointProtocol}`)
  }

  return Buffer.from(JSON.stringify(converted))
}
