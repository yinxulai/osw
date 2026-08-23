import { Download, Pause, Play, RefreshCw, Search, Trash2 } from 'lucide-react'
import type { LogEntry } from '@common/schemas'
import { FilterBar } from '@/components/filter-bar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

type LevelFilter = 'all' | LogEntry['level']
interface LogsToolbarProps {
  count: number; total: number; live: boolean; refreshing: boolean; levelFilter: LevelFilter; searchText: string; clearDialogOpen: boolean
  onLiveChange: () => void; onRefresh: () => void; onExport: () => void; onClear: () => void; onDialogChange: (open: boolean) => void
  onLevelChange: (value: LevelFilter) => void; onSearchChange: (value: string) => void
}

export function LogsToolbar(props: LogsToolbarProps) {
  return <FilterBar>
    <div className="relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input value={props.searchText} onChange={event => props.onSearchChange(event.target.value)} placeholder="搜索日志内容..." className="h-8 w-72 pl-8 text-xs" /></div>
    <Select value={props.levelFilter} onValueChange={value => props.onLevelChange(value as LevelFilter)}><SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="全部级别" /></SelectTrigger><SelectContent><SelectItem value="all">全部级别</SelectItem><SelectItem value="error">ERROR</SelectItem><SelectItem value="warn">WARN</SelectItem><SelectItem value="info">INFO</SelectItem><SelectItem value="log">LOG</SelectItem><SelectItem value="debug">DEBUG</SelectItem></SelectContent></Select>
    <span className="text-xs text-muted-foreground">{props.count} / {props.total} 条</span>
    <span className={cn('ml-auto flex items-center gap-1.5 text-xs', props.live ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}><span className="relative flex size-2 shrink-0 items-center justify-center">{props.live && <span className="absolute size-2 rounded-full bg-emerald-500/50 motion-safe:animate-ping" />}<span className={cn('relative size-1.5 rounded-full', props.live ? 'bg-emerald-500' : 'bg-muted-foreground')} /></span>{props.live ? '实时更新' : '已暂停'}</span>
    <Button variant="outline" size="sm" onClick={props.onLiveChange}>{props.live ? <Pause size={14} /> : <Play size={14} />}{props.live ? '暂停' : '继续'}</Button>
    <Button variant="outline" size="icon-sm" title="刷新日志" onClick={props.onRefresh} disabled={props.refreshing}><RefreshCw size={14} className={cn(props.refreshing && 'animate-spin')} /></Button>
    <Button variant="outline" size="icon-sm" title="导出日志" onClick={props.onExport}><Download size={14} /></Button>
    <Dialog open={props.clearDialogOpen} onOpenChange={props.onDialogChange}><DialogTrigger asChild><Button variant="ghost" size="icon-sm" title="清空日志" disabled={props.total === 0}><Trash2 size={14} /></Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>清空运行日志？</DialogTitle><DialogDescription>这会删除本次进程中已捕获的全部运行日志，操作无法撤销。</DialogDescription></DialogHeader><DialogFooter><DialogClose asChild><Button variant="outline">取消</Button></DialogClose><Button variant="destructive" onClick={props.onClear}>清空日志</Button></DialogFooter></DialogContent></Dialog>
  </FilterBar>
}
