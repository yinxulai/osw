import { useCallback, useEffect, useState } from 'react'
import type { DragEndEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import {
  upstreamModelApi,
  healthApi,
  logicalModelApi,
  providerApi,
  proxyApi,
  queueApi,
} from '@/api'
import { useToast } from '@/components/ui/toast'
import type { LogicalModel, UpstreamModel, Provider, ProviderHealth, ProxyServerStatus } from '@common/schemas'

export function useQueueControlService() {
  const toast = useToast()
  const [logicalModel, setLogicalModel] = useState<LogicalModel | null>(null)
  const [models, setModels] = useState<UpstreamModel[]>([])
  const [providers, setProviders] = useState<Record<string, Provider>>({})
  const [health, setHealth] = useState<Record<string, ProviderHealth>>({})
  const [proxyStatus, setProxyStatus] = useState<ProxyServerStatus | null>(null)
  const [manualModelId, setManualModelId] = useState<string | null>(null)
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    const [modelResult, providerResult, healthResult, statusResult, queueResult] = await Promise.all([
      logicalModelApi.list(),
      providerApi.list(),
      healthApi.list(),
      proxyApi.status(),
      queueApi.status(),
    ])
    const failed = [modelResult, providerResult, healthResult, statusResult, queueResult].find(result => !result.success)
    if (failed && !failed.success) {
      toast.error(failed.errorMessage)
      setLoading(false)
      return
    }
    if (!modelResult.success || !providerResult.success || !healthResult.success || !statusResult.success || !queueResult.success) return
    const currentModel = modelResult.data.find(model => model.enabled) ?? modelResult.data[0] ?? null
    const modelListResult = currentModel ? await upstreamModelApi.list(currentModel.id) : null
    if (modelListResult && !modelListResult.success) {
      toast.error(modelListResult.errorMessage)
      setLoading(false)
      return
    }
    setLogicalModel(currentModel)
    setModels(modelListResult?.success ? modelListResult.data : [])
    setProviders(Object.fromEntries(providerResult.data.map(provider => [provider.id, provider])))
    setHealth(Object.fromEntries(healthResult.data.map(item => [item.providerId, item])))
    setProxyStatus(statusResult.data)
    setManualModelId(queueResult.data.manualModelId)
    setMode(queueResult.data.manualModelId ? 'manual' : 'auto')
    setLoading(false)
  }, [toast])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const proxyBaseUrl = proxyStatus ? `http://${proxyStatus.host}:${proxyStatus.port}` : ''

  const copyEndpoint = useCallback(async (url?: string) => {
    await navigator.clipboard.writeText(url ?? proxyBaseUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }, [proxyBaseUrl])

  const changeMode = useCallback(async (nextMode: 'auto' | 'manual') => {
    if (nextMode === 'auto') {
      const result = await queueApi.switch(null)
      if (!result.success) { toast.error(result.errorMessage); return }
      setManualModelId(null)
      setMode('auto')
      return
    }
    const initialModelId = manualModelId ?? models.find(model => model.enabled)?.id ?? null
    if (!initialModelId) return
    const result = await queueApi.switch(initialModelId)
    if (!result.success) { toast.error(result.errorMessage); return }
    setManualModelId(initialModelId)
    setMode('manual')
  }, [manualModelId, models])

  const isCooling = useCallback((providerId: string) => {
    const cooldownUntil = health[providerId]?.cooldownUntilTime
    return Boolean(cooldownUntil && cooldownUntil > Date.now())
  }, [health])

  const selectManualModel = useCallback(async (model: UpstreamModel) => {
    if (mode !== 'manual' || !model.enabled || isCooling(model.providerId)) return
    const result = await queueApi.switch(model.id)
    if (!result.success) { toast.error(result.errorMessage); return }
    setManualModelId(model.id)
  }, [mode, isCooling])

  const updateEnabled = useCallback(async (model: UpstreamModel, enabled: boolean) => {
    const result = await upstreamModelApi.update(model.id, { enabled })
    if (!result.success) { toast.error(result.errorMessage); return }
    setModels(current => current.map(item => item.id === model.id ? result.data : item))
    if (!enabled && manualModelId === model.id) await changeMode('auto')
  }, [manualModelId, changeMode])

  const handleDragEnd = useCallback(async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const oldIndex = models.findIndex(model => model.id === active.id)
    const newIndex = models.findIndex(model => model.id === over.id)
    const reordered = arrayMove(models, oldIndex, newIndex).map((model, index) => ({ ...model, priority: index + 1 }))
    setModels(reordered)
    const results = await Promise.all(reordered.map(model => upstreamModelApi.update(model.id, { priority: model.priority })))
    if (results.some(result => !result.success)) {
      toast.error('队列顺序保存失败，已恢复服务端数据')
      await loadData()
    }
  }, [models, loadData])

  const toggleProxy = useCallback(async () => {
    const result = proxyStatus?.running ? await proxyApi.stop() : await proxyApi.start()
    if (!result.success) { toast.error(result.errorMessage); return }
    setProxyStatus(result.data)
    toast.success(result.data.running ? '服务已启动' : '服务已停止')
  }, [proxyStatus, toast])

  return {
    // 状态
    logicalModel,
    models,
    providers,
    health,
    proxyStatus,
    manualModelId,
    mode,
    copied,
    loading,
    proxyBaseUrl,
    // 操作
    loadData,
    copyEndpoint,
    changeMode,
    selectManualModel,
    isCooling,
    updateEnabled,
    handleDragEnd,
    toggleProxy,
  }
}
