import type { ProtocolAdapter } from '../shared/types'
import { registerAdapter } from '../shared/adapter-factory'

export function registerOpenAiResponsesAdapters(adapters: Map<string, ProtocolAdapter>): void {
  registerAdapter(adapters, 'openai-responses', 'openai-responses')
  registerAdapter(adapters, 'openai-responses', 'openai-completions')
}
