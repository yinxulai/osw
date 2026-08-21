import type { RequestLogEntry } from '@common/schemas'

export interface QueueModelMetrics {
  sampleCount: number
  avgTps: number | null
  avgTtftMilliseconds: number | null
}

interface MetricAccumulator {
  requestIds: Set<string>
  tpsTotal: number
  tpsCount: number
  ttftTotal: number
  ttftCount: number
}

export function queueModelMetricKey(providerId: string, providerModelId: string): string {
  return `${providerId}\0${providerModelId}`
}

export function calculateQueueModelMetrics(logs: RequestLogEntry[]): Record<string, QueueModelMetrics> {
  const accumulators = new Map<string, MetricAccumulator>()

  for (const log of logs) {
    if (log.status !== 'success') continue
    const successfulAttempt = log.attempts.find(attempt => attempt.status === 'success')
    if (!successfulAttempt) continue

    const key = queueModelMetricKey(successfulAttempt.providerId, successfulAttempt.providerModelId)
    const accumulator = accumulators.get(key) ?? {
      requestIds: new Set<string>(),
      tpsTotal: 0,
      tpsCount: 0,
      ttftTotal: 0,
      ttftCount: 0,
    }
    accumulator.requestIds.add(log.id)

    if (log.ttftMilliseconds != null) {
      accumulator.ttftTotal += log.ttftMilliseconds
      accumulator.ttftCount += 1
    }

    const generationMilliseconds = log.ttftMilliseconds != null && log.ttftMilliseconds < log.totalDurationMilliseconds
      ? log.totalDurationMilliseconds - log.ttftMilliseconds
      : log.totalDurationMilliseconds
    if (log.outputTokens != null && log.outputTokens > 0 && generationMilliseconds > 0) {
      accumulator.tpsTotal += log.outputTokens * 1000 / generationMilliseconds
      accumulator.tpsCount += 1
    }

    accumulators.set(key, accumulator)
  }

  return Object.fromEntries(Array.from(accumulators, ([key, accumulator]) => [key, {
    sampleCount: accumulator.requestIds.size,
    avgTps: accumulator.tpsCount > 0 ? accumulator.tpsTotal / accumulator.tpsCount : null,
    avgTtftMilliseconds: accumulator.ttftCount > 0 ? accumulator.ttftTotal / accumulator.ttftCount : null,
  }]))
}
