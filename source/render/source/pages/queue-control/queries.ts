import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { providerModelApi } from '@/api/models'
import { queueApi } from '@/api/runtime'
import { requestLogApi } from '@/api/observability'
import { unwrap } from '@/api/unwrap'
import { calculateQueueModelMetrics, calculateQueueSummaryMetrics } from './lib/model-metrics'

type UpdateQueueModelVariables = { id: string; enabled: boolean }

export const queueKeys = {
  models: ['queue-models'] as const,
  mode: ['queue-mode'] as const,
  metrics: ['queue-metrics'] as const,
}

export const useQueueModelsQuery = () => useQuery({ queryKey: queueKeys.models, queryFn: () => unwrap(providerModelApi.queue('default')), refetchInterval: 30_000 })
export const useQueueModeQuery = () => useQuery({ queryKey: queueKeys.mode, queryFn: () => unwrap(queueApi.status('default')), refetchInterval: 5_000 })
export const useQueueMetricsQuery = () => useQuery({
  queryKey: queueKeys.metrics,
  queryFn: async () => {
    const data = await unwrap(requestLogApi.list({ limit: 100 }))
    return { modelMetrics: calculateQueueModelMetrics(data.logs), summaryMetrics: calculateQueueSummaryMetrics(data.logs) }
  },
  refetchInterval: 5_000,
})
export function useSwitchQueueMutation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (modelId: string | null) => unwrap(queueApi.switch('default', modelId)),
    onSuccess: data => client.setQueryData(queueKeys.mode, {
      logicalModelId: data.logicalModelId,
      manualModelId: data.modelId,
    }),
  })
}

export function useUpdateQueueModelMutation() {
  const client = useQueryClient()
  return useMutation({ mutationFn: ({ id, enabled }: UpdateQueueModelVariables) => unwrap(providerModelApi.update(id, { enabled })), onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: queueKeys.models }), client.invalidateQueries({ queryKey: ['provider-models'] })]) } })
}
