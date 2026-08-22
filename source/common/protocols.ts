import type { Protocol } from './schemas'

/** 端点原生协议可接收的客户端协议。 */
export const CONVERTIBLE_PROTOCOLS: Readonly<Record<Protocol, readonly Protocol[]>> = {
  'openai-completions': ['anthropic-messages', 'openai-responses'],
  'openai-responses': [],
  'anthropic-messages': ['openai-completions'],
}

export function isConvertible(endpointProtocol: Protocol, clientProtocol: Protocol): boolean {
  return endpointProtocol !== clientProtocol
    && CONVERTIBLE_PROTOCOLS[endpointProtocol].includes(clientProtocol)
}
