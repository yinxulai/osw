import { useCallback, useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { providerModelApi } from '@/api/models'
import { unwrap } from '@/api/unwrap'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import type { ProviderModelRoute } from '@common/schemas'
import { modelKeys } from './use-model-data'
import { useModelData } from './use-model-data'
import { useProviderDialog } from './use-provider-dialog'
import { useProviderManagement } from './use-provider-management'
import { useModelDialog } from './use-model-dialog'
import { useModelReordering } from './use-model-reordering'
import { useProviderTransfer } from './use-provider-transfer'
import { PROTOCOL_OPTIONS } from '../lib/protocols'

type UpdateModelEnabledVariables = { id: string; enabled: boolean }

export function useModelManagement() {
  const toast = useToast()
  const confirm = useConfirm()
  const t = useTranslation()
  const client = useQueryClient()
  const data = useModelData()
  const selectedProvider = useMemo(() => data.providers.find(provider => provider.id === data.selectedProviderId), [data.providers, data.selectedProviderId])
  const selectedModels = useMemo(() => data.models.filter(model => model.providerId === data.selectedProviderId).sort((a, b) => a.priority - b.priority), [data.models, data.selectedProviderId])
  const providerDialog = useProviderDialog({ reload: data.reload, selectProvider: data.setSelectedProviderId })
  const providerManagement = useProviderManagement({ reload: data.reload })
  const modelDialog = useModelDialog({ providers: data.providers, models: data.models, selectedProvider, reload: data.reload })
  const providerTransfer = useProviderTransfer({ reload: data.reload })

  const invalidateModels = useCallback(async () => { await Promise.all([client.invalidateQueries({ queryKey: modelKeys.all }), client.invalidateQueries({ queryKey: ['logical-model-provider-models'] })]) }, [client])
  const updateModelMutation = useMutation({ mutationFn: ({ id, enabled }: UpdateModelEnabledVariables) => unwrap(providerModelApi.update(id, { logicalModelId: 'default', enabled })), onMutate: async ({ id, enabled }) => { await client.cancelQueries({ queryKey: modelKeys.all }); const previous = client.getQueryData<ProviderModelRoute[]>(modelKeys.all); client.setQueryData<ProviderModelRoute[]>(modelKeys.all, current => current?.map(model => model.id === id ? { ...model, enabled } : model)); return { previous } }, onError: (error, _variables, context) => { client.setQueryData(modelKeys.all, context?.previous); toast.error(error.message) }, onSettled: invalidateModels })
  const removeModelMutation = useMutation({ mutationFn: (id: string) => unwrap(providerModelApi.remove(id)), onError: error => toast.error(error.message) })
  const updateModelEnabled = useCallback(async (model: typeof data.models[number], enabled: boolean) => {
    try { await updateModelMutation.mutateAsync({ id: model.id, enabled }); toast.success(enabled ? t('models.toast.enabled') : t('models.toast.disabled')) } catch { /* handled by mutation */ }
  }, [updateModelMutation, toast, t])
  const removeModel = useCallback(async (model: typeof data.models[number]) => {
    const confirmed = await confirm({
      title: t('models.delete.title', { name: model.modelName }),
      description: t('models.delete.description'),
      confirmLabel: t('models.row.delete'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await removeModelMutation.mutateAsync(model.id)
      await invalidateModels()
      toast.success(t('models.toast.deleted'))
    } catch { /* handled by mutation */ }
  }, [confirm, invalidateModels, removeModelMutation, toast, t])

  const removeModels = useCallback(async (modelsToRemove: typeof data.models) => {
    if (modelsToRemove.length === 0) return false
    const count = modelsToRemove.length
    const confirmed = await confirm({
      title: t('models.delete.bulkTitle', { count }),
      description: t('models.delete.bulkDescription'),
      confirmLabel: t('models.delete.bulkConfirmLabel', { count }),
      variant: 'destructive',
    })
    if (!confirmed) return false

    const results = await Promise.allSettled(modelsToRemove.map(model => removeModelMutation.mutateAsync(model.id)))
    const successCount = results.filter(result => result.status === 'fulfilled').length
    const failedCount = results.length - successCount

    if (successCount > 0) {
      await invalidateModels()
      toast.success(failedCount > 0 ? t('models.toast.deletedSome', { success: successCount, failed: failedCount }) : t('models.toast.deletedBulk', { success: successCount }))
      return true
    }

    toast.error(t('models.toast.deleteFailed'))
    return false
  }, [confirm, invalidateModels, removeModelMutation, toast, t])

  const disableModels = useCallback(async (modelsToDisable: typeof data.models) => {
    if (modelsToDisable.length === 0) return false
    const enabledModels = modelsToDisable.filter(model => model.enabled)
    if (enabledModels.length === 0) {
      toast.success(t('models.toast.alreadyDisabled'))
      return true
    }

    const results = await Promise.allSettled(enabledModels.map(model => updateModelMutation.mutateAsync({ id: model.id, enabled: false })))
    const successCount = results.filter(result => result.status === 'fulfilled').length
    const failedCount = results.length - successCount

    if (successCount > 0) {
      await invalidateModels()
      toast.success(failedCount > 0 ? t('models.toast.disabledSome', { success: successCount, failed: failedCount }) : t('models.toast.disabledBulk', { success: successCount }))
      return true
    }

    toast.error(t('models.toast.disableFailed'))
    return false
  }, [invalidateModels, toast, t, updateModelMutation])

  const handleDragEnd = useModelReordering(selectedModels, data.setModels, data.reload)

  return {
    ...data,
    selectedProvider,
    selectedModels,
    ...providerDialog,
    ...providerManagement,
    ...modelDialog,
    ...providerTransfer,
    updateModelEnabled,
    removeModel,
    removeModels,
    disableModels,
    saving: providerDialog.savingProvider || modelDialog.savingModel,
    handleDragEnd,
    PROTOCOL_OPTIONS,
  }
}
