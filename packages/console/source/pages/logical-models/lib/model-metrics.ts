import type { RequestLogEntry } from '@common/schemas'
import { averageOutputTokensPerSecond, outputSpeedSampleOf } from '@common/metrics'
export { calculateProviderModelMetrics, providerModelMetricKey, type ProviderModelMetrics } from '@common/provider-model-metrics'

export interface LogicalModelSummaryMetrics {
  completedRequestCount: number
  successCount: number
  successRate: number | null
  avgDurationMilliseconds: number | null
  avgTps: number | null
  failoverCount: number
}

export function calculateLogicalModelSummaryMetrics(logs: RequestLogEntry[]): LogicalModelSummaryMetrics {
  const completedLogs = logs.filter(log => log.status === 'success' || log.status === 'failed' || log.status === 'cancelled')
  const successfulLogs = completedLogs.filter(log => log.status === 'success')
  // 平均耗时与平均速度取自**同一批样本**：样本的耗时是「服务该请求的那次尝试」的端到端耗时，
  // 没有尝试可用时才退回请求级总耗时——这条回落规则由 `@common/metrics` 定义，这里不重写一份。
  const speedSamples = successfulLogs.map(outputSpeedSampleOf)
  const durations = speedSamples.map(sample => sample.attemptDurationMilliseconds).filter(duration => duration > 0)

  return {
    completedRequestCount: completedLogs.length,
    successCount: successfulLogs.length,
    successRate: completedLogs.length > 0 ? successfulLogs.length / completedLogs.length : null,
    avgDurationMilliseconds: durations.length > 0 ? durations.reduce((total, duration) => total + duration, 0) / durations.length : null,
    // 平均速度由 `@common/metrics` 用「先求和再相除」算出：先算每个请求的速度再取算术平均
    // 会让 20 Token 的短响应与 4000 Token 的长响应一样重，均值被短样本主导。
    avgTps: averageOutputTokensPerSecond(speedSamples),
    failoverCount: successfulLogs.filter(log => log.attempts.some(attempt => attempt.status === 'success' && attempt.attemptIndex > 0)).length,
  }
}
