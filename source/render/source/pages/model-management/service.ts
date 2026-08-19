import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEndEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { upstreamModelApi, providerApi } from '@/api'
import { useToast } from '@/components/ui/toast'
import {
  useProviders,
  useProvidersLoading,
  useHealth,
  useLogicalModels,
  useLogicalModelsLoading,
  useAppPolling,
  useAppActions,
} from '@/services/app-hooks'
import type { UpstreamModel, Protocol, ProtocolEndpoint, Provider } from '@common/schemas'
import { PROTOCOL_OPTIONS } from './lib/protocols'

export interface BindingEntry {
  protocol: Protocol
  enabled: boolean
  overrideUrl: boolean
  upstreamUrl: string
}

export interface ProviderEndpointEntry {
  protocol: Protocol
  enabled: boolean
  url: string
}

type ProviderEndpoints = Partial<Record<Protocol, string>>

function parseProviderEndpoints(provider?: Provider): ProviderEndpoints {
  if (!provider) return {}
  try {
    const parsed = JSON.parse(provider.upstreamUrls ?? '{}') as Record<string, string>
    return {
      'openai-completions': parsed['openai-completions'] ?? '',
      'openai-responses': parsed['openai-responses'] ?? '',
      'anthropic-messages': parsed['anthropic-messages'] ?? '',
    }
  } catch {
    return {}
  }
}

export function getEffectiveEndpointUrl(endpoint: ProtocolEndpoint, provider?: Provider): string {
  if (endpoint.upstreamUrl.trim()) return endpoint.upstreamUrl
  if (!provider) return ''
  return parseProviderEndpoints(provider)[endpoint.protocol] ?? ''
}

