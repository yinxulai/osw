import { useCallback } from 'react'
import { requestLogApi } from '@/api/observability'
import { useToast } from '@/components/ui/toast'

export function useRequestLogRetention() {
  const toast = useToast()
  const pruneLogs = useCallback(async (retentionDays: number): Promise<number | null> => {
    const result = await requestLogApi.prune(retentionDays)
    if (!result.success) {
      toast.error(`清理日志失败：${result.errorMessage}`)
      return null
    }
    toast.success(`已清理 ${result.data.deleted} 条请求日志`)
    return result.data.deleted
  }, [toast])
  return { pruneLogs }
}
