import type { ProtocolAdapter, ProtocolAdapterRegistry } from './shared/types'
import type { Protocol } from '@common/schemas'
import { registerOpenAiCompletionsAdapters, createOpenAiCompletionsAuthHeaders } from './openai-completions'
import { registerOpenAiResponsesAdapters, createOpenAiResponsesAuthHeaders } from './openai-responses'
import { registerAnthropicMessagesAdapters, createAnthropicMessagesAuthHeaders } from './anthropic-messages'

const adapters = new Map<string, ProtocolAdapter>()
registerOpenAiCompletionsAdapters(adapters)
registerAnthropicMessagesAdapters(adapters)
registerOpenAiResponsesAdapters(adapters)

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
