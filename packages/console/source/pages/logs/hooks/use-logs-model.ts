import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { logsApi } from '@/api/observability'
import { unwrap } from '@/api/unwrap'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import { useLogsUiStore } from '../store'

export const LOGS_PAGE_SIZE = 100

/** 默认只看代理模块；与 `useLogsUiStore` 的初值一致，作为「filtered 是不是被用户动过」的基准。 */
export const DEFAULT_LOG_SCOPE = 'proxy' as const

export function useLogsModel(initialSearchText?: string) {
  const toast = useToast()
  const t = useTranslation()
  const client = useQueryClient()
  const live = useLogsUiStore(state => state.live)
  const setLive = useLogsUiStore(state => state.setLive)
  const levelFilter = useLogsUiStore(state => state.levelFilter)
  const setLevelFilter = useLogsUiStore(state => state.setLevelFilter)
  const scopeFilter = useLogsUiStore(state => state.scopeFilter)
  const setScopeFilter = useLogsUiStore(state => state.setScopeFilter)
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
    ...(scopeFilter !== 'all' ? { scope: scopeFilter } : {}),
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
      toast.success(t('logs.toast.cleared'))
    },
  })
  const logs = query.data?.logs ?? []
  const total = query.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / LOGS_PAGE_SIZE))
  const filtered = levelFilter !== 'all' || searchText.trim() !== '' || scopeFilter !== DEFAULT_LOG_SCOPE
  const error = query.error === null ? null : query.error instanceof Error ? query.error.message : String(query.error)
  const refresh = useCallback(() => query.refetch(), [query])
  const goToPage = useCallback((targetPage: number) => {
    setPage(Math.min(Math.max(1, targetPage), totalPages))
  }, [setPage, totalPages])
  const exportLogs = useCallback(async () => {
    try {
      const data = await exportMutation.mutateAsync()
      const blobUrl = URL.createObjectURL(new Blob([data.content], { type: 'text/plain;charset=utf-8' }))
      const anchor = document.createElement('a'); anchor.href = blobUrl; anchor.download = `osw-${new Date().toISOString().replaceAll(':', '-')}.log`; anchor.click(); URL.revokeObjectURL(blobUrl)
      toast.success(t('logs.toast.exported'))
    } catch (error) { toast.error(error instanceof Error ? error.message : t('logs.toast.exportFailed')) }
  }, [exportMutation, toast, t])
  const clearLogs = useCallback(async () => { try { await clearMutation.mutateAsync() } catch (error) { toast.error(error instanceof Error ? error.message : t('logs.toast.clearFailed')) } }, [clearMutation, toast, t])
  return { logs, total, totalPages, page, goToPage, pageSize: LOGS_PAGE_SIZE, loading: query.isPending, refreshing: query.isFetching && !query.isPending, error, filtered, live, setLive, levelFilter, setLevelFilter, scopeFilter, setScopeFilter, searchText, setSearchText, clearDialogOpen, setClearDialogOpen, refresh, exportLogs, clearLogs }
}
