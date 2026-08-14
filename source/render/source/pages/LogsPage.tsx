import { useCallback, useEffect, useRef, useState } from 'react'
import { Clipboard, Download, Eraser, Loader2, Pause, Play } from 'lucide-react'
import { logsApi, type LogEntry } from '@/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'

const LEVEL_STYLE: Record<LogEntry['level'], string> = {
  info: 'text-muted-foreground',
  debug: 'text-muted-foreground/70',
  warn: 'text-amber-500',
  error: 'text-destructive',
}

const LEVEL_LABEL: Record<LogEntry['level'], string> = {
  info: 'INFO',
  debug: 'DEBUG',
  warn: 'WARN',
  error: 'ERROR',
}

export default function LogsPage() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [latestId, setLatestId] = useState(0)
  const [paused, setPaused] = useState(false)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const viewportRef = useRef<HTMLDivElement>(null)
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  const loadInitial = useCallback(async () => {
    setLoading(true)
    setErrorMessage('')
    const result = await logsApi.list({ limit: 2000 })
    if (!result.success) {
      setErrorMessage(result.errorMessage)
      setLoading(false)
      return
    }
    setEntries(result.data.logs)
    setLatestId(result.data.latestId)
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadInitial()
  }, [loadInitial])

  useEffect(() => {
    if (paused) return
    let cancelled = false
    const timer = window.setInterval(async () => {
      if (pausedRef.current) return
      const result = await logsApi.list({ after: latestId, limit: 500 })
      if (cancelled || !result.success) return
      if (result.data.logs.length > 0) {
        setEntries(prev => [...prev, ...result.data.logs])
        setLatestId(result.data.latestId)
      }
    }, 1500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [paused, latestId])

  useEffect(() => {
    if (!autoScroll || paused) return
    const viewport = viewportRef.current
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [entries, autoScroll, paused])

  const handleScroll = () => {
    const viewport = viewportRef.current
    if (!viewport) return
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    setAutoScroll(distanceFromBottom < 40)
  }

  const handleClear = async () => {
    setErrorMessage('')
    const result = await logsApi.clear()
    if (!result.success) {
      setErrorMessage(result.errorMessage)
      return
    }
    setEntries([])
    setLatestId(0)
  }

  const handleExport = async () => {
    setExporting(true)
    setErrorMessage('')
    try {
      const result = await logsApi.export()
      if (!result.success) {
        setErrorMessage(result.errorMessage)
        return
      }
      const blob = new Blob([result.data.content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `one-switch-logs-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.txt`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const handleCopy = async () => {
    setErrorMessage('')
    const result = await logsApi.export()
    if (!result.success) {
      setErrorMessage(result.errorMessage)
      return
    }
    try {
      await navigator.clipboard.writeText(result.data.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setErrorMessage('复制失败，请尝试导出')
    }
  }

  return (
    <PageLayout>
      <PageHeader
        title="运行日志"
        description="实时输出本次进程的服务日志，用于定位错误与调试，不持久化存储"
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPaused(p => !p)}>
              {paused ? <Play size={14} /> : <Pause size={14} />}
              {paused ? '继续' : '暂停'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void handleCopy()}>
              <Clipboard size={14} />
              {copied ? '已复制' : '复制'}
            </Button>
            <Button variant="outline" size="sm" disabled={exporting} onClick={() => void handleExport()}>
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              导出
            </Button>
            <Button variant="outline" size="sm" onClick={() => void handleClear()}>
              <Eraser size={14} />
              清空
            </Button>
          </div>
        )}
      />
      <PageContent>
        {errorMessage && <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{errorMessage}</div>}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex min-h-64 items-center justify-center gap-2 text-xs text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />正在加载日志...
              </div>
            ) : (
              <div
                ref={viewportRef}
                onScroll={handleScroll}
                className={cn(
                  'h-[60vh] overflow-y-auto bg-muted/30 p-3 font-mono text-[11px] leading-relaxed',
                  !autoScroll && 'opacity-90'
                )}
              >
                {entries.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-muted-foreground">暂无日志</div>
                ) : (
                  <div className="space-y-0.5">
                    {entries.map(entry => (
                      <div key={entry.id} className="flex gap-2 break-all whitespace-pre-wrap">
                        <span className="shrink-0 text-muted-foreground/70">{new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                        <span className={cn('shrink-0 w-11 font-semibold', LEVEL_STYLE[entry.level])}>{LEVEL_LABEL[entry.level]}</span>
                        <span className="text-foreground/90">{entry.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </PageContent>
    </PageLayout>
  )
}
