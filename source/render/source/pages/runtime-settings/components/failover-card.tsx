import { RefreshCcw } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsCardHeader } from './settings-card-header'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Settings } from '@common/schemas'

interface FailoverCardProps {
  settings: Pick<Settings, 'consecutiveFailureThreshold' | 'cooldownBaseSeconds' | 'cooldownMaxSeconds' | 'idleTimeoutMilliseconds'>
  onUpdate: <K extends keyof FailoverCardProps['settings']>(key: K, value: Settings[K]) => void
}

export function FailoverCard(props: FailoverCardProps) {
  const { settings, onUpdate } = props

  return (
    <Card>
      <SettingsCardHeader icon={<RefreshCcw />} title="故障转移" description="控制失败判定、冷却恢复与流式连接超时" />
      <CardContent className="grid gap-4 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="failure-threshold" className="text-sm">连续失败阈值</Label>
          <Input
            id="failure-threshold"
            type="number"
            min={1}
            value={settings.consecutiveFailureThreshold}
            onChange={event => onUpdate('consecutiveFailureThreshold', Number(event.target.value))}
            placeholder="例如：3"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cooldown-base" className="text-sm">初始冷却</Label>
          <div className="relative">
            <Input
              id="cooldown-base"
              type="number"
              min={1}
              className="pr-9"
            value={settings.cooldownBaseSeconds}
              onChange={event => onUpdate('cooldownBaseSeconds', Number(event.target.value))}
              placeholder="例如：30"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">秒</span>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cooldown-max" className="text-sm">最大冷却</Label>
          <div className="relative">
            <Input
              id="cooldown-max"
              type="number"
              min={1}
              className="pr-9"
            value={settings.cooldownMaxSeconds}
              onChange={event => onUpdate('cooldownMaxSeconds', Number(event.target.value))}
              placeholder="例如：300"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">秒</span>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="idle-timeout" className="text-sm">流式空闲超时</Label>
          <div className="relative">
            <Input
              id="idle-timeout"
              type="number"
              min={1}
              className="pr-12"
            value={settings.idleTimeoutMilliseconds}
              onChange={event => onUpdate('idleTimeoutMilliseconds', Number(event.target.value))}
              placeholder="例如：30000"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">毫秒</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