export function useModelManagementService() {
  const toast = useToast()
  const appActions = useAppActions()

  // 全局共享状态
  const providers = useProviders()
  const health = useHealth()
  const logicalModels = useLogicalModels()
  const providersLoading = useProvidersLoading()
  const logicalModelsLoading = useLogicalModelsLoading()

  // 本页状态
  const [models, setModels] = useState<UpstreamModel[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const initializedRef = useRef(false)

  // Provider dialog state
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)
  const [providerName, setProviderName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [timeout, setTimeout] = useState('30000')
  const [providerEndpointEntries, setProviderEndpointEntries] = useState<ProviderEndpointEntry[]>([])

  // Model dialog state
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<UpstreamModel | null>(null)
  const [modelId, setModelId] = useState('')
  const [bindingEntries, setBindingEntries] = useState<BindingEntry[]>([])

  // 订阅全局轮询
  useAppPolling('providers', 10000)
  useAppPolling('health', 5000)

  const logicalModel = useMemo(
    () => logicalModels.find(model => model.enabled) ?? logicalModels[0] ?? null,
    [logicalModels],
  )

  const loadModels = useCallback(async (modelId: string) => {
    const result = await upstreamModelApi.list(modelId)
    if (!result.success) {
      toast.error(result.errorMessage)
      return
    }
    setModels(result.data)
  }, [toast])

  /** 写操作后刷新：静默刷新全局数据 + 重新加载本页模型列表 */
  const reload = useCallback(async () => {
    appActions.invalidateProviders()
    appActions.invalidateHealth()
    appActions.invalidateLogicalModels()
    if (logicalModel) {
      await loadModels(logicalModel.id)
    }
  }, [appActions, logicalModel, loadModels])

  // 当全局数据首次加载完成后，初始化本页数据
  useEffect(() => {
    if (initializedRef.current) return
    if (providersLoading || logicalModelsLoading) return
    if (logicalModels.length === 0) return

    initializedRef.current = true
    const currentModel = logicalModels.find(m => m.enabled) ?? logicalModels[0]
    if (currentModel) {
      void loadModels(currentModel.id)
    }
    setSelectedProviderId(providers[0]?.id ?? '')
    setLoading(false)
  }, [providersLoading, logicalModelsLoading, logicalModels, providers, loadModels])

  // 当 logicalModel 变化时重新加载上游模型（非首次）
  useEffect(() => {
    if (!initializedRef.current || !logicalModel) return
    void loadModels(logicalModel.id)
  }, [logicalModel?.id, loadModels])

  const selectedProvider = useMemo(
    () => providers.find(provider => provider.id === selectedProviderId),
    [providers, selectedProviderId],
  )

  const selectedModels = useMemo(
    () => models
      .filter(model => model.providerId === selectedProviderId)
      .sort((a, b) => a.priority - b.priority),
    [models, selectedProviderId],
  )

  // ========== Provider CRUD ==========

  const openProviderDialog = useCallback((provider?: Provider) => {
    setEditingProviderId(provider?.id ?? null)
    setProviderName(provider?.name ?? '')
    setApiKey('')
    setTimeout(String(provider?.timeoutMilliseconds ?? 30000))
    setProviderEndpointEntries(
      PROTOCOL_OPTIONS.map(option => {
        const url = parseProviderEndpoints(provider)[option.value] ?? ''
        return { protocol: option.value, enabled: Boolean(url), url }
      }),
    )
    setProviderDialogOpen(true)
  }, [])

  const closeProviderDialog = useCallback(() => {
    setProviderDialogOpen(false)
  }, [])

  const updateProviderEndpointEntry = useCallback((index: number, patch: Partial<ProviderEndpointEntry>) => {
    setProviderEndpointEntries(current => current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)))
  }, [])

  const saveProvider = useCallback(async () => {
    if (!providerName.trim() || (!editingProviderId && !apiKey.trim())) return
    setSaving(true)
    const endpoints: Record<string, string> = Object.fromEntries(
      providerEndpointEntries
        .filter(entry => entry.enabled)
        .map(entry => [entry.protocol, entry.url.trim()])
        .filter(([, value]) => value),
    )
    const result = editingProviderId
      ? await providerApi.update(editingProviderId, {
          name: providerName.trim(),
          timeoutMilliseconds: Number(timeout),
          endpoints,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        })
      : await providerApi.create({
          name: providerName.trim(),
          apiKey: apiKey.trim(),
          timeoutMilliseconds: Number(timeout),
          endpoints,
        })
    setSaving(false)
    if (!result.success) { toast.error(result.errorMessage); return }
    setProviderDialogOpen(false)
    setSelectedProviderId(result.data.id)
    toast.success(editingProviderId ? '供应商已更新' : '供应商已添加')
    await reload()
  }, [providerName, apiKey, timeout, editingProviderId, providerEndpointEntries, reload])

  const removeProvider = useCallback(async (provider: Provider) => {
    if (!window.confirm(`删除供应商"${provider.name}"？关联模型将被禁用。`)) return
    const result = await providerApi.remove(provider.id)
    if (!result.success) { toast.error(result.errorMessage); return }
    toast.success('供应商已删除')
    await reload()
  }, [reload])

  // ========== Model CRUD ==========

  const openModelDialog = useCallback((model?: UpstreamModel) => {
    setEditingModel(model ?? null)
    setModelId(model?.upstreamModelId ?? '')
    setBindingEntries(PROTOCOL_OPTIONS.map(option => {
      const match = model?.endpoints.find(endpoint => endpoint.protocol === option.value)
      return match
        ? { protocol: option.value, enabled: true, overrideUrl: Boolean(match.upstreamUrl.trim()), upstreamUrl: match.upstreamUrl }
        : { protocol: option.value, enabled: false, overrideUrl: false, upstreamUrl: '' }
    }))
    setModelDialogOpen(true)
  }, [])

  const closeModelDialog = useCallback(() => {
    setModelDialogOpen(false)
  }, [])

  const updateBindingEntry = useCallback((index: number, patch: Partial<BindingEntry>) => {
    setBindingEntries(current => current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)))
  }, [])

  const saveModel = useCallback(async () => {
    if (!logicalModel || !selectedProvider) return
    if (!modelId.trim()) return
    const enabledEntries = bindingEntries.filter(entry => entry.enabled)
    if (enabledEntries.length === 0) return
    setSaving(true)

    const endpoints: ProtocolEndpoint[] = enabledEntries.map(entry => ({
      protocol: entry.protocol,
      upstreamUrl: entry.overrideUrl ? entry.upstreamUrl.trim() : '',
      customAuthHeader: null,
    }))

    const basePriority = editingModel
      ? editingModel.priority
      : models.length === 0
        ? 1
        : Math.max(...models.map(model => model.priority)) + 1

    const result = editingModel
      ? await upstreamModelApi.update(editingModel.id, {
          upstreamModelId: modelId.trim(),
          endpoints,
        })
      : await upstreamModelApi.create({
          logicalModelId: logicalModel.id,
          providerId: selectedProvider.id,
          upstreamModelId: modelId.trim(),
          endpoints,
          priority: basePriority,
        })

    setSaving(false)
    if (!result.success) {
      toast.error(result.errorMessage)
      await reload()
      return
    }
    setModelDialogOpen(false)
    toast.success(editingModel ? '模型已更新' : '模型已添加')
    await reload()
  }, [logicalModel, selectedProvider, modelId, bindingEntries, editingModel, models, reload])

  const removeModel = useCallback(async (model: UpstreamModel) => {
    if (!window.confirm(`删除模型"${model.upstreamModelId}"？该模型关联的所有协议接口都会被移除。`)) return
    const result = await upstreamModelApi.remove(model.id)
    if (!result.success) { toast.error(result.errorMessage); return }
    toast.success('模型已删除')
    await reload()
  }, [reload])

  // ========== Drag & Drop ==========

  const handleDragEnd = useCallback(async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const oldIndex = selectedModels.findIndex(model => model.id === active.id)
    const newIndex = selectedModels.findIndex(model => model.id === over.id)
    const reordered = arrayMove(selectedModels, oldIndex, newIndex)
    const updates: { id: string; priority: number }[] = reordered.map((model, index) => ({
      id: model.id,
      priority: index + 1,
    }))
    setModels(current => current.map(model => {
      const update = updates.find(item => item.id === model.id)
      return update ? { ...model, priority: update.priority } : model
    }).sort((left, right) => left.priority - right.priority))
    const results = await Promise.all(updates.map(update => upstreamModelApi.update(update.id, { priority: update.priority })))
    if (results.some(result => !result.success)) {
      toast.error('模型顺序保存失败，已恢复服务端数据')
      await reload()
    }
  }, [selectedModels, reload])

  return {
    // 状态
    providers,
    logicalModel,
    models,
    health,
    selectedProviderId,
    selectedProvider,
    selectedModels,
    loading,
    saving,
    // Provider dialog
    providerDialogOpen,
    setProviderDialogOpen,
    editingProviderId,
    providerName,
    apiKey,
    timeout,
    providerEndpointEntries,
    setProviderName,
    setApiKey,
    setTimeout,
    updateProviderEndpointEntry,
    openProviderDialog,
    closeProviderDialog,
    saveProvider,
    removeProvider,
    // Model dialog
    modelDialogOpen,
    setModelDialogOpen,
    editingModel,
    modelId,
    bindingEntries,
    setModelId,
    updateBindingEntry,
    openModelDialog,
    closeModelDialog,
    saveModel,
    removeModel,
    // 其他
    setSelectedProviderId,
    handleDragEnd,
    reload,
    // 常量
    PROTOCOL_OPTIONS,
  }
}
