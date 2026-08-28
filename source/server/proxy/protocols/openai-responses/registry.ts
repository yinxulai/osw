import type { ProtocolAdapter } from '../shared/types'
import { OpenAiResponsesNativeAdapter, OpenAiResponsesToOpenAiCompletionsAdapter } from './adapters'

export function registerOpenAiResponsesAdapters(adapters: Map<string, ProtocolAdapter>): void {
  const native = new OpenAiResponsesNativeAdapter()
  adapters.set(`${native.clientProtocol}:${native.endpointProtocol}`, native)

  const toCompletions = new OpenAiResponsesToOpenAiCompletionsAdapter()
  adapters.set(`${toCompletions.clientProtocol}:${toCompletions.endpointProtocol}`, toCompletions)
}
