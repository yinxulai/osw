function parseObjectBody(requestBody: Buffer): Record<string, unknown> | null {
  if (requestBody.length === 0) return null

  try {
    const payload = JSON.parse(requestBody.toString('utf8')) as Record<string, unknown>
    if (payload === null || Array.isArray(payload) || typeof payload !== 'object') return null
    return payload
  } catch {
    return null
  }
}

export function applyAnthropicMessagesRequestDefaults(requestBody: Buffer): Buffer {
  const payload = parseObjectBody(requestBody)
  if (!payload) return requestBody

  if (payload.max_tokens !== undefined && payload.max_tokens !== null) return requestBody

  payload.max_tokens = 4096
  return Buffer.from(JSON.stringify(payload))
}
