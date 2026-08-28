import type { ProtocolAdapter } from '../shared/types'
import { OpenAiCompletionsNativeAdapter, OpenAiCompletionsToAnthropicAdapter } from './adapters'

export function registerOpenAiCompletionsAdapters(adapters: Map<string, ProtocolAdapter>): void {
  const native = new OpenAiCompletionsNativeAdapter()
  adapters.set(`${native.clientProtocol}:${native.endpointProtocol}`, native)

  const toAnthropic = new OpenAiCompletionsToAnthropicAdapter()
  adapters.set(`${toAnthropic.clientProtocol}:${toAnthropic.endpointProtocol}`, toAnthropic)
}
