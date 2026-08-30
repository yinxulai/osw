import { useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { providerApi } from '@/api/providers'
import { unwrap } from '@/api/unwrap'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import type { Provider } from '@common/schemas'

interface UseProviderManagementOptions { reload: () => Promise<void> }
type UpdateProviderVariables = { id: string; enabled: boolean }

export function useProviderManagement(options: UseProviderManagementOptions) {
  const { reload } = options
  const toast = useToast()
  const confirm = useConfirm()
  const removeMutation = useMutation({ mutationFn: (id: string) => unwrap(providerApi.remove(id)), onSuccess: reload, onError: error => toast.error(error.message) })
  const updateMutation = useMutation({ mutationFn: ({ id, enabled }: UpdateProviderVariables) => unwrap(providerApi.update(id, { enabled })), onSuccess: reload, onError: error => toast.error(error.message) })
  const removeProvider = useCallback(async (provider: Provider) => {
    const confirmed = await confirm({
      title: `删除“${provider.name}”？`,
      description: '该供应商将被删除，关联模型会被禁用。',
      confirmLabel: '删除供应商',
      variant: 'destructive',
    })
    if (!confirmed) return
    try { await removeMutation.mutateAsync(provider.id); toast.success('供应商已删除') } catch { /* handled by mutation */ }
  }, [confirm, removeMutation, toast])
  const updateProviderEnabled = useCallback(async (provider: Provider, enabled: boolean) => {
    try { await updateMutation.mutateAsync({ id: provider.id, enabled }); toast.success(enabled ? '供应商已启用' : '供应商已停用') } catch { /* handled by mutation */ }
  }, [updateMutation, toast])

  return { removeProvider, updateProviderEnabled }
}
