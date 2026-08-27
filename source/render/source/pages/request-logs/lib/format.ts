export const PROTOCOL_LABEL: Record<string, string> = {
  'openai-responses': 'OpenAI Responses',
  'openai-completions': 'OpenAI Completions',
  'anthropic-messages': 'Anthropic Messages',
}

export const STATUS_LABEL: Record<string, string> = {
  pending: '进行中',
  success: '成功',
  failed: '失败',
  cancelled: '已取消',
}

export function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour12: false })
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatTTFT(ttftMs: number | null | undefined): string {
  if (ttftMs == null) return '—'
  return `${(ttftMs / 1000).toFixed(2)}s`
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function formatTPS(outputTokens: number | null | undefined, totalMs: number): string {
  if (outputTokens == null || outputTokens <= 0 || totalMs <= 0) return '—'
  const tps = (outputTokens / totalMs) * 1000
  return tps >= 10 ? `${Math.round(tps)}` : tps.toFixed(1)
}
