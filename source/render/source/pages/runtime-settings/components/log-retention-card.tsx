import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'

interface LogRetentionCardProps {
  retentionCount: number
  retentionDays: number | null
  captureRequestContent: boolean
  onRetentionCountChange: (value: number) => void
  onRetentionDaysChange: (value: number | null) => void
  onCaptureRequestContentChange: (value: boolean) => void
  onPrune: (days: number) => Promise<number | null>
}

export function LogRetentionCard(props: LogRetentionCardProps) {
  const {
    retentionCount,
    retentionDays,
    captureRequestContent,
    onRetentionCountChange,
    onRetentionDaysChange,
    onCaptureRequestContentChange,
    onPrune,
  } = props
  const [pruning, setPruning] = useState(false)

  async function handlePrune() {
    if (!retentionDays || pruning) return
    setPruning(true)
    try {
      await onPrune(retentionDays)
    } finally {
      setPruning(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>请求日志</CardTitle>
        <CardDescription>日志正文仅在开启后记录，内容完整保存在本地数据库</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="max-w-sm space-y-1.5">
          <Label htmlFor="log-retention" className="text-xs">最多保留条数</Label>
          <Input
            id="log-retention"
            type="number"
            min={1}
            className="h-8 text-xs"
            value={retentionCount}
            onChange={event => onRetentionCountChange(Number(event.target.value))}
            placeholder="例如：10000"
          />
        </div>
        <div className="max-w-sm space-y-1.5">
          <Label htmlFor="log-retention-days" className="text-xs">自动保留天数</Label>
          <div className="flex gap-2">
            <Input
              id="log-retention-days"
              type="number"
              min={1}
              className="h-8 text-xs"
              value={retentionDays ?? ''}
              onChange={event => onRetentionDaysChange(event.target.value ? Number(event.target.value) : null)}
              placeholder="不按天自动清理"
            />
            <Button variant="outline" size="sm" disabled={!retentionDays || pruning} onClick={() => void handlePrune()}>
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              {pruning ? '清理中...' : '立即清理'}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">清理早于指定天数的请求日志、尝试记录和正文内容。</p>
        </div>
        <div className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2">
          <div>
            <Label htmlFor="capture-request-content" className="text-xs">记录完整请求和响应</Label>
            <p className="mt-0.5 text-[11px] text-muted-foreground">包括协议转换前后的内容，仅保存在本地。</p>
          </div>
          <Switch
            id="capture-request-content"
            checked={captureRequestContent}
            onCheckedChange={onCaptureRequestContentChange}
          />
        </div>
      </CardContent>
    </Card>
  )
}
