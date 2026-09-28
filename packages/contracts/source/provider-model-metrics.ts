import { averageOutputTokensPerSecond, type OutputSpeedSample } from './metrics'
import type { AttemptStatus, RequestStatus } from './schemas'

export interface ProviderModelMetrics {
  sampleCount: number
  avgTps: number | null
  avgTtftMilliseconds: number | null
}

interface ProviderModelMetricAttempt {
  status: AttemptStatus
  providerId: string
  providerModelId: string
  ttftMilliseconds: number | null
  durationMilliseconds: number
}

interface ProviderModelMetricLog {
  status: RequestStatus
  id: string
  outputTokens: number | null
  attempts: readonly ProviderModelMetricAttempt[]
}

interface MetricAccumulator {
  requestIds: Set<string>
  speedSamples: OutputSpeedSample[]
  ttftTotal: number
  ttftCount: number
}

export function providerModelMetricKey(providerId: string, providerModelId: string): string {
  return `${providerId}\0${providerModelId}`
}

/**
 * 同一批成功请求按「真正服务请求的模型」聚合。
 *
 * 输入刻意只要求指标计算用得到的字段，而不是完整的 RequestLogEntry：
 * 控制台按请求详情消费，托盘摘要只需要从两张表拼出同一形状，两边共用这里的口径。
 */
export function calculateProviderModelMetrics(logs: readonly ProviderModelMetricLog[]): Record<string, ProviderModelMetrics> {
  const accumulators = new Map<string, MetricAccumulator>()

  for (const log of logs) {
    if (log.status !== 'success') continue
    const successfulAttempt = log.attempts.find(attempt => attempt.status === 'success')
    if (!successfulAttempt) continue

    const key = providerModelMetricKey(successfulAttempt.providerId, successfulAttempt.providerModelId)
    const accumulator = accumulators.get(key) ?? {
      requestIds: new Set<string>(),
      speedSamples: [],
      ttftTotal: 0,
      ttftCount: 0,
    }
    accumulator.requestIds.add(log.id)

    if (successfulAttempt.ttftMilliseconds != null) {
      accumulator.ttftTotal += successfulAttempt.ttftMilliseconds
      accumulator.ttftCount += 1
    }

    accumulator.speedSamples.push({
      outputTokens: log.outputTokens,
      attemptDurationMilliseconds: successfulAttempt.durationMilliseconds,
    })

    accumulators.set(key, accumulator)
  }

  return Object.fromEntries(Array.from(accumulators, ([key, accumulator]) => [key, {
    sampleCount: accumulator.requestIds.size,
    avgTps: averageOutputTokensPerSecond(accumulator.speedSamples),
    avgTtftMilliseconds: accumulator.ttftCount > 0 ? accumulator.ttftTotal / accumulator.ttftCount : null,
  }]))
}
