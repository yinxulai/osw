import { useCallback, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { providerApi } from '@/api/providers'
import { providerModelApi } from '@/api/models'
import { unwrap } from '@/api/unwrap'
import { useToast } from '@/components/ui/toast'
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
        ? { protocol: option.value, enabled: true, overrideUrl: Boolean(match.endpointUrl.trim()), endpointUrl: match.endpointUrl, protocolConversionEnabled: match.protocolConversionEnabled ?? false }
        : { protocol: option.value, enabled: false, overrideUrl: false, endpointUrl: '', protocolConversionEnabled: false }
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
          endpointUrl: '',
          protocolConversionEnabled: false,
        }))
    setFetchingModels(true)
    try {
      const results = await Promise.all(sourceEntries.map(entry => providerApi.fetchModels({
        protocol: entry.protocol,
        providerId: selectedProvider.id,
        ...(entry.overrideUrl && entry.endpointUrl.trim() ? { baseUrl: entry.endpointUrl.trim() } : {}),
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

  const saveMutation = useMutation({ mutationFn: async () => {
    if (!selectedProvider) throw new Error('请先选择一个供应商')
    const enabledEntries = protocolEntries.filter(entry => entry.enabled)
    if (!modelId.trim() || enabledEntries.length === 0) throw new Error('请填写模型并启用至少一个协议')
    const endpoints = enabledEntries.map(entry => ({ protocol: entry.protocol, endpointUrl: entry.overrideUrl ? entry.endpointUrl.trim() : '', customAuthHeader: null, protocolConversionEnabled: entry.protocolConversionEnabled }))
    const priority = editingModel ? editingModel.priority : (models.length ? Math.max(...models.map(model => model.priority)) + 1 : 1)
    return editingModel ? unwrap(providerModelApi.update(editingModel.id, { logicalModelId: 'default', modelName: modelId.trim(), endpoints })) : unwrap(providerModelApi.create({ providerId: selectedProvider.id, modelName: modelId.trim(), endpoints, logicalModelId: 'default', priority }))
  }, onSuccess: async () => { setModelDialogOpen(false); toast.success(editingModel ? '模型已更新' : '模型已添加'); await reload() }, onError: error => toast.error(error.message) })
  const saveModel = useCallback(async () => { await saveMutation.mutateAsync().catch(() => undefined) }, [saveMutation])
  return { modelDialogOpen, setModelDialogOpen, editingModel, modelId, protocolEntries, fetchedModels, fetchingModels, fetchModels, setModelId, updateProtocolEntry, openModelDialog, closeModelDialog, saveModel, savingModel: saveMutation.isPending }
}
