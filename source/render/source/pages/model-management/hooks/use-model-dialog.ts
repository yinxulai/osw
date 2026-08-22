import { useCallback, useState } from 'react'
import { providerApi } from '@/api/providers'
import { providerModelApi } from '@/api/models'
import { useToast } from '@/components/ui/toast'
import { useAsyncFn } from '@/services/use-async'
import type { FetchedProviderModel } from '@/api/providers'
import type { ProviderModelRoute } from '@common/schemas'
import { PROTOCOL_OPTIONS } from '../lib/protocols'
import type { ProtocolEndpointEntry } from './types'

interface UseModelDialogOptions {
  selectedProvider: { id: string } | undefined
  models: ProviderModelRoute[]
  reload: () => Promise<void>
}

export function useModelDialog(options: UseModelDialogOptions) {
  const { selectedProvider, models, reload } = options
  const toast = useToast()
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<ProviderModelRoute | null>(null)
  const [modelId, setModelId] = useState('')
  const [protocolEntries, setProtocolEntries] = useState<ProtocolEndpointEntry[]>([])
  const [fetchedModels, setFetchedModels] = useState<FetchedProviderModel[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)

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

  const closeModelDialog = useCallback(() => setModelDialogOpen(false), [])

  const fetchModels = useCallback(async () => {
    if (!selectedProvider) return
    const enabledEntries = protocolEntries.filter(entry => entry.enabled)
    const sourceEntries: ProtocolEndpointEntry[] = enabledEntries.length > 0
      ? enabledEntries
      : PROTOCOL_OPTIONS.map(option => ({
          protocol: option.value,
          enabled: true,
          overrideUrl: false,
          upstreamUrl: '',
          protocolConversionEnabled: false,
        }))
    setFetchingModels(true)
    try {
      const results = await Promise.all(sourceEntries.map(entry => providerApi.fetchModels({
        protocol: entry.protocol,
        providerId: selectedProvider.id,
        ...(entry.overrideUrl && entry.upstreamUrl.trim() ? { baseUrl: entry.upstreamUrl.trim() } : {}),
      })))
      const merged = new Map<string, FetchedProviderModel>()
      for (const result of results) {
        if (!result.success) continue
        for (const model of result.data.models) if (!merged.has(model.id)) merged.set(model.id, model)
      }
      if (merged.size === 0) { toast.error('上游未返回可用模型，请检查地址和 API Key'); return }
      setFetchedModels([...merged.values()].sort((a, b) => a.id.localeCompare(b.id)))
    } finally { setFetchingModels(false) }
  }, [protocolEntries, selectedProvider, toast])

  const updateProtocolEntry = useCallback((index: number, patch: Partial<ProtocolEndpointEntry>) => {
    setProtocolEntries(current => current.map((entry, i) => i === index ? { ...entry, ...patch } : entry))
  }, [])

  const saveModel = useCallback(async () => {
    if (!selectedProvider) { toast.error('请先选择一个供应商'); return }
    if (!modelId.trim()) return
    const enabledEntries = protocolEntries.filter(entry => entry.enabled)
    if (enabledEntries.length === 0) return
    const endpoints = enabledEntries.map(entry => ({
      protocol: entry.protocol,
      upstreamUrl: entry.overrideUrl ? entry.upstreamUrl.trim() : '',
      customAuthHeader: null,
      protocolConversionEnabled: entry.protocolConversionEnabled,
    }))
    const priority = editingModel ? editingModel.priority : (models.length ? Math.max(...models.map(model => model.priority)) + 1 : 1)
    const result = editingModel
      ? await providerModelApi.update(editingModel.id, { logicalModelId: 'default', modelName: modelId.trim(), endpoints })
      : await providerModelApi.create({ providerId: selectedProvider.id, modelName: modelId.trim(), endpoints, logicalModelId: 'default', priority })
    if (!result.success) { toast.error(result.errorMessage); await reload(); return }
    setModelDialogOpen(false)
    toast.success(editingModel ? '模型已更新' : '模型已添加')
    await reload()
  }, [editingModel, modelId, models, protocolEntries, reload, selectedProvider, toast])

  const { loading: savingModel, run: runSaveModel } = useAsyncFn(saveModel)
  return { modelDialogOpen, setModelDialogOpen, editingModel, modelId, protocolEntries, fetchedModels, fetchingModels, fetchModels, setModelId, updateProtocolEntry, openModelDialog, closeModelDialog, saveModel: runSaveModel, savingModel }
}
