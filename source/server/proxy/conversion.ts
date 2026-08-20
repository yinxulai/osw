import type { Protocol } from '@common/schemas'

/**
 * 协议转换注册表：端点原生协议 -> 可接收的客户端协议列表。
 * 与前端 CONVERTIBLE_PROTOCOLS 保持一致。
 */
export const CONVERTIBLE_PROTOCOLS: Record<Protocol, Protocol[]> = {
  'openai-completions': ['anthropic-messages', 'openai-responses'],
  'openai-responses': [],
  'anthropic-messages': ['openai-completions'],
}

/** 判断端点（原生协议 endpointProtocol）能否接收 clientProtocol 的请求 */
export function isConvertible(endpointProtocol: Protocol, clientProtocol: Protocol): boolean {
  return endpointProtocol !== clientProtocol
    && CONVERTIBLE_PROTOCOLS[endpointProtocol]?.includes(clientProtocol) === true
}

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
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : []
  }
  const parts: Json[] = []
  for (const block of asArray(content)) {
    const record = asObject(block)
    if (!record) continue
    if (record.type === 'text') {
      const text = asString(record.text)
      if (text) parts.push({ type: 'text', text })
    } else if (record.type === 'image' && asObject(record.source)) {
      const source = record.source as Json
      if (source.type === 'base64' && asString(source.media_type) && asString(source.data)) {
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${source.media_type};base64,${source.data}` },
        })
      }
    }
  }
  return parts
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
    if (parts.length === 1 && parts[0].type === 'text') {
      messages.push({ role, content: parts[0].text })
    } else if (parts.length > 0) {
      messages.push({ role, content: parts })
    }
  }

  const result: Json = { model, messages }

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
    for (const part of asArray(item.content)) {
      const record = asObject(part)
      if (!record) continue
      if (record.type === 'input_text' || record.type === 'output_text') {
        const text = asString(record.text)
        if (text) parts.push({ type: 'text', text })
      } else if (record.type === 'input_image' && asObject(record.image_url)) {
        const url = asString((record.image_url as Json).url)
        if (url) parts.push({ type: 'image_url', image_url: { url } })
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
          if (match) {
            content.push({
              type: 'image',
              source: { type: 'base64', media_type: match[1], data: match[2] },
            })
          }
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

  return result
}

// ========== 请求转换入口 ==========

/**
 * 将 clientProtocol 的请求体转换为 endpointProtocol 的请求体。
 * model 字段会被替换为上游模型 ID。
 * 不支持的转换方向抛出 Error。
 */
export function convertRequestBody(clientProtocol: Protocol, endpointProtocol: Protocol, requestBody: Buffer, upstreamModelId: string): Buffer {
  if (clientProtocol === endpointProtocol) {
    // 原生路径：仅重写 model
    const payload = JSON.parse(requestBody.toString('utf8')) as Json
    return Buffer.from(JSON.stringify({ ...payload, model: upstreamModelId }))
  }

  const payload = JSON.parse(requestBody.toString('utf8')) as Json

  let converted: Json
  if (clientProtocol === 'anthropic-messages' && endpointProtocol === 'openai-completions') {
    converted = anthropicToOpenAiRequest(payload, upstreamModelId)
  } else if (clientProtocol === 'openai-responses' && endpointProtocol === 'openai-completions') {
    converted = responsesToOpenAiRequest(payload, upstreamModelId)
  } else if (clientProtocol === 'openai-completions' && endpointProtocol === 'anthropic-messages') {
    converted = openAiToAnthropicRequest(payload, upstreamModelId)
  } else {
    throw new Error(`不支持的协议转换方向: ${clientProtocol} -> ${endpointProtocol}`)
  }

  return Buffer.from(JSON.stringify(converted))
}
