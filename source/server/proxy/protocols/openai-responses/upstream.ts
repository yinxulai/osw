export function createOpenAiResponsesAuthHeaders(apiKey: string | null, customAuthHeader: string | null): Record<string, string> {
  if (!apiKey) return {}
  if (customAuthHeader) return { [customAuthHeader]: apiKey }
  return { authorization: `Bearer ${apiKey}` }
}
