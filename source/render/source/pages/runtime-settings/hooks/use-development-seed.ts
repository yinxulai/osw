import { useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { configApi } from '@/api/tools'
import { unwrap } from '@/api/unwrap'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'

export function useDevelopmentSeed(reload: () => Promise<void>) {
  const toast = useToast()
  const confirm = useConfirm()
  const mutation = useMutation({ mutationFn: () => unwrap(configApi.seedDevelopment()), onSuccess: async data => { toast.success(data.inserted ? '测试数据已插入' : '测试数据已存在'); await reload() }, onError: error => toast.error(`插入失败：${error.message}`) })
  const seedDevelopmentData = useCallback(async () => {
    const confirmed = await confirm({
      title: '插入开发测试数据？',
      description: '将补充缺失的测试配置，已有配置不会被覆盖。',
      confirmLabel: '插入数据',
    })
    if (!confirmed) return
    await mutation.mutateAsync().catch(() => undefined)
  }, [confirm, mutation])
  return { seedDevelopmentData }
}
