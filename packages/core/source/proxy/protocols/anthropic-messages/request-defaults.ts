import { parseJsonObject } from '../shared/json-envelope'

export function applyAnthropicMessagesRequestDefaults(requestBody: Buffer): Buffer {
  const payload = parseJsonObject(requestBody)
  if (!payload) return requestBody

  if (payload.max_tokens !== undefined && payload.max_tokens !== null) return requestBody

  payload.max_tokens = 4096
  return Buffer.from(JSON.stringify(payload))
}
