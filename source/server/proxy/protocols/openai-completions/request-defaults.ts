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

export function applyOpenAiCompletionsRequestDefaults(requestBody: Buffer): Buffer {
  const payload = parseObjectBody(requestBody)
  if (!payload) return requestBody

  if (payload.stream !== true) return requestBody

  const existingOptions = payload.stream_options
  if (
    existingOptions !== null
    && typeof existingOptions === 'object'
    && (existingOptions as Record<string, unknown>).include_usage === true
  ) {
    return requestBody
  }

  payload.stream_options = {
    ...((existingOptions && typeof existingOptions === 'object') ? (existingOptions as Record<string, unknown>) : {}),
    include_usage: true,
  }
  return Buffer.from(JSON.stringify(payload))
}
