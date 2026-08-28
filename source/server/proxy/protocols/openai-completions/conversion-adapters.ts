import type { Protocol } from '@common/schemas'
import type { RequestContext } from '@server/proxy/request/request-context'
import type { ProtocolConversionAdapter, StreamConverter } from '../shared/types'
import { convertRequestBody } from '../shared/request-conversion'
import { convertResponseBody, createSseConverter } from '../shared/response-conversion'
import { applyAnthropicMessagesRequestDefaults } from '../anthropic-messages/request-defaults'

export class OpenAiCompletionsToAnthropicAdapter implements ProtocolConversionAdapter {
  readonly kind = 'conversion' as const
  readonly clientProtocol: Protocol = 'openai-completions'
  readonly endpointProtocol: Protocol = 'anthropic-messages'
  readonly requiresResponseConversion = true as const

  prepareRequest(context: RequestContext, providerModelName: string): Buffer {
    const converted = convertRequestBody(this.clientProtocol, this.endpointProtocol, context.requestBody, providerModelName)
    return applyAnthropicMessagesRequestDefaults(converted)
  }

  createStreamConverter(): StreamConverter {
    return createSseConverter(this.clientProtocol, this.endpointProtocol)
  }

  finishStream(converter: StreamConverter): string {
    const tail = converter.push('') + converter.flush() + (converter.finish?.() ?? '')
    return `${tail}data: [DONE]\n\n`
  }

  convertResponse(body: Buffer): Buffer {
    return convertResponseBody(this.clientProtocol, this.endpointProtocol, body)
  }
}
