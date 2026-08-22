import { useCallback } from 'react'
import { configApi } from '@/api/tools'
import { useToast } from '@/components/ui/toast'

export function useDevelopmentSeed(reload: () => Promise<void>) {
  const toast = useToast()
  const seedDevelopmentData = useCallback(async () => {
    if (!window.confirm('插入开发测试数据？已有配置不会被覆盖。')) return
    const result = await configApi.seedDevelopment()
    if (!result.success) {
      toast.error(`插入失败：${result.errorMessage}`)
      return
    }
    toast.success(result.data.inserted ? '测试数据已插入' : '测试数据已存在')
    await reload()
  }, [reload, toast])
  return { seedDevelopmentData }
}
