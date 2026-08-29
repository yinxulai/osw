import { useState } from 'react'
import { Database, FileText, LockKeyhole, Trash2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SettingsCardHeader } from './settings-card-header'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface LogRetentionCardProps {
  retentionDays: number
  captureRequestContent: boolean
  onRetentionDaysChange: (value: number) => void
  onCaptureRequestContentChange: (value: boolean) => void
  onPrune: (days: number) => Promise<number | null>
}

export function LogRetentionCard(props: LogRetentionCardProps) {
  const {
    retentionDays,
    captureRequestContent,
    onRetentionDaysChange,
    onCaptureRequestContentChange,
    onPrune,
  } = props
  const [pruning, setPruning] = useState(false)
  const [pruneDialogOpen, setPruneDialogOpen] = useState(false)
  const [pruneDays, setPruneDays] = useState(String(retentionDays))

  async function handlePrune() {
    const days = Number(pruneDays)
    if (!Number.isInteger(days) || days < 1 || pruning) return
    setPruning(true)
    try {
      const deleted = await onPrune(days)
      if (deleted !== null) setPruneDialogOpen(false)
    } finally {
      setPruning(false)
    }
  }

  return (
    <Card>
      <SettingsCardHeader
        icon={<Database />}
        title="请求日志"
        description="控制请求记录范围、保留周期和历史数据清理"
        actions={<Badge variant="muted">仅限本机</Badge>}
      />
      <CardContent className="grid divide-y divide-border/60 px-4 py-0 md:grid-cols-3 md:divide-x md:divide-y-0">
        <div className="flex min-w-0 flex-col justify-between gap-4 py-5 md:pr-4">
          <div className="flex min-w-0 items-start gap-3">
            <Trash2 size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
            <div>
              <Label htmlFor="log-retention-days" className="text-sm">自动保留</Label>
              <p className="mt-1 text-xs leading-4 text-muted-foreground">自动删除超过期限的日志</p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end">
            <Input
              id="log-retention-days"
              type="number"
              min={1}
              className="w-20"
              value={retentionDays}
              onChange={event => onRetentionDaysChange(Number(event.target.value))}
            />
            <span className="text-xs text-muted-foreground">天</span>
          </div>
        </div>

        <div className="flex min-w-0 flex-col justify-between gap-4 py-5 md:px-4">
          <div className="flex min-w-0 gap-2.5">
            <FileText size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <Label htmlFor="capture-request-content" className="text-sm">记录完整正文</Label>
              <p className="mt-1 text-xs leading-4 text-muted-foreground">可能包含敏感请求与响应内容</p>
            </div>
          </div>
          <Switch
            className="self-end"
            id="capture-request-content"
            checked={captureRequestContent}
            onCheckedChange={onCaptureRequestContentChange}
          />
        </div>

        <div className="flex min-w-0 flex-col justify-between gap-4 py-5 md:pl-4">
          <div className="flex min-w-0 gap-2.5">
            <LockKeyhole size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">立即清理</div>
              <p className="mt-1 text-xs leading-4 text-muted-foreground">按指定天数删除历史记录</p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="shrink-0 self-end sm:self-auto" disabled={pruning} onClick={() => { setPruneDays(String(retentionDays)); setPruneDialogOpen(true) }}>
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            选择天数
          </Button>
        </div>
      </CardContent>
      <Dialog open={pruneDialogOpen} onOpenChange={open => !pruning && setPruneDialogOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>按天数清理日志</DialogTitle>
            <DialogDescription>这次操作只影响已有历史记录，不会改变自动保留设置。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="prune-retention-days">保留最近</Label>
            <div className="flex items-center gap-2">
              <Input id="prune-retention-days" type="number" min={1} value={pruneDays} onChange={event => setPruneDays(event.target.value)} autoFocus />
              <span className="text-sm text-muted-foreground">天的日志</span>
            </div>
            <p className="text-[11px] leading-4 text-muted-foreground">早于此时间的请求日志、尝试记录和正文会被删除，操作不可撤销。</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPruneDialogOpen(false)} disabled={pruning}>取消</Button>
            <Button onClick={() => void handlePrune()} disabled={pruning || !Number.isInteger(Number(pruneDays)) || Number(pruneDays) < 1}>
              {pruning ? '清理中...' : '确认清理'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
