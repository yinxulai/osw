import { useCallback, useMemo } from 'react'
import { useToast } from '@/components/ui/toast'
import { useUpdateQueueModelMutation } from '../queries'
import { useHealth } from '@/features/health/hooks'
import { useProviders } from '@/features/providers/hooks'
import type { ProviderModelRoute } from '@common/schemas'
import { useProxyToggle } from './use-proxy-toggle'
import { useQueueInteractions } from './use-queue-interactions'
import { useQueueMetrics } from './use-queue-metrics'
import { useQueueMode } from './use-queue-mode'
import { useQueueModels } from './use-queue-models'

export function useQueueControl() {
  const toast = useToast()
  const updateModelMutation = useUpdateQueueModelMutation()
  const providers = useProviders()
  const healthState = useHealth()
  const health = healthState.providers
  const providerModelHealth = healthState.providerModels
  const modelsState = useQueueModels()
  const metrics = useQueueMetrics()
  const proxy = useProxyToggle()
  const queueMode = useQueueMode(modelsState.models, health, providerModelHealth)
  const interactions = useQueueInteractions(
    modelsState.models,
    modelsState.updateModels,
    modelsState.loadModels,
    proxy.proxyBaseUrl,
  )

  const providersMap = useMemo(
    () => Object.fromEntries(providers.map(provider => [provider.id, provider])),
    [providers],
  )

  const updateEnabled = useCallback(async (model: ProviderModelRoute, enabled: boolean) => {
    try {
      const updated = await updateModelMutation.mutateAsync({ id: model.id, enabled })
      modelsState.updateEnabledModel(model.id, updated.enabled)
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }, [modelsState.updateEnabledModel, toast, updateModelMutation])

  const reload = useCallback(async () => {
    await Promise.all([
      modelsState.loadModels(),
      queueMode.refresh(),
      metrics.refresh(),
    ])
  }, [metrics.refresh, modelsState.loadModels, queueMode.refresh])

  return {
    models: modelsState.models,
    providers: providersMap,
    health,
    providerModelHealth,
    modelMetrics: metrics.modelMetrics,
    proxyStatus: proxy.proxyStatus,
    manualModelId: queueMode.manualModelId,
    mode: queueMode.mode,
    switchingMode: queueMode.switchingMode,
    copied: interactions.copied,
    loading: modelsState.loading,
    proxyBaseUrl: proxy.proxyBaseUrl,
    reload,
    copyEndpoint: interactions.copyEndpoint,
    changeMode: queueMode.changeMode,
    selectManualModel: queueMode.selectManualModel,
    isCooling: queueMode.isCooling,
    updateEnabled,
    handleDragEnd: interactions.handleDragEnd,
    toggleProxy: proxy.toggleProxy,
  }
}
