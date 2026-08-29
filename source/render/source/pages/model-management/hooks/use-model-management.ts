import { useCallback, useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { providerModelApi } from '@/api/models'
import { unwrap } from '@/api/unwrap'
import { useToast } from '@/components/ui/toast'
import type { ProviderModelRoute } from '@common/schemas'
import { queueKeys } from '@/pages/queue-control/queries'
import { modelKeys } from './use-model-data'
import { useModelData } from './use-model-data'
import { useProviderDialog } from './use-provider-dialog'
import { useProviderManagement } from './use-provider-management'
import { useModelDialog } from './use-model-dialog'
import { useModelReordering } from './use-model-reordering'
import { PROTOCOL_OPTIONS } from '../lib/protocols'

type UpdateModelEnabledVariables = { id: string; enabled: boolean }

export function useModelManagement() {
  const toast = useToast()
  const client = useQueryClient()
  const data = useModelData()
  const selectedProvider = useMemo(() => data.providers.find(provider => provider.id === data.selectedProviderId), [data.providers, data.selectedProviderId])
  const selectedModels = useMemo(() => data.models.filter(model => model.providerId === data.selectedProviderId).sort((a, b) => a.priority - b.priority), [data.models, data.selectedProviderId])
  const providerDialog = useProviderDialog({ reload: data.reload, selectProvider: data.setSelectedProviderId })
  const providerManagement = useProviderManagement({ reload: data.reload })
  const modelDialog = useModelDialog({ selectedProvider, models: data.models, reload: data.reload })

  const invalidateModels = useCallback(async () => { await Promise.all([client.invalidateQueries({ queryKey: modelKeys.all }), client.invalidateQueries({ queryKey: queueKeys.models })]) }, [client])
  const updateModelMutation = useMutation({ mutationFn: ({ id, enabled }: UpdateModelEnabledVariables) => unwrap(providerModelApi.update(id, { logicalModelId: 'default', enabled })), onMutate: async ({ id, enabled }) => { await client.cancelQueries({ queryKey: modelKeys.all }); const previous = client.getQueryData<ProviderModelRoute[]>(modelKeys.all); client.setQueryData<ProviderModelRoute[]>(modelKeys.all, current => current?.map(model => model.id === id ? { ...model, enabled } : model)); return { previous } }, onError: (error, _variables, context) => { client.setQueryData(modelKeys.all, context?.previous); toast.error(error.message) }, onSettled: invalidateModels })
  const removeModelMutation = useMutation({ mutationFn: (id: string) => unwrap(providerModelApi.remove(id)), onError: error => toast.error(error.message) })
  const updateModelEnabled = useCallback(async (model: typeof data.models[number], enabled: boolean) => {
    try { await updateModelMutation.mutateAsync({ id: model.id, enabled }); toast.success(enabled ? '模型已启用' : '模型已停用') } catch { /* handled by mutation */ }
  }, [updateModelMutation, toast])
  const removeModel = useCallback(async (model: typeof data.models[number]) => {
    if (!window.confirm(`删除模型"${model.modelName}"？该模型关联的所有协议接口都会被移除。`)) return
    try {
      await removeModelMutation.mutateAsync(model.id)
      await invalidateModels()
      toast.success('模型已删除')
    } catch { /* handled by mutation */ }
  }, [invalidateModels, removeModelMutation, toast])

  const removeModels = useCallback(async (modelsToRemove: typeof data.models) => {
    if (modelsToRemove.length === 0) return false
    const count = modelsToRemove.length
    const confirmed = window.confirm(`删除选中的 ${count} 个模型？该批模型关联的所有协议接口都会被移除。`)
    if (!confirmed) return false

    const results = await Promise.allSettled(modelsToRemove.map(model => removeModelMutation.mutateAsync(model.id)))
    const successCount = results.filter(result => result.status === 'fulfilled').length
    const failedCount = results.length - successCount

    if (successCount > 0) {
      await invalidateModels()
      toast.success(failedCount > 0 ? `已删除 ${successCount} 个模型，${failedCount} 个删除失败` : `已删除 ${successCount} 个模型`)
      return true
    }

    toast.error('批量删除失败，请稍后重试')
    return false
  }, [invalidateModels, removeModelMutation, toast])

  const disableModels = useCallback(async (modelsToDisable: typeof data.models) => {
    if (modelsToDisable.length === 0) return false
    const enabledModels = modelsToDisable.filter(model => model.enabled)
    if (enabledModels.length === 0) {
      toast.success('所选模型已是停用状态')
      return true
    }

    const results = await Promise.allSettled(enabledModels.map(model => updateModelMutation.mutateAsync({ id: model.id, enabled: false })))
    const successCount = results.filter(result => result.status === 'fulfilled').length
    const failedCount = results.length - successCount

    if (successCount > 0) {
      await invalidateModels()
      toast.success(failedCount > 0 ? `已禁用 ${successCount} 个模型，${failedCount} 个失败` : `已禁用 ${successCount} 个模型`)
      return true
    }

    toast.error('批量禁用失败，请稍后重试')
    return false
  }, [invalidateModels, toast, updateModelMutation])

  const handleDragEnd = useModelReordering(selectedModels, data.setModels, data.reload)

  return {
    ...data,
    selectedProvider,
    selectedModels,
    ...providerDialog,
    ...providerManagement,
    ...modelDialog,
    updateModelEnabled,
    removeModel,
    removeModels,
    disableModels,
    saving: providerDialog.savingProvider || modelDialog.savingModel,
    handleDragEnd,
    PROTOCOL_OPTIONS,
  }
}
