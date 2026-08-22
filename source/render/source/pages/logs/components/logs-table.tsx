import type { LogEntry } from '@common/schemas'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const LEVEL_STYLE: Record<LogEntry['level'], string> = { error: 'bg-red-500/15 text-red-600 dark:text-red-400', warn: 'bg-amber-500/15 text-amber-600 dark:text-amber-400', info: 'bg-sky-500/15 text-sky-600 dark:text-sky-400', log: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400', debug: 'bg-violet-500/15 text-violet-600 dark:text-violet-400' }
const LEVEL_LABEL: Record<LogEntry['level'], string> = { error: 'ERROR', warn: 'WARN', info: 'INFO', log: 'LOG', debug: 'DEBUG' }
function formatTimestamp(timestamp: number) { return new Intl.DateTimeFormat('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 }).format(timestamp) }

interface LogsTableProps { logs: LogEntry[]; loading: boolean }

export function LogsTable(props: LogsTableProps) {
  const { logs, loading } = props
  return <div className="overflow-hidden rounded-lg border border-border bg-card"><div className="max-h-[calc(100vh-190px)] overflow-auto"><table className="w-full table-fixed text-xs"><thead className="sticky top-0 z-10 bg-muted/95 text-left text-muted-foreground backdrop-blur-sm"><tr className="border-b border-border"><th className="w-40 px-3 py-2 font-medium">时间</th><th className="w-20 px-3 py-2 font-medium">级别</th><th className="px-3 py-2 font-medium">消息</th></tr></thead><tbody>{loading ? Array.from({ length: 10 }).map((_, index) => <tr key={index} className="border-b border-border last:border-0"><td className="px-3 py-2.5"><Skeleton className="h-3 w-28" /></td><td className="px-3 py-2.5"><Skeleton className="h-5 w-14" /></td><td className="px-3 py-2.5"><Skeleton className="h-3 w-4/5" /></td></tr>) : logs.length === 0 ? <tr><td colSpan={3} className="px-4 py-16 text-center text-muted-foreground">暂无匹配的运行日志</td></tr> : logs.map(log => <tr key={log.id} className="border-b border-border align-top last:border-0 hover:bg-muted/25"><td className="whitespace-nowrap px-3 py-2 font-mono text-muted-foreground">{formatTimestamp(log.timestamp)}</td><td className="px-3 py-2"><Badge variant="outline" className={cn('h-5 px-1.5 font-mono text-[10px]', LEVEL_STYLE[log.level])}>{LEVEL_LABEL[log.level]}</Badge></td><td className="whitespace-pre-wrap break-all px-3 py-2 font-mono leading-5">{log.message}</td></tr>)}</tbody></table></div></div>
}
