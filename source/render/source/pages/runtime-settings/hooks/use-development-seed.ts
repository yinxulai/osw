import { useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { configApi } from '@/api/tools'
import { unwrap } from '@/api/unwrap'
import { useToast } from '@/components/ui/toast'

export function useDevelopmentSeed(reload: () => Promise<void>) {
  const toast = useToast()
  const mutation = useMutation({ mutationFn: () => unwrap(configApi.seedDevelopment()), onSuccess: async data => { toast.success(data.inserted ? '测试数据已插入' : '测试数据已存在'); await reload() }, onError: error => toast.error(`插入失败：${error.message}`) })
  const seedDevelopmentData = useCallback(async () => {
    if (!window.confirm('插入开发测试数据？已有配置不会被覆盖。')) return
    await mutation.mutateAsync().catch(() => undefined)
  }, [mutation])
  return { seedDevelopmentData }
}
