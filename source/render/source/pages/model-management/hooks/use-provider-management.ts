import { useCallback } from 'react'
import { providerApi } from '@/api/providers'
import { useToast } from '@/components/ui/toast'
import type { Provider } from '@common/schemas'

interface UseProviderManagementOptions { reload: () => Promise<void> }

export function useProviderManagement(options: UseProviderManagementOptions) {
  const { reload } = options
  const toast = useToast()

  const removeProvider = useCallback(async (provider: Provider) => {
    if (!window.confirm(`删除供应商"${provider.name}"？关联模型将被禁用。`)) return
    const result = await providerApi.remove(provider.id)
    if (!result.success) { toast.error(result.errorMessage); return }
    toast.success('供应商已删除')
    await reload()
  }, [reload, toast])

  const updateProviderEnabled = useCallback(async (provider: Provider, enabled: boolean) => {
    const result = await providerApi.update(provider.id, { enabled })
    if (!result.success) { toast.error(result.errorMessage); return }
    toast.success(enabled ? '供应商已启用' : '供应商已停用')
    await reload()
  }, [reload, toast])

  return { removeProvider, updateProviderEnabled }
}
