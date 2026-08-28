import type { Protocol } from '@common/schemas'
import { createAnthropicMessagesAuthHeaders } from '@server/proxy/protocols/anthropic-messages/upstream'
import { createOpenAiCompletionsAuthHeaders } from '@server/proxy/protocols/openai-completions/upstream'
import { createOpenAiResponsesAuthHeaders } from '@server/proxy/protocols/openai-responses/upstream'

export function createAuthHeaders(protocol: Protocol, apiKey: string | null, customAuthHeader: string | null): Record<string, string> {
  switch (protocol) {
    case 'anthropic-messages':
      return createAnthropicMessagesAuthHeaders(apiKey, customAuthHeader)
    case 'openai-completions':
      return createOpenAiCompletionsAuthHeaders(apiKey, customAuthHeader)
    case 'openai-responses':
      return createOpenAiResponsesAuthHeaders(apiKey, customAuthHeader)
  }
}
