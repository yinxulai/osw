import type { ProtocolAdapter, ProtocolAdapterRegistry } from './shared/types'
import type { Protocol } from '@common/schemas'
import { registerOpenAiCompletionsAdapters } from './openai-completions/registry'
import { registerOpenAiResponsesAdapters } from './openai-responses/registry'
import { registerAnthropicMessagesAdapters } from './anthropic-messages/registry'
import { createOpenAiCompletionsAuthHeaders } from './openai-completions/upstream'
import { createOpenAiResponsesAuthHeaders } from './openai-responses/upstream'
import { createAnthropicMessagesAuthHeaders } from './anthropic-messages/upstream'

const adapters = new Map<string, ProtocolAdapter>()
registerOpenAiCompletionsAdapters(adapters)
registerOpenAiResponsesAdapters(adapters)
registerAnthropicMessagesAdapters(adapters)

export const protocolAdapters: ProtocolAdapterRegistry = {
  resolve(clientProtocol, endpointProtocol): ProtocolAdapter {
    const adapter = adapters.get(`${clientProtocol}:${endpointProtocol}`)
    if (!adapter) throw new Error(`不支持的协议转换方向: ${clientProtocol} -> ${endpointProtocol}`)
    return adapter
  },
}

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
