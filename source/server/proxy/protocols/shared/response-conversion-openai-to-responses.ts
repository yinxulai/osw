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

function openAiUsageToResponses(usage: Json | null): Json | undefined {
  if (!usage) return undefined
  const promptDetails = asObject(usage.prompt_tokens_details)
  return {
    ...(usage.prompt_tokens !== undefined ? { input_tokens: usage.prompt_tokens } : {}),
    ...(usage.completion_tokens !== undefined ? { output_tokens: usage.completion_tokens } : {}),
    ...(promptDetails ? { input_tokens_details: promptDetails } : {}),
  }
}

export function openAiResponseToResponses(body: Json): Json {
  const choices = asArray(body.choices)
  const first = asObject(choices[0])
  const message = asObject(first?.message)
  const text = asString(message?.content) ?? ''
  const usage = openAiUsageToResponses(asObject(body.usage))

  return {
    id: asString(body.id) ?? '',
    object: 'response',
    status: 'completed',
    model: asString(body.model) ?? '',
    output: text
      ? [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }]
      : [],
    ...(usage ? { usage } : {}),
  }
}

export function openAiChunkToResponsesEvents(chunk: Json): Json[] {
  const events: Json[] = []
  const choices = asArray(chunk.choices)
  const delta = asObject(asObject(choices[0])?.delta)
  const text = asString(delta?.content)

  if (text) {
    events.push({
      type: 'response.output_text.delta',
      delta: text,
    })
  }

  const usage = openAiUsageToResponses(asObject(chunk.usage))
  if (usage) {
    events.push({ type: 'response.completed', response: { usage } })
  }

  return events
}
