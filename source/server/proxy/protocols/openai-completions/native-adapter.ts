import type { Protocol } from '@common/schemas'
import { rewriteRequestModel } from '@server/proxy/request/request'
import type { RequestContext } from '@server/proxy/request/request-context'
import type { NativeProtocolAdapter, StreamConverter } from '../shared/types'
import { applyOpenAiCompletionsRequestDefaults } from './request-defaults'

export class OpenAiCompletionsNativeAdapter implements NativeProtocolAdapter {
  readonly kind = 'native' as const
  readonly clientProtocol: Protocol = 'openai-completions'
  readonly endpointProtocol: Protocol = 'openai-completions'
  readonly requiresResponseConversion = false as const

  prepareRequest(context: RequestContext, providerModelName: string): Buffer {
    return applyOpenAiCompletionsRequestDefaults(
      rewriteRequestModel(context.requestBody, providerModelName),
    )
  }

  createStreamConverter(): null {
    return null
  }

  finishStream(_converter: StreamConverter): string {
    return ''
  }

  convertResponse(body: Buffer): Buffer {
    return body
  }
}
