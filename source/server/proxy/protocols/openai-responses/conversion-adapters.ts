import type { Protocol } from '@common/schemas'
import type { RequestContext } from '@server/proxy/request/request-context'
import type { ProtocolConversionAdapter, StreamConverter } from '../shared/types'
import { convertRequestBody } from '../shared/request-conversion'
import { convertResponseBody, createSseConverter } from '../shared/response-conversion'
import { applyOpenAiCompletionsRequestDefaults } from '../openai-completions/request-defaults'

export class OpenAiResponsesToOpenAiCompletionsAdapter implements ProtocolConversionAdapter {
  readonly kind = 'conversion' as const
  readonly clientProtocol: Protocol = 'openai-responses'
  readonly endpointProtocol: Protocol = 'openai-completions'
  readonly requiresResponseConversion = true as const

  prepareRequest(context: RequestContext, providerModelName: string): Buffer {
    const converted = convertRequestBody(this.clientProtocol, this.endpointProtocol, context.requestBody, providerModelName)
    return applyOpenAiCompletionsRequestDefaults(converted)
  }

  createStreamConverter(): StreamConverter {
    return createSseConverter(this.clientProtocol, this.endpointProtocol)
  }

  finishStream(converter: StreamConverter): string {
    return converter.push('') + converter.flush() + (converter.finish?.() ?? '')
  }

  convertResponse(body: Buffer): Buffer {
    return convertResponseBody(this.clientProtocol, this.endpointProtocol, body)
  }
}
