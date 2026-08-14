export function resolveUpstreamUrl(upstreamUrl: string): string {
  const parsed = new URL(upstreamUrl)

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported upstream URL protocol: ${parsed.protocol}`)
  }

  return parsed.toString()
}

/**
 * 解析实际使用的上游地址：优先使用模型绑定自身配置的地址，
 * 否则回退到该供应商在对应协议下的默认地址。
 */
export function resolveEffectiveUpstreamUrl(bindingUrl: string, providerUpstreamUrls: string | null | undefined, protocol: string): string {
  if (bindingUrl.trim()) return bindingUrl.trim()

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
