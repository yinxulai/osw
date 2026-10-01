import { useCallback, useMemo } from 'react'
import { useToast } from '@/components/ui/toast'
import { EMPTY_LOGICAL_MODEL_REF, useUpdateProviderModelMutation, type LogicalModelKeysRef } from '../queries'
import { useHealth } from '@/data/health'
import { useProviders } from '@/data/providers'
import type { LogicalModelProviderModel } from '@common/schemas'
import { useProxyToggle } from './use-proxy-toggle'
import { useLogicalModelInteractions } from './use-logical-model-interactions'
import { useLogicalModelMetrics } from './use-logical-model-metrics'
import { useLogicalModelMode } from './use-logical-model-mode'
import { useLogicalModelProviderModels } from './use-logical-model-provider-models'

/**
 * 一个逻辑模型的全部控制行为。
 *
 * 入参是整条记录而不是一个字符串：绑定接口要**数据记录 id**、手动锁定与请求日志要
 * **模型 id**，两个都是字符串，只传一个的话下层只能猜。
 * `null` 表示列表还没就绪，此时所有查询不开火，返回的是一个稳定的空壳。
 */
export function useLogicalModelControl(logicalModel: LogicalModelKeysRef | null) {
  const toast = useToast()
  const updateModelMutation = useUpdateProviderModelMutation(logicalModel ?? EMPTY_LOGICAL_MODEL_REF)
  const providers = useProviders()
  const healthState = useHealth()
  const health = healthState.providers
  const providerModelHealth = healthState.providerModels
  const modelsState = useLogicalModelProviderModels(logicalModel)
  const metrics = useLogicalModelMetrics(logicalModel)
  const proxy = useProxyToggle()
  const routingMode = useLogicalModelMode(logicalModel, modelsState.models, health, providerModelHealth)
  const interactions = useLogicalModelInteractions(
    logicalModel?.id ?? '',
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
