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

export function anthropicToOpenAiRequest(body: Json, model: string): Json {
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
