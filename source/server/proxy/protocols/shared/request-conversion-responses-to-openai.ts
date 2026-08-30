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

export function responsesToOpenAiRequest(body: Json, model: string): Json {
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
          if (text) parts.push({ type: 'text', text, ...(record.prompt_cache_breakpoint ? { prompt_cache_breakpoint: record.prompt_cache_breakpoint } : {}) })
        } else if (record.type === 'input_image') {
          const imageUrl = asString(record.image_url) ?? asString(asObject(record.image_url)?.url)
          if (imageUrl) parts.push({ type: 'image_url', image_url: { url: imageUrl }, ...(record.prompt_cache_breakpoint ? { prompt_cache_breakpoint: record.prompt_cache_breakpoint } : {}) })
        } else if (record.type === 'function_call_output') {
          messages.push({ role: 'tool', tool_call_id: asString(record.call_id) ?? '', content: asString(record.output) ?? '' })
        } else if (record.type === 'function_call') {
          messages.push({ role: 'assistant', content: null, tool_calls: [{ id: asString(record.call_id) ?? '', type: 'function', function: { name: asString(record.name) ?? '', arguments: asString(record.arguments) ?? '{}' } }] })
        }
      }
    }
    if (parts.length === 1 && parts[0].type === 'text' && !parts[0].prompt_cache_breakpoint) {
      messages.push({ role, content: parts[0].text })
    } else if (parts.length > 0) {
      messages.push({ role, content: parts })
    }
  }

  const result: Json = { model, messages }
  for (const field of ['prompt_cache_key', 'prompt_cache_retention', 'prompt_cache_options'] as const) {
    if (body[field] !== undefined) result[field] = body[field]
  }

  const maxTokens = asNumber(body.max_output_tokens)
  if (maxTokens !== undefined) result.max_tokens = maxTokens
  const temperature = asNumber(body.temperature)
  if (temperature !== undefined) result.temperature = temperature
  const topP = asNumber(body.top_p)
  if (topP !== undefined) result.top_p = topP
  if (body.stream === true) result.stream = true

  return result
}
