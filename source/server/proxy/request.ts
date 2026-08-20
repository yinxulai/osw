export function resolveUpstreamUrl(upstreamUrl: string): string {
  const parsed = new URL(upstreamUrl)

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported upstream URL protocol: ${parsed.protocol}`)
  }

  return parsed.toString()
}

/**
 * 解析实际使用的上游地址：优先使用上游模型自身配置的地址，
 * 否则回退到该供应商在对应协议下的默认地址。
 */
export function resolveEffectiveUpstreamUrl(upstreamUrl: string, providerUpstreamUrls: string | null | undefined, protocol: string): string {
  if (upstreamUrl.trim()) return upstreamUrl.trim()

  let endpoints: Record<string, string> = {}
  if (providerUpstreamUrls) {
    try {
      endpoints = JSON.parse(providerUpstreamUrls) as Record<string, string>
    } catch {
      endpoints = {}
    }
  }
  const fallback = endpoints[protocol]
  if (!fallback || !fallback.trim()) {
    throw new Error(
      `未配置上游地址：模型未指定地址，且供应商在协议 ${protocol} 下也没有默认接口地址`,
    )
  }
  return fallback.trim()
}

export function rewriteRequestModel(requestBody: Buffer, upstreamModelId: string): Buffer {
  if (requestBody.length === 0) return requestBody

  try {
    const payload: unknown = JSON.parse(requestBody.toString('utf8'))
    if (payload === null || Array.isArray(payload) || typeof payload !== 'object') {
      throw new Error('Request body must be a JSON object')
    }

    return Buffer.from(JSON.stringify({ ...payload, model: upstreamModelId }))
  } catch (error) {
    if (error instanceof Error && error.message === 'Request body must be a JSON object') {
      throw error
    }
    throw new Error('Request body must be a JSON object', { cause: error })
  }
}

/**
 * 根据协议类型注入确保返回 token 用量统计的参数。
 * - OpenAI 流式：stream_options.include_usage = true
 * - Anthropic：默认就返回 usage，无需额外参数
 * - OpenAI Responses：默认返回 usage
 * 非流式请求默认就会返回 usage，无需修改。
 */
export function injectUsageParams(requestBody: Buffer, protocol: string): Buffer {
  if (requestBody.length === 0) return requestBody

  try {
    const payload = JSON.parse(requestBody.toString('utf8')) as Record<string, unknown>
    if (payload === null || Array.isArray(payload) || typeof payload !== 'object') {
      return requestBody
    }

    // OpenAI 系列协议：流式时注入 stream_options.include_usage
    if (protocol === 'openai-completions' || protocol === 'openai-responses') {
      if (payload.stream === true) {
        const existingOptions = payload.stream_options
        if (
          existingOptions === null ||
          typeof existingOptions !== 'object' ||
          (existingOptions as Record<string, unknown>).include_usage !== true
        ) {
          payload.stream_options = {
            ...((existingOptions && typeof existingOptions === 'object') ? (existingOptions as Record<string, unknown>) : {}),
            include_usage: true,
          }
          return Buffer.from(JSON.stringify(payload))
        }
      }
    }

    // Anthropic 协议：默认就返回 usage，无需额外参数
    // 但可以确保 max_tokens 有默认值（某些 provider 必须）
    if (protocol === 'anthropic-messages') {
      if (payload.max_tokens === undefined || payload.max_tokens === null) {
        payload.max_tokens = 4096
        return Buffer.from(JSON.stringify(payload))
      }
    }

    return requestBody
  } catch {
    return requestBody
  }
}
