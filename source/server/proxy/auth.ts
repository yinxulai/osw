import type { Protocol } from '@common/schemas'

export function createAuthHeaders(protocol: Protocol, apiKey: string, customAuthHeader: string | null): Record<string, string> {
  if (customAuthHeader) return { [customAuthHeader]: apiKey }

  switch (protocol) {
    case 'anthropic-messages':
      return {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      }
    case 'openai-completions':
    case 'openai-responses':
      return { authorization: `Bearer ${apiKey}` }
  }
}
