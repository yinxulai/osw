import type { Protocol } from '@common/schemas'

export function createAuthHeaders(
  protocol: Protocol,
  apiKey: string,
  customAuthHeader: string | null,
): Record<string, string> {
  if (customAuthHeader) return { [customAuthHeader]: apiKey }

  switch (protocol) {
    case 'anthropic':
      return {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      }
    case 'gemini':
      return { 'x-goog-api-key': apiKey }
    case 'openai':
      return { authorization: `Bearer ${apiKey}` }
  }
}
