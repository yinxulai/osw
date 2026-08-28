import type { ProtocolAdapter, ProtocolAdapterRegistry } from './shared/types'
import { registerOpenAiCompletionsAdapters } from './openai-completions/registry'
import { registerOpenAiResponsesAdapters } from './openai-responses/registry'
import { registerAnthropicMessagesAdapters } from './anthropic-messages/registry'

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
