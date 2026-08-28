import type { Protocol } from '@common/schemas'
import { anthropicToOpenAiRequest } from './request-conversion-anthropic-to-openai'
import { responsesToOpenAiRequest } from './request-conversion-responses-to-openai'
import { openAiToAnthropicRequest } from './request-conversion-openai-to-anthropic'
type Json = Record<string, unknown>

// ========== 请求转换入口（仅跨协议） ==========

/**
 * 将 clientProtocol 的请求体转换为 endpointProtocol 的请求体。
 * model 字段会被替换为 ProviderModel 的远端模型名称。
 * 不支持的转换方向抛出 Error。
 */
export function convertRequestBody(clientProtocol: Protocol, endpointProtocol: Protocol, requestBody: Buffer, providerModelName: string): Buffer {
  if (clientProtocol === endpointProtocol) {
    throw new Error(`同协议请求不应进入转换路径: ${clientProtocol}`)
  }

  const payload = JSON.parse(requestBody.toString('utf8')) as Json

  let converted: Json
  if (clientProtocol === 'anthropic-messages' && endpointProtocol === 'openai-completions') {
    converted = anthropicToOpenAiRequest(payload, providerModelName)
  } else if (clientProtocol === 'openai-responses' && endpointProtocol === 'openai-completions') {
    converted = responsesToOpenAiRequest(payload, providerModelName)
  } else if (clientProtocol === 'openai-completions' && endpointProtocol === 'anthropic-messages') {
    converted = openAiToAnthropicRequest(payload, providerModelName)
  } else {
    throw new Error(`不支持的协议转换方向: ${clientProtocol} -> ${endpointProtocol}`)
  }

  return Buffer.from(JSON.stringify(converted))
}
