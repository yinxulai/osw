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
  const removeModelMutation = useMutation({ mutationFn: (id: string) => unwrap(providerModelApi.remove(id)), onSuccess: invalidateModels, onError: error => toast.error(error.message) })
  const updateModelEnabled = useCallback(async (model: typeof data.models[number], enabled: boolean) => {
    try { await updateModelMutation.mutateAsync({ id: model.id, enabled }); toast.success(enabled ? '模型已启用' : '模型已停用') } catch { /* handled by mutation */ }
  }, [updateModelMutation, toast])
  const removeModel = useCallback(async (model: typeof data.models[number]) => {
    if (!window.confirm(`删除模型"${model.modelName}"？该模型关联的所有协议接口都会被移除。`)) return
    try { await removeModelMutation.mutateAsync(model.id); toast.success('模型已删除') } catch { /* handled by mutation */ }
  }, [removeModelMutation, toast])

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
