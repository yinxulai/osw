export function createAnthropicMessagesAuthHeaders(apiKey: string | null, customAuthHeader: string | null): Record<string, string> {
  if (!apiKey) return { 'anthropic-version': '2023-06-01' }
  if (customAuthHeader) return { [customAuthHeader]: apiKey }
  return {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }
}
