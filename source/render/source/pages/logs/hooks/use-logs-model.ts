import { useCallback, useEffect, useRef, useState } from 'react'
import type { LogEntry } from '@common/schemas'
import { logsApi } from '@/api/observability'
import { useToast } from '@/components/ui/toast'

type LevelFilter = 'all' | LogEntry['level']

export function useLogsModel() {
  const toast = useToast()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [live, setLive] = useState(true)
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')
  const [searchText, setSearchText] = useState('')
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const logsRef = useRef<LogEntry[]>([])
  const requestInFlightRef = useRef(false)
  const initializedRef = useRef(false)

  const loadLogs = useCallback(async (replace: boolean) => {
    if (requestInFlightRef.current) return
    requestInFlightRef.current = true
    try {
      const latestId = logsRef.current.reduce((maximum, log) => Math.max(maximum, log.id), 0)
      const after = replace || latestId === 0 ? undefined : latestId
      const response = await logsApi.list({ after, limit: 500 })
      if (!response.success) {
        if (replace) toast.error(response.errorMessage ?? '运行日志加载失败')
        return
      }
      setLogs(current => {
        const merged = replace ? response.data.logs : [...response.data.logs, ...current]
        const next = merged.sort((left, right) => right.id - left.id).slice(0, 2000)
        logsRef.current = next
        return next
      })
    } finally {
      requestInFlightRef.current = false
      if (!initializedRef.current) {
        initializedRef.current = true
        setLoading(false)
      }
    }
  }, [toast])

  useEffect(() => { void loadLogs(true) }, [loadLogs])

  useEffect(() => {
    if (!live) return
    const timer = window.setInterval(() => { void loadLogs(false) }, 2_000)
    return () => window.clearInterval(timer)
  }, [live, loadLogs])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try { await loadLogs(true) } finally { setRefreshing(false) }
  }, [loadLogs])

  const exportLogs = useCallback(async () => {
    const response = await logsApi.export()
    if (!response.success) { toast.error(response.errorMessage ?? '运行日志导出失败'); return }
    const blobUrl = URL.createObjectURL(new Blob([response.data.content], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = blobUrl
    anchor.download = `one-switch-${new Date().toISOString().replaceAll(':', '-')}.log`
    anchor.click()
    URL.revokeObjectURL(blobUrl)
    toast.success('运行日志已导出')
  }, [toast])

  const clearLogs = useCallback(async () => {
    const response = await logsApi.clear()
    if (!response.success) { toast.error(response.errorMessage ?? '运行日志清空失败'); return }
    logsRef.current = []
    setLogs([])
    setClearDialogOpen(false)
    toast.success('运行日志已清空')
  }, [toast])

  const normalizedSearch = searchText.trim().toLowerCase()
  const filteredLogs = logs.filter(log =>
    (levelFilter === 'all' || log.level === levelFilter) &&
    (!normalizedSearch || log.message.toLowerCase().includes(normalizedSearch)),
  )

  return { logs, filteredLogs, loading, refreshing, live, setLive, levelFilter, setLevelFilter, searchText, setSearchText, clearDialogOpen, setClearDialogOpen, refresh, exportLogs, clearLogs }
}
