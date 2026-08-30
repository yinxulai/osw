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

function toAnthropicCacheControl(value: unknown): Json | undefined {
  const marker = asObject(value)
  if (!marker || (marker.mode !== undefined && marker.mode !== 'explicit')) return undefined
  return { type: 'ephemeral' }
}

export function openAiToAnthropicRequest(body: Json, model: string): Json {
  const system: Json[] = []
  const messages: Json[] = []

  for (const raw of asArray(body.messages)) {
    const message = asObject(raw)
    if (!message) continue
    const role = asString(message.role) ?? 'user'

    if (role === 'system' || role === 'developer') {
      if (typeof message.content === 'string') {
        if (message.content) system.push({ type: 'text', text: message.content })
      } else {
        for (const rawPart of asArray(message.content)) {
          const part = asObject(rawPart)
          const text = asString(part?.text)
          if (!text) continue
          const cacheControl = toAnthropicCacheControl(part?.prompt_cache_breakpoint)
          system.push({ type: 'text', text, ...(cacheControl ? { cache_control: cacheControl } : {}) })
        }
      }
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
          const cacheControl = toAnthropicCacheControl(record.prompt_cache_breakpoint)
          if (text) content.push({ type: 'text', text, ...(cacheControl ? { cache_control: cacheControl } : {}) })
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
  if (system.length > 0) {
    const hasCacheControl = system.some(block => block.cache_control !== undefined)
    result.system = hasCacheControl ? system : system.map(block => asString(block.text) ?? '').join('\n\n')
  }
  if (asObject(body.prompt_cache_options)?.mode === 'implicit') result.cache_control = { type: 'ephemeral' }
  const temperature = asNumber(body.temperature)
  if (temperature !== undefined) result.temperature = temperature
  const topP = asNumber(body.top_p)
  if (topP !== undefined) result.top_p = topP
  if (body.stream === true) result.stream = true
  if (body.stop) result.stop_sequences = body.stop
  const tools: Json[] = asArray(body.tools).map(raw => {
    const tool = asObject(raw)
    const fn = asObject(tool?.function)
    if (!fn || !asString(fn.name)) return null
    return { name: fn.name, description: asString(fn.description) ?? '', input_schema: asObject(fn.parameters) ?? { type: 'object', properties: {} } }
  }).filter(tool => tool !== null)
  if (tools.length > 0) result.tools = tools
  const choice = body.tool_choice
  if (choice === 'auto' || choice === 'none') result.tool_choice = { type: choice === 'none' ? 'none' : 'auto' }
  else if (choice === 'required') result.tool_choice = { type: 'any' }
  else if (asObject(choice)?.type === 'function' && asString(asObject(asObject(choice)?.function)?.name)) result.tool_choice = { type: 'tool', name: asString(asObject(asObject(choice)?.function)?.name) }

  return result
}
