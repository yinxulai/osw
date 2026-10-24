import { useCallback, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { providerApi } from '@/api/providers'
import { logicalModelApi, providerModelApi } from '@/api/models'
import { unwrap } from '@/api/unwrap'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import type { FetchedProviderModel } from '@/api/providers'
import { isBuiltInDefaultLogicalModel, type Provider, type ProviderModelRoute } from '@common/schemas'
import { PROTOCOL_OPTIONS } from '../lib/protocols'
import { useModelConnectivityTest } from './use-model-connectivity-test'
import type { ProtocolEndpointEntry } from './types'

/**
 * 新模型绑到内建默认逻辑模型时，调度优先级接在已有绑定的最大值之后。
 *
 * 模型管理页把每条模型的 `priority` 投影成 0：那一页不排调度顺序。用这个占位值取
 * `max + 1` 得到的永远是 1，新绑定就插进已经排成 1、2、3… 的故障转移顺序里。
 * 服务端会把没指名落点的新模型绑到默认逻辑模型上，所以这里读的是那一份绑定
 * （含其他供应商）的真实优先级。没有绑定，或还没有默认逻辑模型时，从 1 起。
 * 逻辑模型页追加用的是「当前条数 + 1」；拖拽会把优先级重写成从 1 起的连续序号，
 * 那时两者相同。按最大值计算，删掉中间绑定留下的空档也不会把新模型插回去。
 */
async function loadNextBindingPriority(): Promise<number> {
  const logicalModels = await unwrap(logicalModelApi.list())
  const fallback = logicalModels.find(isBuiltInDefaultLogicalModel)
  if (!fallback) return 1
  const bound = await unwrap(providerModelApi.listByLogicalModel(fallback.id))
  if (bound.length === 0) return 1
  return Math.max(...bound.map(model => model.priority)) + 1
}

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
  const [modelId, setModelIdState] = useState('')
  const [protocolEntries, setProtocolEntries] = useState<ProtocolEndpointEntry[]>([])
  const [fetchedModels, setFetchedModels] = useState<FetchedProviderModel[]>([])
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const connectivityTest = useModelConnectivityTest()
  const { run: runTest, reset: resetTest } = connectivityTest

  const dialogProvider = useMemo(() => providers.find(provider => provider.id === dialogProviderId), [providers, dialogProviderId])
  const dialogModels = useMemo(() => models.filter(model => model.providerId === dialogProviderId).sort((a, b) => a.priority - b.priority), [models, dialogProviderId])
  const selectDialogProvider = useCallback((providerId: string) => setDialogProviderId(providerId), [])

  const openModelDialog = useCallback((model?: ProviderModelRoute, providerId?: string) => {
    setEditingModel(model ?? null)
    resetTest()
    setDialogProviderId(model?.providerId ?? providerId ?? selectedProvider?.id ?? '')
    setModelIdState(model?.modelName ?? '')
    setFetchedModels([])
    setSelectedModelIds([])
    setProtocolEntries(PROTOCOL_OPTIONS.map(option => {
      const match = model?.endpoints.find(endpoint => endpoint.protocol === option.value)
      return match
        ? { protocol: option.value, enabled: true, overrideUrl: Boolean(match.endpointUrl.trim()), endpointUrl: match.endpointUrl, protocolConversionEnabled: match.protocolConversionEnabled ?? false }
        : { protocol: option.value, enabled: false, overrideUrl: false, endpointUrl: '', protocolConversionEnabled: false }
    }))
    setModelDialogOpen(true)
  }, [selectedProvider, resetTest])

  // 关掉对话框顺手把探测结果丢掉：下一次打开多半是另一个供应商、另一个模型，
  // 留着上一轮那几行只会让人以为刚才是这一次的结果。
  const closeModelDialog = useCallback(() => {
    resetTest()
    setModelDialogOpen(false)
  }, [resetTest])

  // 探测结果记的是「当时那份表单值通不通」。模型名或端点一变，那份值就没了，
  // 继续摆着旧结果等于在回答一个已经没人问的问题。
  const setModelId = useCallback((value: string) => {
    resetTest()
    setModelIdState(value)
  }, [resetTest])

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
    resetTest()
    setProtocolEntries(current => current.map((entry, i) => i === index ? { ...entry, ...patch } : entry))
  }, [resetTest])

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

    let nextPriority = await loadNextBindingPriority()
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
    resetTest()
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

  // 测什么由表单当前的样子决定，不由上一次点击决定：勾了没勾、覆盖地址写了什么，
  // 都在 `protocolEntries` 里，直接从中挑出启用的那几行去测。
  const testConnectivity = useCallback(async () => {
    if (!dialogProvider) return
    const enabledEntries = protocolEntries.filter(entry => entry.enabled)
    if (enabledEntries.length === 0) return
    await runTest(dialogProvider.id, modelId.trim(), enabledEntries.map(entry => ({
      protocol: entry.protocol,
      endpointUrl: entry.overrideUrl ? entry.endpointUrl.trim() : '',
    })))
  }, [dialogProvider, protocolEntries, modelId, runTest])

  return { modelDialogOpen, setModelDialogOpen, editingModel, dialogProvider, modelId, protocolEntries, fetchedModels, selectedModelIds, fetchingModels, fetchModels, setModelId, toggleModelSelection, selectAllFetchedModels, invertFetchedModels, clearSelectedModels, updateProtocolEntry, openModelDialog, selectDialogProvider, closeModelDialog, saveModel, savingModel: saveMutation.isPending, connectivityTest, testConnectivity }
}
