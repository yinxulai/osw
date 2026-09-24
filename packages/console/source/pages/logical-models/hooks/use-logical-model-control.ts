import { useCallback, useMemo } from 'react'
import { useToast } from '@/components/ui/toast'
import { useUpdateProviderModelMutation } from '../queries'
import { useHealth } from '@/data/health'
import { useProviders } from '@/data/providers'
import type { LogicalModelProviderModel } from '@common/schemas'
import { useProxyToggle } from './use-proxy-toggle'
import { useLogicalModelInteractions } from './use-logical-model-interactions'
import { useLogicalModelMetrics } from './use-logical-model-metrics'
import { useLogicalModelMode } from './use-logical-model-mode'
import { useLogicalModelProviderModels } from './use-logical-model-provider-models'

export function useLogicalModelControl(logicalModelId: string) {
  const toast = useToast()
  const updateModelMutation = useUpdateProviderModelMutation(logicalModelId)
  const providers = useProviders()
  const healthState = useHealth()
  const health = healthState.providers
  const providerModelHealth = healthState.providerModels
  const modelsState = useLogicalModelProviderModels(logicalModelId)
  const metrics = useLogicalModelMetrics(logicalModelId)
  const proxy = useProxyToggle()
  const routingMode = useLogicalModelMode(logicalModelId, modelsState.models, health, providerModelHealth)
  const interactions = useLogicalModelInteractions(
    logicalModelId,
    modelsState.models,
    modelsState.updateModels,
    modelsState.loadModels,
    proxy.proxyBaseUrl,
  )

  const providersMap = useMemo(
    () => Object.fromEntries(providers.map(provider => [provider.id, provider])),
    [providers],
  )

  const updateEnabled = useCallback(async (model: LogicalModelProviderModel, enabled: boolean) => {
    // 模型本体被全局停用时不允许打开绑定：打开的绑定不会被调度，只会让这一行看着可用。
    // 界面里这个开关已经置灰，这里是万一被别的入口调到时的一致处理。
    if (enabled && !model.modelEnabled) return
    try {
      const updated = await updateModelMutation.mutateAsync({ id: model.id, enabled })
      modelsState.updateEnabledModel(model.id, updated.enabled)
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }, [modelsState.updateEnabledModel, toast, updateModelMutation])

  const reload = useCallback(async () => {
    await Promise.all([
      modelsState.loadModels(),
      routingMode.refresh(),
      metrics.refresh(),
    ])
  }, [metrics.refresh, modelsState.loadModels, routingMode.refresh])

  return {
    models: modelsState.models,
    providers: providersMap,
    health,
    providerModelHealth,
    modelMetrics: metrics.modelMetrics,
    summaryMetrics: metrics.summaryMetrics,
    proxyStatus: proxy.proxyStatus,
    manualModelId: routingMode.manualModelId,
    mode: routingMode.mode,
    switchingMode: routingMode.switchingMode,
    copied: interactions.copied,
    loading: modelsState.loading,
    proxyBaseUrl: proxy.proxyBaseUrl,
    reload,
    copyEndpoint: interactions.copyEndpoint,
    changeMode: routingMode.changeMode,
    selectManualModel: routingMode.selectManualModel,
    isCooling: routingMode.isCooling,
    updateEnabled,
    handleDragEnd: interactions.handleDragEnd,
    toggleProxy: proxy.toggleProxy,
  }
}
