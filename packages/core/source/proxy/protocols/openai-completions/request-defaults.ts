import { parseJsonObject } from '../shared/json-envelope'

export function applyOpenAiCompletionsRequestDefaults(requestBody: Buffer): Buffer {
  const payload = parseJsonObject(requestBody)
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
