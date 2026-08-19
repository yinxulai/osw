export type UpstreamStatusDisposition = 'success' | 'retry' | 'terminal'

export function classifyUpstreamStatus(statusCode: number): UpstreamStatusDisposition {
  if (statusCode >= 200 && statusCode < 300) return 'success'
  if (statusCode === 401 || statusCode === 403 || statusCode === 408 || statusCode === 429) {
    return 'retry'
  }
  if (statusCode >= 500) return 'retry'
  return 'terminal'
}
