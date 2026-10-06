import { useCallback, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { providerApi } from '@/api/providers'
import { providerModelApi } from '@/api/models'
import { unwrap } from '@/api/unwrap'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import type { FetchedProviderModel } from '@/api/providers'
import type { Provider, ProviderModelRoute } from '@common/schemas'
import { PROTOCOL_OPTIONS } from '../lib/protocols'
import type { ProtocolEndpointEntry } from './types'

interface UseModelDialogOptions {
  providers: Provider[]
  models: ProviderModelRoute[]
  selectedProvider: { id: string } | undefined
  reload: () => Promise<void>
}

export function useModelDialog(options: UseModelDialogOptions) {
  const { providers, models, selectedProvider, reload } = options
  const toast = useToast()
  const t = useTranslation()
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<ProviderModelRoute | null>(null)
  // 对话框自己记着「这次给哪个供应商加模型」，而不是看侧栏选中的那一个：
  // 从某个供应商行上直接点「添加模型」时，目标就是那一行，跟当前选中谁无关。
  const [dialogProviderId, setDialogProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [protocolEntries, setProtocolEntries] = useState<ProtocolEndpointEntry[]>([])
  const [fetchedModels, setFetchedModels] = useState<FetchedProviderModel[]>([])
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)

  const dialogProvider = useMemo(() => providers.find(provider => provider.id === dialogProviderId), [providers, dialogProviderId])
  const dialogModels = useMemo(() => models.filter(model => model.providerId === dialogProviderId).sort((a, b) => a.priority - b.priority), [models, dialogProviderId])
  const selectDialogProvider = useCallback((providerId: string) => setDialogProviderId(providerId), [])

  const openModelDialog = useCallback((model?: ProviderModelRoute, providerId?: string) => {
    setEditingModel(model ?? null)
    setDialogProviderId(model?.providerId ?? providerId ?? selectedProvider?.id ?? '')
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
  }, [selectedProvider])

  const closeModelDialog = useCallback(() => setModelDialogOpen(false), [])

  const fetchModels = useCallback(async () => {
    if (!dialogProvider) return
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
        providerId: dialogProvider.id,
        ...(entry.overrideUrl && entry.endpointUrl.trim() ? { baseUrl: entry.endpointUrl.trim() } : {}),
      })))
      const merged = new Map<string, FetchedProviderModel>()
      for (const result of results) {
        if (!result.success) continue
        for (const model of result.data.models) if (!merged.has(model.id)) merged.set(model.id, model)
      }
      if (merged.size === 0) { toast.error(t('models.toast.fetchEmpty')); return }
      setFetchedModels([...merged.values()].sort((a, b) => a.id.localeCompare(b.id)))
    } finally { setFetchingModels(false) }
  }, [protocolEntries, dialogProvider, toast, t])

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
    if (!dialogProvider) throw new Error(t('models.error.providerRequired'))
    const enabledEntries = protocolEntries.filter(entry => entry.enabled)
    if (enabledEntries.length === 0) throw new Error(t('models.error.modelRequired'))
    const endpoints = enabledEntries.map(entry => ({ protocol: entry.protocol, endpointUrl: entry.overrideUrl ? entry.endpointUrl.trim() : '', customAuthHeader: null, protocolConversionEnabled: entry.protocolConversionEnabled }))
    if (editingModel) {
      if (!modelId.trim()) throw new Error(t('models.error.modelRequired'))
      // 不传 `logicalModelId`：改模型名与端点跟调度绑定无关，绑定落点由服务端按默认记录 id 解析。
      // 传 `'default'` 会把**模型名**当成外键写进 `scheduling_policies.logicalModelId` 而撞 FK。
      await unwrap(providerModelApi.update(editingModel.id, { modelName: modelId.trim(), endpoints }))
      return { createdCount: 0, skippedCount: 0, updated: true }
    }

    const existingNames = new Set(dialogModels.map(model => model.modelName))
    const targets = (selectedModelIds.length > 0 ? selectedModelIds : [modelId.trim()])
      .map(id => id.trim())
      .filter(Boolean)

    if (targets.length === 0) throw new Error(t('models.error.modelRequired'))

    let nextPriority = dialogModels.length ? Math.max(...dialogModels.map(model => model.priority)) + 1 : 1
    let createdCount = 0
    let skippedCount = 0

    for (const target of targets) {
      if (existingNames.has(target)) {
        skippedCount += 1
        continue
      }
      // 不传 `logicalModelId`：服务端把新绑定挂到内建默认逻辑模型上，它的数据记录 id 是本机生成的，
      // 界面拿不到也不该关心。传 `'default'`（那是模型名）会撞 `scheduling_policies` 的外键。
      await unwrap(providerModelApi.create({ providerId: dialogProvider.id, modelName: target, endpoints, priority: nextPriority }))
      existingNames.add(target)
      nextPriority += 1
      createdCount += 1
    }

    if (createdCount === 0) throw new Error(t('models.error.duplicate'))
    return { createdCount, skippedCount, updated: false }
  }, onSuccess: async result => {
    setModelDialogOpen(false)
    if (result.updated) {
      toast.success(t('models.toast.updated'))
    } else if (result.skippedCount > 0) {
      toast.success(t('models.toast.addedSome', { created: result.createdCount, skipped: result.skippedCount }))
    } else {
      toast.success(result.createdCount > 1 ? t('models.toast.addedBulk', { count: result.createdCount }) : t('models.toast.added'))
    }
    await reload()
  }, onError: error => toast.error(error.message) })
  const saveModel = useCallback(async () => { await saveMutation.mutateAsync().catch(() => undefined) }, [saveMutation])
  return { modelDialogOpen, setModelDialogOpen, editingModel, dialogProvider, modelId, protocolEntries, fetchedModels, selectedModelIds, fetchingModels, fetchModels, setModelId, toggleModelSelection, selectAllFetchedModels, invertFetchedModels, clearSelectedModels, updateProtocolEntry, openModelDialog, selectDialogProvider, closeModelDialog, saveModel, savingModel: saveMutation.isPending }
}
