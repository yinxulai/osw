import { useCallback, useMemo } from 'react'
import { providerModelApi } from '@/api/models'
import { useToast } from '@/components/ui/toast'
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
    const result = await providerModelApi.update(model.id, { enabled })
    if (!result.success) { toast.error(result.errorMessage); return }
    modelsState.updateEnabledModel(model.id, result.data.enabled)
    if (!enabled && queueMode.manualModelId === model.id) await queueMode.changeMode('auto')
  }, [modelsState.updateEnabledModel, queueMode.changeMode, queueMode.manualModelId, toast])

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
