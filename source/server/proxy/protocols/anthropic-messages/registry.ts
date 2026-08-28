import type { ProtocolAdapter } from '../shared/types'
import { registerAdapter } from '../shared/adapter-factory'

export function registerAnthropicMessagesAdapters(adapters: Map<string, ProtocolAdapter>): void {
  registerAdapter(adapters, 'anthropic-messages', 'anthropic-messages')
  registerAdapter(adapters, 'anthropic-messages', 'openai-completions')
}
