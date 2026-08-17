import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface LogRetentionCardProps {
  retentionCount: number
  onChange: (value: number) => void
}

export function LogRetentionCard({ retentionCount, onChange }: LogRetentionCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>请求日志容量</CardTitle>
        <CardDescription>只记录元数据和故障尝试，不保存请求体、响应体或 API Key</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="max-w-sm space-y-1.5">
          <Label htmlFor="log-retention" className="text-xs">最多保留条数</Label>
          <Input
            id="log-retention"
            type="number"
            min={1}
            className="h-8 text-xs"
            value={retentionCount}
            onChange={event => onChange(Number(event.target.value))}
            placeholder="例如：10000"
          />
        </div>
      </CardContent>
    </Card>
  )
}
