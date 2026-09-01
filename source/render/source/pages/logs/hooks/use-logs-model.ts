import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { logsApi } from '@/api/observability'
import { unwrap } from '@/api/unwrap'
import { useToast } from '@/components/ui/toast'
import { useLogsUiStore } from '../store'

export const LOGS_PAGE_SIZE = 100

export function useLogsModel(initialSearchText?: string) {
  const toast = useToast()
  const client = useQueryClient()
  const live = useLogsUiStore(state => state.live)
  const setLive = useLogsUiStore(state => state.setLive)
  const levelFilter = useLogsUiStore(state => state.levelFilter)
  const setLevelFilter = useLogsUiStore(state => state.setLevelFilter)
  const searchText = useLogsUiStore(state => state.searchText)
  const setSearchText = useLogsUiStore(state => state.setSearchText)
  const page = useLogsUiStore(state => state.page)
  const setPage = useLogsUiStore(state => state.setPage)
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  useEffect(() => {
    setSearchText(initialSearchText ?? '')
    if (initialSearchText?.trim()) setLevelFilter('all')
  }, [initialSearchText, setLevelFilter, setSearchText])

  const params = {
    limit: LOGS_PAGE_SIZE,
    offset: (page - 1) * LOGS_PAGE_SIZE,
    ...(levelFilter !== 'all' ? { level: levelFilter } : {}),
    ...(searchText.trim() ? { query: searchText.trim() } : {}),
  }
  const query = useQuery({
    queryKey: ['runtime-logs', params],
    queryFn: () => unwrap(logsApi.list(params)),
    placeholderData: previous => previous,
    refetchInterval: live ? 2_000 : false,
  })
  const exportMutation = useMutation({ mutationFn: () => unwrap(logsApi.export()) })
  const clearMutation = useMutation({
    mutationFn: () => unwrap(logsApi.clear()),
    onSuccess: () => {
      setPage(1)
      client.invalidateQueries({ queryKey: ['runtime-logs'] })
      setClearDialogOpen(false)
      toast.success('运行日志已清空')
    },
  })
  const logs = query.data?.logs ?? []
  const total = query.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / LOGS_PAGE_SIZE))
  const refresh = useCallback(() => query.refetch(), [query])
  const goToPage = useCallback((targetPage: number) => {
    setPage(Math.min(Math.max(1, targetPage), totalPages))
  }, [setPage, totalPages])
  const exportLogs = useCallback(async () => {
    try {
      const data = await exportMutation.mutateAsync()
      const blobUrl = URL.createObjectURL(new Blob([data.content], { type: 'text/plain;charset=utf-8' }))
      const anchor = document.createElement('a'); anchor.href = blobUrl; anchor.download = `one-switch-${new Date().toISOString().replaceAll(':', '-')}.log`; anchor.click(); URL.revokeObjectURL(blobUrl)
      toast.success('运行日志已导出')
    } catch (error) { toast.error(error instanceof Error ? error.message : '运行日志导出失败') }
  }, [exportMutation, toast])
  const clearLogs = useCallback(async () => { try { await clearMutation.mutateAsync() } catch (error) { toast.error(error instanceof Error ? error.message : '运行日志清空失败') } }, [clearMutation, toast])
  return { logs, total, totalPages, page, goToPage, pageSize: LOGS_PAGE_SIZE, loading: query.isPending, refreshing: query.isFetching && !query.isPending, live, setLive, levelFilter, setLevelFilter, searchText, setSearchText, clearDialogOpen, setClearDialogOpen, refresh, exportLogs, clearLogs }
}
