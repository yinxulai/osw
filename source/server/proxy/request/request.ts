export function resolveUpstreamUrl(upstreamUrl: string): string {
  const parsed = new URL(upstreamUrl)

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported upstream URL protocol: ${parsed.protocol}`)
  }

  return parsed.toString()
}

export function validateLogicalModel(requestBody: Buffer): string | null {
  let payload: unknown
  try {
    payload = JSON.parse(requestBody.toString('utf8'))
  } catch {
    return '请求体必须是 JSON 对象'
  }
  if (payload === null || Array.isArray(payload) || typeof payload !== 'object') {
    return '请求体必须是 JSON 对象'
  }
  const model = (payload as Record<string, unknown>).model
  if (model === undefined) return '缺少 model 字段'
  if (typeof model !== 'string' || model.trim().length === 0) return 'model 必须为非空字符串'
  return null
}

export function rewriteRequestModel(requestBody: Buffer, providerModelName: string): Buffer {
  if (requestBody.length === 0) return requestBody

  try {
    const payload: unknown = JSON.parse(requestBody.toString('utf8'))
    if (payload === null || Array.isArray(payload) || typeof payload !== 'object') {
      throw new Error('Request body must be a JSON object')
    }

    return Buffer.from(JSON.stringify({ ...payload, model: providerModelName }))
  } catch (error) {
    if (error instanceof Error && error.message === 'Request body must be a JSON object') {
      throw error
    }
    throw new Error('Request body must be a JSON object', { cause: error })
  }
}
