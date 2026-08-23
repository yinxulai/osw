import { useCallback, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { logsApi } from '@/api/observability'
import { unwrap } from '@/api/unwrap'
import { useToast } from '@/components/ui/toast'
import { useLogsUiStore } from '../store'

export function useLogsModel() {
  const toast = useToast()
  const client = useQueryClient()
  const live = useLogsUiStore(state => state.live)
  const setLive = useLogsUiStore(state => state.setLive)
  const levelFilter = useLogsUiStore(state => state.levelFilter)
  const setLevelFilter = useLogsUiStore(state => state.setLevelFilter)
  const searchText = useLogsUiStore(state => state.searchText)
  const setSearchText = useLogsUiStore(state => state.setSearchText)
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const query = useQuery({ queryKey: ['runtime-logs'], queryFn: () => unwrap(logsApi.list({ limit: 2000 })).then(data => data.logs), refetchInterval: live ? 2_000 : false })
  const exportMutation = useMutation({ mutationFn: () => unwrap(logsApi.export()) })
  const clearMutation = useMutation({ mutationFn: () => unwrap(logsApi.clear()), onSuccess: () => { client.setQueryData(['runtime-logs'], []); setClearDialogOpen(false); toast.success('运行日志已清空') } })
  const logs = query.data ?? []
  const refresh = useCallback(() => query.refetch(), [query])
  const exportLogs = useCallback(async () => {
    try {
      const data = await exportMutation.mutateAsync()
      const blobUrl = URL.createObjectURL(new Blob([data.content], { type: 'text/plain;charset=utf-8' }))
      const anchor = document.createElement('a'); anchor.href = blobUrl; anchor.download = `one-switch-${new Date().toISOString().replaceAll(':', '-')}.log`; anchor.click(); URL.revokeObjectURL(blobUrl)
      toast.success('运行日志已导出')
    } catch (error) { toast.error(error instanceof Error ? error.message : '运行日志导出失败') }
  }, [exportMutation, toast])
  const clearLogs = useCallback(async () => { try { await clearMutation.mutateAsync() } catch (error) { toast.error(error instanceof Error ? error.message : '运行日志清空失败') } }, [clearMutation, toast])
  const normalizedSearch = searchText.trim().toLowerCase()
  const filteredLogs = logs.filter(log => (levelFilter === 'all' || log.level === levelFilter) && (!normalizedSearch || log.message.toLowerCase().includes(normalizedSearch)))
  return { logs, filteredLogs, loading: query.isPending, refreshing: query.isFetching && !query.isPending, live, setLive, levelFilter, setLevelFilter, searchText, setSearchText, clearDialogOpen, setClearDialogOpen, refresh, exportLogs, clearLogs }
}
