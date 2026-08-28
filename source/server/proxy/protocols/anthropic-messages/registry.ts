import type { ProtocolAdapter } from '../shared/types'
import { AnthropicMessagesNativeAdapter, AnthropicMessagesToOpenAiCompletionsAdapter } from './adapters'

export function registerAnthropicMessagesAdapters(adapters: Map<string, ProtocolAdapter>): void {
  const native = new AnthropicMessagesNativeAdapter()
  adapters.set(`${native.clientProtocol}:${native.endpointProtocol}`, native)

  const toCompletions = new AnthropicMessagesToOpenAiCompletionsAdapter()
  adapters.set(`${toCompletions.clientProtocol}:${toCompletions.endpointProtocol}`, toCompletions)
}
