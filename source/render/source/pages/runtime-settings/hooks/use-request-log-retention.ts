import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { requestLogApi } from '@/api/observability'
import { unwrap } from '@/api/unwrap'
import { useToast } from '@/components/ui/toast'

export function useRequestLogRetention() {
  const toast = useToast()
  const client = useQueryClient()
  const mutation = useMutation({ mutationFn: (retentionDays: number) => unwrap(requestLogApi.prune(retentionDays)), onSuccess: async data => { toast.success(`已清理 ${data.deleted} 条请求日志`); await Promise.all([client.invalidateQueries({ queryKey: ['request-logs'] }), client.invalidateQueries({ queryKey: ['analytics'] }), client.invalidateQueries({ queryKey: ['queue-metrics'] })]) }, onError: error => toast.error(`清理日志失败：${error.message}`) })
  const pruneLogs = useCallback(async (retentionDays: number): Promise<number | null> => {
    try { return (await mutation.mutateAsync(retentionDays)).deleted } catch { return null }
  }, [mutation])
  return { pruneLogs }
}
