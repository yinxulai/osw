import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
    <Card className="border-border/70 shadow-none">
      <CardHeader className="border-b border-border/60 px-4 py-4">
        <CardTitle>故障转移</CardTitle>
        <CardDescription>这些设置对后续请求生效</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="failure-threshold" className="text-xs">连续失败阈值</Label>
          <Input
            id="failure-threshold"
            type="number"
            min={1}
            className="h-8 text-xs"
            value={settings.consecutiveFailureThreshold}
            onChange={event => onUpdate('consecutiveFailureThreshold', Number(event.target.value))}
            placeholder="例如：3"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cooldown-base" className="text-xs">初始冷却（秒）</Label>
          <Input
            id="cooldown-base"
            type="number"
            min={1}
            className="h-8 text-xs"
            value={settings.cooldownBaseSeconds}
            onChange={event => onUpdate('cooldownBaseSeconds', Number(event.target.value))}
            placeholder="例如：30"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cooldown-max" className="text-xs">最大冷却（秒）</Label>
          <Input
            id="cooldown-max"
            type="number"
            min={1}
            className="h-8 text-xs"
            value={settings.cooldownMaxSeconds}
            onChange={event => onUpdate('cooldownMaxSeconds', Number(event.target.value))}
            placeholder="例如：300"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="idle-timeout" className="text-xs">流式空闲超时（毫秒）</Label>
          <Input
            id="idle-timeout"
            type="number"
            min={1}
            className="h-8 text-xs"
            value={settings.idleTimeoutMilliseconds}
            onChange={event => onUpdate('idleTimeoutMilliseconds', Number(event.target.value))}
            placeholder="例如：30000"
          />
        </div>
      </CardContent>
    </Card>
  )
}
