import { useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { providerApi } from '@/api/providers'
import { unwrap } from '@/api/unwrap'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import { useProvidersActions } from '@/data/providers'
import type { Provider } from '@common/schemas'

interface UseProviderManagementOptions { reload: () => Promise<void> }
type UpdateProviderVariables = { id: string; enabled: boolean }

export function useProviderManagement(options: UseProviderManagementOptions) {
  const { reload } = options
  const toast = useToast()
  const confirm = useConfirm()
  const t = useTranslation()
  const { reorder: reorderProviderOrder } = useProvidersActions()
  const removeMutation = useMutation({ mutationFn: (id: string) => unwrap(providerApi.remove(id)), onSuccess: reload, onError: error => toast.error(error.message) })
  const updateMutation = useMutation({ mutationFn: ({ id, enabled }: UpdateProviderVariables) => unwrap(providerApi.update(id, { enabled })), onSuccess: reload, onError: error => toast.error(error.message) })
  const removeProvider = useCallback(async (provider: Provider) => {
    const confirmed = await confirm({
      title: t('providers.delete.title', { name: provider.name }),
      description: t('providers.delete.description'),
      confirmLabel: t('providers.action.delete'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try { await removeMutation.mutateAsync(provider.id); toast.success(t('providers.toast.deleted')) } catch { /* handled by mutation */ }
  }, [confirm, removeMutation, toast, t])
  const updateProviderEnabled = useCallback(async (provider: Provider, enabled: boolean) => {
    try { await updateMutation.mutateAsync({ id: provider.id, enabled }); toast.success(enabled ? t('providers.toast.enabled') : t('providers.toast.disabled')) } catch { /* handled by mutation */ }
  }, [updateMutation, toast, t])
  /** 侧栏拖拽排序已经在本地乐观生效，失败才提示并回滚。 */
  const reorderProviders = useCallback(async (ids: string[]) => {
    try { await reorderProviderOrder(ids) } catch (error) {
      toast.error(t('providers.reorder.failed', { message: error instanceof Error ? error.message : String(error) }))
    }
  }, [reorderProviderOrder, toast, t])

  return { removeProvider, updateProviderEnabled, reorderProviders }
}
