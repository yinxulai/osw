export type UpstreamStatusDisposition = 'success' | 'retry' | 'terminal'
export type HealthFailureScope = 'provider' | 'provider-model' | 'none'

export function classifyUpstreamStatus(statusCode: number): UpstreamStatusDisposition {
  if (statusCode >= 200 && statusCode < 300) return 'success'
  if (statusCode === 401 || statusCode === 403 || statusCode === 408 || statusCode === 429) {
    return 'retry'
  }
  if (statusCode >= 500) return 'retry'
  return 'terminal'
}

export function classifyHealthFailure(statusCode: number | null, responseBody?: string | null): HealthFailureScope {
  if (statusCode === null) return 'provider'
  if (statusCode === 401 || statusCode === 403) return 'provider'
  if (statusCode === 429) {
    const normalizedBody = responseBody?.toLowerCase() ?? ''
    const providerLimited = /(?:account|organization|project|provider|api[ _-]?key).*(?:quota|rate[ _-]?limit)|(?:quota|rate[ _-]?limit).*(?:account|organization|project|provider|api[ _-]?key)/.test(normalizedBody)
    return providerLimited ? 'provider' : 'provider-model'
  }
  if (statusCode === 404 || statusCode === 408 || statusCode >= 500) return 'provider-model'
  return 'none'
}
