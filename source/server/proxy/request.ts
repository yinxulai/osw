import type { Protocol } from '@common/schemas'

const GEMINI_PATH_PATTERN = /^(.*\/v1beta\/models\/)[^/]+:(generateContent|streamGenerateContent)$/

export function resolveUpstreamUrl(
  clientUrl: string,
  upstreamUrl: string,
  protocol?: Protocol,
  upstreamModelId?: string,
): string {
  const parsed = new URL(upstreamUrl)

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported upstream URL protocol: ${parsed.protocol}`)
  }

  if (protocol === 'gemini') {
    const client = new URL(clientUrl, 'http://localhost')
    const clientMatch = client.pathname.match(GEMINI_PATH_PATTERN)
    const upstreamMatch = parsed.pathname.match(GEMINI_PATH_PATTERN)
    if (!clientMatch || !upstreamMatch || !upstreamModelId) {
      throw new Error('Gemini upstream URL must end with /v1beta/models/{model}:generateContent')
    }

    const action = clientMatch[2]
    parsed.pathname = `${upstreamMatch[1]}${encodeURIComponent(upstreamModelId)}:${action}`
    for (const [name, value] of client.searchParams) parsed.searchParams.set(name, value)
  }

  return parsed.toString()
}

export function rewriteRequestModel(
  requestBody: Buffer,
  upstreamModelId: string,
  protocol: Protocol = 'openai',
): Buffer {
  if (requestBody.length === 0) return requestBody

  if (protocol === 'gemini') return requestBody

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
