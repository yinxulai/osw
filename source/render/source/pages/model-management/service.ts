import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEndEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { providerModelApi, providerApi } from '@/api'
import type { FetchedProviderModel } from '@/api'
import { useToast } from '@/components/ui/toast'
import { useAsyncFn } from '@/services/use-async'
import {
  useProviders,
  useProvidersLoading,
  useHealth,
  useAppPolling,
  useAppActions,
} from '@/services/app-hooks'
import type { ProviderModelRoute, Protocol, ProviderModelRouteEndpoint, Provider } from '@common/schemas'
import { PROTOCOL_OPTIONS } from './lib/protocols'
import type { ProviderPreset } from './lib/provider-presets'

export interface ProtocolEndpointEntry {
  protocol: Protocol
  enabled: boolean
  overrideUrl: boolean
  upstreamUrl: string
  protocolConversionEnabled: boolean
}

export interface ProviderEndpointEntry {
  protocol: Protocol
  enabled: boolean
  url: string
}

type ProviderEndpoints = Partial<Record<Protocol, string>>

export function getEffectiveEndpointUrl(endpoint: ProviderModelRouteEndpoint): string {
  return endpoint.upstreamUrl.trim()
}

export function useModelManagementService() {
  const toast = useToast()
  const appActions = useAppActions()

  // 全局共享状态
  const providers = useProviders()
  const health = useHealth()
  const providersLoading = useProvidersLoading()

  // 本页状态
  const [models, setModels] = useState<ProviderModelRoute[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [loading, setLoading] = useState(true)
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
  const [editingModel, setEditingModel] = useState<ProviderModelRoute | null>(null)
  const [modelId, setModelId] = useState('')
  const [protocolEntries, setProtocolEntries] = useState<ProtocolEndpointEntry[]>([])
  const [fetchedModels, setFetchedModels] = useState<FetchedProviderModel[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)

  // 订阅全局轮询
  useAppPolling('health', 5000)
  useAppPolling('providers', 10000)

  const loadModels = useCallback(async () => {
    const result = await providerModelApi.list()
    if (!result.success) {
      toast.error(result.errorMessage)
      await loadModels()
      return
    }
    setModels(result.data.map(model => ({
      id: model.id,
      providerId: model.providerId,
      modelName: model.modelName,
      endpoints: model.endpoints.map(endpoint => ({
        protocol: endpoint.protocol,
        upstreamUrl: endpoint.url ?? '',
        customAuthHeader: null,
        protocolConversionEnabled: endpoint.conversions.some(conversion => conversion.enabled),
      })),
      priority: 0,
      enabled: model.enabled,
      createdTime: model.createdTime,
      updatedTime: model.updatedTime,
      deletedTime: model.deletedTime,
    })))
  }, [toast])

  /** 写操作后刷新：静默刷新全局数据 + 重新加载本页模型列表 */
  const reload = useCallback(async () => {
    appActions.invalidateProviders()
    appActions.invalidateHealth()
    await loadModels()
  }, [appActions, loadModels])

  // 当全局数据首次加载完成后，初始化本页数据
  useEffect(() => {
    if (initializedRef.current) return
    if (providersLoading) return

    initializedRef.current = true
    void loadModels()
    setSelectedProviderId(providers[0]?.id ?? '')
    setLoading(false)
  }, [providersLoading, providers, loadModels])

  const selectedProvider = useMemo(
    () => providers.find(provider => provider.id === selectedProviderId),
    [providers, selectedProviderId],
  )

  // 切换供应商后，之前获取到的远端模型列表不再适用，清空避免误用
  useEffect(() => {
    setFetchedModels([])
  }, [selectedProviderId])

  const selectedModels = useMemo(
    () => models
      .filter(model => model.providerId === selectedProviderId)
      .sort((a, b) => a.priority - b.priority),
    [models, selectedProviderId],
  )

  // ========== Provider CRUD ==========

  const openProviderDialog = useCallback(async (provider?: Provider) => {
    let endpoints: ProviderEndpoints = {}
    if (provider) {
      const result = await providerApi.endpoints(provider.id)
      if (!result.success) {
        toast.error(result.errorMessage)
        return
      }
      endpoints = Object.fromEntries(result.data.filter(endpoint => endpoint.enabled).map(endpoint => [endpoint.protocol, endpoint.url]))
    }
    setEditingProviderId(provider?.id ?? null)
    setProviderName(provider?.name ?? '')
    setApiKey('')
    setTimeout(String(provider?.timeoutMilliseconds ?? 30000))
    setProviderEndpointEntries(
      PROTOCOL_OPTIONS.map(option => {
        const url = endpoints[option.value] ?? ''
        return { protocol: option.value, enabled: Boolean(url), url }
      }),
    )
    setProviderDialogOpen(true)
  }, [toast])

  const closeProviderDialog = useCallback(() => {
    setProviderDialogOpen(false)
  }, [])

  const applyPreset = useCallback((preset: ProviderPreset) => {
    setProviderName(preset.name)
    setProviderEndpointEntries(
      PROTOCOL_OPTIONS.map(option => {
        const url = preset.endpoints[option.value] ?? ''
        return { protocol: option.value, enabled: Boolean(url), url }
      }),
    )
  }, [])

  const updateProviderEndpointEntry = useCallback((index: number, patch: Partial<ProviderEndpointEntry>) => {
    setProviderEndpointEntries(current => current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)))
  }, [])

  const saveProvider = useCallback(async () => {
    if (!providerName.trim()) return
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
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          timeoutMilliseconds: Number(timeout),
          endpoints,
        })
    if (!result.success) { toast.error(result.errorMessage); return }
    setProviderDialogOpen(false)
    setSelectedProviderId(result.data.id)
    toast.success(editingProviderId ? '供应商已更新' : '供应商已添加')
    await reload()
  }, [providerName, apiKey, timeout, editingProviderId, providerEndpointEntries, reload])

  const { loading: savingProvider, run: runSaveProvider } = useAsyncFn(saveProvider)

  const removeProvider = useCallback(async (provider: Provider) => {
    if (!window.confirm(`删除供应商"${provider.name}"？关联模型将被禁用。`)) return
    const result = await providerApi.remove(provider.id)
    if (!result.success) { toast.error(result.errorMessage); return }
    toast.success('供应商已删除')
    await reload()
  }, [reload])

  const updateProviderEnabled = useCallback(async (provider: Provider, enabled: boolean) => {
    const result = await providerApi.update(provider.id, { enabled })
    if (!result.success) {
      toast.error(result.errorMessage)
      return
    }
    toast.success(enabled ? '供应商已启用' : '供应商已停用')
    await reload()
  }, [reload, toast])

  // ========== Model CRUD ==========

  const openModelDialog = useCallback((model?: ProviderModelRoute) => {
    setEditingModel(model ?? null)
    setModelId(model?.modelName ?? '')
    setFetchedModels([])
    setProtocolEntries(PROTOCOL_OPTIONS.map(option => {
      const match = model?.endpoints.find(endpoint => endpoint.protocol === option.value)
      return match
        ? { protocol: option.value, enabled: true, overrideUrl: Boolean(match.upstreamUrl.trim()), upstreamUrl: match.upstreamUrl, protocolConversionEnabled: match.protocolConversionEnabled ?? false }
        : { protocol: option.value, enabled: false, overrideUrl: false, upstreamUrl: '', protocolConversionEnabled: false }
    }))
    setModelDialogOpen(true)
  }, [])

  const closeModelDialog = useCallback(() => {
    setModelDialogOpen(false)
  }, [])

  const fetchModels = useCallback(async () => {
    if (!selectedProvider) return
    const enabledEntries: ProtocolEndpointEntry[] = protocolEntries.filter(entry => entry.enabled)
    const sourceEntries = enabledEntries.length > 0 ? enabledEntries : PROTOCOL_OPTIONS

    const requests = sourceEntries
      .map(entry => {
        const protocol = 'value' in entry ? entry.value : entry.protocol
        const overrideUrl = 'overrideUrl' in entry && entry.overrideUrl ? entry.upstreamUrl.trim() : ''
        return {
          protocol,
          ...(overrideUrl ? { baseUrl: overrideUrl } : {}),
        }
      })

    setFetchingModels(true)
    try {
      const results = await Promise.all(requests.map(request => providerApi.fetchModels({
        protocol: request.protocol,
        providerId: selectedProvider.id,
        baseUrl: request.baseUrl,
      })))
      const merged = new Map<string, FetchedProviderModel>()
      for (const result of results) {
        if (!result.success) continue
        for (const model of result.data.models) if (!merged.has(model.id)) merged.set(model.id, model)
      }
      if (merged.size === 0) {
        toast.error('上游未返回可用模型，请检查地址和 API Key')
        return
      }
      setFetchedModels([...merged.values()].sort((a, b) => a.id.localeCompare(b.id)))
    } finally {
      setFetchingModels(false)
    }
  }, [protocolEntries, selectedProvider, toast])

  const updateProtocolEntry = useCallback((index: number, patch: Partial<ProtocolEndpointEntry>) => {
    setProtocolEntries(current => current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)))
  }, [])

  const saveModel = useCallback(async () => {
    if (!selectedProvider) {
      toast.error('请先选择一个供应商')
      return
    }
    if (!modelId.trim()) return
    const enabledEntries = protocolEntries.filter(entry => entry.enabled)
    if (enabledEntries.length === 0) return

    const endpoints: ProviderModelRouteEndpoint[] = enabledEntries.map(entry => ({
      protocol: entry.protocol,
      upstreamUrl: entry.overrideUrl ? entry.upstreamUrl.trim() : '',
      customAuthHeader: null,
      protocolConversionEnabled: entry.protocolConversionEnabled,
    }))

    const basePriority = editingModel
      ? editingModel.priority
      : models.length === 0
        ? 1
        : Math.max(...models.map(model => model.priority)) + 1

    const result = editingModel
      ? await providerModelApi.update(editingModel.id, {
          logicalModelId: 'default',
          modelName: modelId.trim(),
          endpoints,
        })
      : await providerModelApi.create({
          providerId: selectedProvider.id,
          modelName: modelId.trim(),
          endpoints,
          logicalModelId: 'default',
          priority: basePriority,
        })

    if (!result.success) {
      toast.error(result.errorMessage)
      await reload()
      return
    }
    setModelDialogOpen(false)
    toast.success(editingModel ? '模型已更新' : '模型已添加')
    await reload()
  }, [selectedProvider, modelId, protocolEntries, editingModel, models, reload])

  const { loading: savingModel, run: runSaveModel } = useAsyncFn(saveModel)

  const removeModel = useCallback(async (model: ProviderModelRoute) => {
    if (!window.confirm(`删除模型"${model.modelName}"？该模型关联的所有协议接口都会被移除。`)) return
    const result = await providerModelApi.remove(model.id)
    if (!result.success) { toast.error(result.errorMessage); return }
    toast.success('模型已删除')
    await reload()
  }, [reload])

  const updateModelEnabled = useCallback(async (model: ProviderModelRoute, enabled: boolean) => {
    const result = await providerModelApi.update(model.id, {
      logicalModelId: 'default',
      enabled,
    })
    if (!result.success) {
      toast.error(result.errorMessage)
      await loadModels()
      return
    }
    setModels(current => current.map(item => item.id === model.id ? { ...item, enabled } : item))
    toast.success(enabled ? '模型已启用' : '模型已停用')
  }, [loadModels, toast])

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
    const results = await Promise.all(updates.map(update => providerModelApi.update(update.id, { logicalModelId: 'default', priority: update.priority })))
    if (results.some(result => !result.success)) {
      toast.error('模型顺序保存失败，已恢复服务端数据')
      await reload()
    }
  }, [selectedModels, reload])

  return {
    // 状态
    providers,
    models,
    health,
    selectedProviderId,
    selectedProvider,
    selectedModels,
    loading,
    saving: savingProvider || savingModel,
    // Model dialog: fetched provider models
    fetchedModels,
    fetchingModels,
    fetchModels,
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
    applyPreset,
    saveProvider: runSaveProvider,
    removeProvider,
    updateProviderEnabled,
    // Model dialog
    modelDialogOpen,
    setModelDialogOpen,
    editingModel,
    modelId,
    protocolEntries,
    setModelId,
    updateProtocolEntry,
    openModelDialog,
    closeModelDialog,
    saveModel: runSaveModel,
    removeModel,
    updateModelEnabled,
    // 其他
    setSelectedProviderId,
    handleDragEnd,
    reload,
    // 常量
    PROTOCOL_OPTIONS,
  }
}
