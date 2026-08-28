import type { ProtocolAdapter } from '../shared/types'
import { registerAdapter } from '../shared/adapter-factory'

export function registerOpenAiCompletionsAdapters(adapters: Map<string, ProtocolAdapter>): void {
  registerAdapter(adapters, 'openai-completions', 'openai-completions')
  registerAdapter(adapters, 'openai-completions', 'anthropic-messages')
}
