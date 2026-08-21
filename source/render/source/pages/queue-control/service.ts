import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEndEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import {
  providerModelApi,
  schedulingPolicyApi,
  queueApi,
  requestLogApi,
} from '@/api'
import { useToast } from '@/components/ui/toast'
import {
  useProviders,
  useHealth,
  useProxyStatus,
  useAppPolling,
  useAppActions,
} from '@/services/app-hooks'
import type { ProviderModelRoute } from '@common/schemas'
import { calculateQueueModelMetrics, type QueueModelMetrics } from './lib/model-metrics'

export function useQueueControlService() {
  const toast = useToast()
  const appActions = useAppActions()

  // 全局共享状态（通过 store 订阅，不会因轮询导致本页 loading 闪烁）
  const providers = useProviders()
  const health = useHealth()
  const proxyStatus = useProxyStatus()

  // 本页状态
  const [models, setModels] = useState<ProviderModelRoute[]>([])
  const [modelMetrics, setModelMetrics] = useState<Record<string, QueueModelMetrics>>({})
  const [manualModelId, setManualModelId] = useState<string | null>(null)
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)
  const initializedRef = useRef(false)

  // 订阅全局轮询：供应商 30 秒、健康状态 5 秒、代理状态 5 秒（App 已订阅，这里共享）
  useAppPolling('health', 5000)
  useAppPolling('providers', 30000)
  useAppPolling('proxyStatus', 5000)

  const loadModels = useCallback(async () => {
    const [modelResult, policyResult] = await Promise.all([
      providerModelApi.list(),
      schedulingPolicyApi.list('auto'),
    ])
    if (!modelResult.success) {
      toast.error(modelResult.errorMessage)
      return
    }
    if (!policyResult.success) {
      toast.error(policyResult.errorMessage)
      return
    }
    const priorityByModelId = new Map(policyResult.data.map(policy => [policy.providerModelId, policy.priority]))
    setModels(modelResult.data.map(model => ({
      id: model.id,
      providerId: model.providerId,
      modelName: model.modelName,
      endpoints: model.endpoints.map(endpoint => ({
        protocol: endpoint.protocol,
        upstreamUrl: endpoint.url ?? '',
        customAuthHeader: null,
        protocolConversionEnabled: endpoint.conversions.some(conversion => conversion.enabled),
      })),
      priority: priorityByModelId.get(model.id) ?? Number.MAX_SAFE_INTEGER,
      enabled: model.enabled,
      createdTime: model.createdTime,
      updatedTime: model.updatedTime,
      deletedTime: model.deletedTime,
    })))
  }, [toast])

  // 初始化：加载全局上游模型队列
  useEffect(() => {
    if (initializedRef.current) return

    initializedRef.current = true
    void loadModels()
    setLoading(false)
  }, [loadModels])

  // 定期静默刷新队列
  useEffect(() => {
    if (!initializedRef.current) return
    const timer = window.setInterval(() => void loadModels(), 30000)
    return () => window.clearInterval(timer)
  }, [initializedRef.current, loadModels])

  // 队列状态 + 请求指标（本页专属数据，首次加载后静默刷新）
  const loadQueueData = useCallback(async () => {
    const [queueResult, logResult] = await Promise.all([
      queueApi.status('auto'),
      requestLogApi.list({ limit: 100 }),
    ])
    if (queueResult.success) {
      setManualModelId(queueResult.data.manualModelId)
      setMode(queueResult.data.manualModelId ? 'manual' : 'auto')
    }
    if (logResult.success) {
      setModelMetrics(calculateQueueModelMetrics(logResult.data.logs))
    }
  }, [])

  useEffect(() => {
    if (!initializedRef.current) return
    void loadQueueData()
    const timer = window.setInterval(() => void loadQueueData(), 5000)
    return () => window.clearInterval(timer)
  }, [initializedRef.current, loadQueueData])

  const proxyBaseUrl = proxyStatus ? `http://${proxyStatus.host}:${proxyStatus.port}` : ''

  // providers 数组转为 id 映射，供组件按 id 查找
  const providersMap = useMemo(
    () => Object.fromEntries(providers.map(p => [p.id, p])),
    [providers],
  )

  const copyEndpoint = useCallback(async (url?: string) => {
    await navigator.clipboard.writeText(url ?? proxyBaseUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }, [proxyBaseUrl])

  const changeMode = useCallback(async (nextMode: 'auto' | 'manual') => {
    if (nextMode === 'auto') {
      const result = await queueApi.switch('auto', null)
      if (!result.success) { toast.error(result.errorMessage); return }
      setManualModelId(null)
      setMode('auto')
      return
    }
    const initialModelId = manualModelId ?? models.find(model => model.enabled)?.id ?? null
    if (!initialModelId) return
    const result = await queueApi.switch('auto', initialModelId)
    if (!result.success) { toast.error(result.errorMessage); return }
    setManualModelId(initialModelId)
    setMode('manual')
  }, [manualModelId, models])

  const isCooling = useCallback((providerId: string) => {
    const cooldownUntil = health[providerId]?.cooldownUntilTime
    return Boolean(cooldownUntil && cooldownUntil > Date.now())
  }, [health])

  const selectManualModel = useCallback(async (model: ProviderModelRoute) => {
    if (mode !== 'manual' || !model.enabled || isCooling(model.providerId)) return
    const result = await queueApi.switch('auto', model.id)
    if (!result.success) { toast.error(result.errorMessage); return }
    setManualModelId(model.id)
  }, [mode, isCooling])

  const updateEnabled = useCallback(async (model: ProviderModelRoute, enabled: boolean) => {
    const result = await providerModelApi.update(model.id, { enabled })
    if (!result.success) { toast.error(result.errorMessage); return }
    setModels(current => current.map(item => item.id === model.id ? { ...item, enabled: result.data.enabled } : item))
    if (!enabled && manualModelId === model.id) await changeMode('auto')
  }, [manualModelId, changeMode])

  const reload = useCallback(async () => {
    await loadModels()
    await loadQueueData()
  }, [loadModels, loadQueueData])

  const handleDragEnd = useCallback(async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const oldIndex = models.findIndex(model => model.id === active.id)
    const newIndex = models.findIndex(model => model.id === over.id)
    const reordered = arrayMove(models, oldIndex, newIndex).map((model, index) => ({ ...model, priority: index + 1 }))
    setModels(reordered)
    const results = await Promise.all(reordered.map(model => schedulingPolicyApi.update({
      logicalModelId: 'auto',
      providerModelId: model.id,
      priority: model.priority,
    })))
    if (results.some(result => !result.success)) {
      toast.error('队列顺序保存失败，已恢复服务端数据')
      await reload()
    }
  }, [models, reload])

  const toggleProxy = useCallback(async () => {
    const result = proxyStatus?.running
      ? await appActions.stopProxy()
      : await appActions.startProxy()
    if (!result.success) {
      toast.error(result.errorMessage)
      return
    }
    toast.success(result.data.running ? '服务已启动' : '服务已停止')
  }, [proxyStatus, appActions, toast])

  return {
    // 状态
    models,
    providers: providersMap,
    health,
    modelMetrics,
    proxyStatus,
    manualModelId,
    mode,
    copied,
    loading,
    proxyBaseUrl,
    // 操作
    reload,
    copyEndpoint,
    changeMode,
    selectManualModel,
    isCooling,
    updateEnabled,
    handleDragEnd,
    toggleProxy,
  }
}
