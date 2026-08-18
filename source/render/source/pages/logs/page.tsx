import { useEffect, useState } from 'react'
import { Download, Pause, Play, RefreshCw, Search, Trash2 } from 'lucide-react'
import type { LogEntry } from '@common/schemas'
import { logsApi } from '@/api'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

type LevelFilter = 'all' | LogEntry['level']

const LEVEL_STYLE: Record<LogEntry['level'], string> = {
  error: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  warn: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  info: 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  log: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400',
  debug: 'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400',
}

const LEVEL_LABEL: Record<LogEntry['level'], string> = {
  error: 'ERROR',
  warn: 'WARN',
  info: 'INFO',
  log: 'LOG',
  debug: 'DEBUG',
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  }).format(timestamp)
}

export function LogsPage() {
  const toast = useToast()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [live, setLive] = useState(true)
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')
  const [searchText, setSearchText] = useState('')
  const [clearDialogOpen, setClearDialogOpen] = useState(false)

  const loadLogs = async (replace: boolean) => {
    const after = replace || logs.length === 0 ? undefined : logs[logs.length - 1].id
    const response = await logsApi.list({ after, limit: 500 })
    if (!response.success) {
      if (replace) toast.error(response.errorMessage ?? '运行日志加载失败')
      return
    }
    setLogs(current => replace ? response.data.logs : [...current, ...response.data.logs].slice(-2000))
  }

  useEffect(() => {
    void loadLogs(true).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!live) return
    const timer = window.setInterval(() => void loadLogs(false), 2000)
    return () => window.clearInterval(timer)
  }, [live, logs])

  const refresh = async () => {
    setRefreshing(true)
    await loadLogs(true)
    setRefreshing(false)
  }

  const exportLogs = async () => {
    const response = await logsApi.export()
    if (!response.success) {
      toast.error(response.errorMessage ?? '运行日志导出失败')
      return
    }
    const blobUrl = URL.createObjectURL(new Blob([response.data.content], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = blobUrl
    anchor.download = `one-switch-${new Date().toISOString().replaceAll(':', '-')}.log`
    anchor.click()
    URL.revokeObjectURL(blobUrl)
    toast.success('运行日志已导出')
  }

  const clearLogs = async () => {
    const response = await logsApi.clear()
    if (!response.success) {
      toast.error(response.errorMessage ?? '运行日志清空失败')
      return
    }
    setLogs([])
    setClearDialogOpen(false)
    toast.success('运行日志已清空')
  }

  const normalizedSearch = searchText.trim().toLowerCase()
  const filteredLogs = logs.filter(log =>
    (levelFilter === 'all' || log.level === levelFilter) &&
    (!normalizedSearch || log.message.toLowerCase().includes(normalizedSearch)),
  )

  return (
    <PageLayout>
      <PageHeader
        title="运行日志"
        description="本次进程运行期间的服务日志，用于实时观察和故障排查"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setLive(value => !value)}>
              {live ? <Pause size={14} className="mr-1.5" /> : <Play size={14} className="mr-1.5" />}
              {live ? '暂停' : '继续'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void exportLogs()}>
              <Download size={14} className="mr-1.5" />
              导出
            </Button>
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCw size={14} className={cn('mr-1.5', refreshing && 'animate-spin')} />
              刷新
            </Button>
          </div>
        }
      />
      <PageContent>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchText}
              onChange={event => setSearchText(event.target.value)}
              placeholder="搜索日志内容..."
              className="h-8 w-72 pl-8 text-xs"
            />
          </div>
          <Select value={levelFilter} onValueChange={value => setLevelFilter(value as LevelFilter)}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="全部级别" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部级别</SelectItem>
              <SelectItem value="error">ERROR</SelectItem>
              <SelectItem value="warn">WARN</SelectItem>
              <SelectItem value="info">INFO</SelectItem>
              <SelectItem value="log">LOG</SelectItem>
              <SelectItem value="debug">DEBUG</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">{filteredLogs.length} / {logs.length} 条</span>
          <span className={cn('ml-auto flex items-center gap-1.5 text-xs', live ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
            <span className="relative flex size-2 shrink-0 items-center justify-center">
              {live && <span className="absolute size-2 rounded-full bg-emerald-500/50 motion-safe:animate-ping" />}
              <span className={cn('relative size-1.5 rounded-full', live ? 'bg-emerald-500' : 'bg-muted-foreground')} />
            </span>
            {live ? '实时更新' : '已暂停'}
          </span>
          <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" disabled={logs.length === 0}>
                <Trash2 size={14} className="mr-1.5" />
                清空
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>清空运行日志？</DialogTitle>
                <DialogDescription>这会删除本次进程中已捕获的全部运行日志，操作无法撤销。</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild><Button variant="outline">取消</Button></DialogClose>
                <Button variant="destructive" onClick={() => void clearLogs()}>清空日志</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="overflow-hidden rounded-lg border">
          <div className="max-h-[calc(100vh-190px)] overflow-auto">
            <table className="w-full table-fixed text-xs">
              <thead className="sticky top-0 z-10 bg-muted/95 text-left text-muted-foreground backdrop-blur-sm">
                <tr className="border-b">
                  <th className="w-40 px-3 py-2 font-medium">时间</th>
                  <th className="w-20 px-3 py-2 font-medium">级别</th>
                  <th className="px-3 py-2 font-medium">消息</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 10 }).map((_, index) => (
                    <tr key={index} className="border-b last:border-0">
                      <td className="px-3 py-2.5"><Skeleton className="h-3 w-28" /></td>
                      <td className="px-3 py-2.5"><Skeleton className="h-5 w-14" /></td>
                      <td className="px-3 py-2.5"><Skeleton className="h-3 w-4/5" /></td>
                    </tr>
                  ))
                ) : filteredLogs.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-16 text-center text-muted-foreground">暂无匹配的运行日志</td></tr>
                ) : filteredLogs.map(log => (
                  <tr key={log.id} className="border-b align-top last:border-0 hover:bg-muted/25">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-muted-foreground">{formatTimestamp(log.timestamp)}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className={cn('h-5 px-1.5 font-mono text-[10px]', LEVEL_STYLE[log.level])}>
                        {LEVEL_LABEL[log.level]}
                      </Badge>
                    </td>
                    <td className="whitespace-pre-wrap break-all px-3 py-2 font-mono leading-5">{log.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </PageContent>
    </PageLayout>
  )
}
