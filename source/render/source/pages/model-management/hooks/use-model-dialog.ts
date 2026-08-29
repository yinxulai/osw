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
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)

  const openModelDialog = useCallback((model?: ProviderModelRoute) => {
    setEditingModel(model ?? null)
    setModelId(model?.modelName ?? '')
    setFetchedModels([])
    setSelectedModelIds([])
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

  const toggleModelSelection = useCallback((id: string, checked: boolean) => {
    setSelectedModelIds(current => {
      if (checked) return current.includes(id) ? current : [...current, id]
      return current.filter(item => item !== id)
    })
  }, [])

  const selectAllFetchedModels = useCallback((ids: string[]) => {
    setSelectedModelIds(current => {
      const next = new Set(current)
      for (const id of ids) next.add(id)
      return [...next]
    })
  }, [])

  const invertFetchedModels = useCallback((ids: string[]) => {
    setSelectedModelIds(current => {
      const selected = new Set(current)
      for (const id of ids) {
        if (selected.has(id)) selected.delete(id)
        else selected.add(id)
      }
      return [...selected]
    })
  }, [])

  const clearSelectedModels = useCallback(() => {
    setSelectedModelIds([])
  }, [])

  const saveMutation = useMutation({ mutationFn: async () => {
    if (!selectedProvider) throw new Error('请先选择一个供应商')
    const enabledEntries = protocolEntries.filter(entry => entry.enabled)
    if (enabledEntries.length === 0) throw new Error('请填写模型并启用至少一个协议')
    const endpoints = enabledEntries.map(entry => ({ protocol: entry.protocol, endpointUrl: entry.overrideUrl ? entry.endpointUrl.trim() : '', customAuthHeader: null, protocolConversionEnabled: entry.protocolConversionEnabled }))
    if (editingModel) {
      if (!modelId.trim()) throw new Error('请填写模型并启用至少一个协议')
      await unwrap(providerModelApi.update(editingModel.id, { logicalModelId: 'default', modelName: modelId.trim(), endpoints }))
      return { createdCount: 0, skippedCount: 0, updated: true }
    }

    const existingNames = new Set(models.map(model => model.modelName))
    const targets = (selectedModelIds.length > 0 ? selectedModelIds : [modelId.trim()])
      .map(id => id.trim())
      .filter(Boolean)

    if (targets.length === 0) throw new Error('请填写模型并启用至少一个协议')

    let nextPriority = models.length ? Math.max(...models.map(model => model.priority)) + 1 : 1
    let createdCount = 0
    let skippedCount = 0

    for (const target of targets) {
      if (existingNames.has(target)) {
        skippedCount += 1
        continue
      }
      await unwrap(providerModelApi.create({ providerId: selectedProvider.id, modelName: target, endpoints, logicalModelId: 'default', priority: nextPriority }))
      existingNames.add(target)
      nextPriority += 1
      createdCount += 1
    }

    if (createdCount === 0) throw new Error('所选模型已存在，无需重复添加')
    return { createdCount, skippedCount, updated: false }
  }, onSuccess: async result => {
    setModelDialogOpen(false)
    if (result.updated) {
      toast.success('模型已更新')
    } else if (result.skippedCount > 0) {
      toast.success(`已添加 ${result.createdCount} 个模型，跳过 ${result.skippedCount} 个已存在模型`)
    } else {
      toast.success(result.createdCount > 1 ? `已批量添加 ${result.createdCount} 个模型` : '模型已添加')
    }
    await reload()
  }, onError: error => toast.error(error.message) })
  const saveModel = useCallback(async () => { await saveMutation.mutateAsync().catch(() => undefined) }, [saveMutation])
  return { modelDialogOpen, setModelDialogOpen, editingModel, modelId, protocolEntries, fetchedModels, selectedModelIds, fetchingModels, fetchModels, setModelId, toggleModelSelection, selectAllFetchedModels, invertFetchedModels, clearSelectedModels, updateProtocolEntry, openModelDialog, closeModelDialog, saveModel, savingModel: saveMutation.isPending }
}
