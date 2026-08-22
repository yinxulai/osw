import { useCallback, useMemo } from 'react'
import { providerModelApi } from '@/api/models'
import { useToast } from '@/components/ui/toast'
import { useModelData } from './use-model-data'
import { useProviderDialog } from './use-provider-dialog'
import { useProviderManagement } from './use-provider-management'
import { useModelDialog } from './use-model-dialog'
import { useModelReordering } from './use-model-reordering'
import { PROTOCOL_OPTIONS } from '../lib/protocols'

export function useModelManagement() {
  const toast = useToast()
  const data = useModelData()
  const selectedProvider = useMemo(() => data.providers.find(provider => provider.id === data.selectedProviderId), [data.providers, data.selectedProviderId])
  const selectedModels = useMemo(() => data.models.filter(model => model.providerId === data.selectedProviderId).sort((a, b) => a.priority - b.priority), [data.models, data.selectedProviderId])
  const providerDialog = useProviderDialog({ reload: data.reload, selectProvider: data.setSelectedProviderId })
  const providerManagement = useProviderManagement({ reload: data.reload })
  const modelDialog = useModelDialog({ selectedProvider, models: data.models, reload: data.reload })

  const updateModelEnabled = useCallback(async (model: typeof data.models[number], enabled: boolean) => {
    const result = await providerModelApi.update(model.id, { logicalModelId: 'default', enabled })
    if (!result.success) { toast.error(result.errorMessage); await data.loadModels(); return }
    data.setModels(current => current.map(item => item.id === model.id ? { ...item, enabled } : item))
    toast.success(enabled ? '模型已启用' : '模型已停用')
  }, [data, toast])

  const removeModel = useCallback(async (model: typeof data.models[number]) => {
    if (!window.confirm(`删除模型"${model.modelName}"？该模型关联的所有协议接口都会被移除。`)) return
    const result = await providerModelApi.remove(model.id)
    if (!result.success) { toast.error(result.errorMessage); return }
    toast.success('模型已删除')
    await data.reload()
  }, [data.reload, toast])

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
    saving: providerDialog.savingProvider || modelDialog.savingModel,
    handleDragEnd,
    PROTOCOL_OPTIONS,
  }
}
