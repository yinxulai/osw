import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Settings } from '@common/schemas'

export type QueueSettings = Settings

interface PolicySettingsCardProps {
  settings: QueueSettings
  saving: boolean
  onUpdateSetting: (key: keyof QueueSettings, value: number) => void
  onSave: () => void
}

export function PolicySettingsCard(props: PolicySettingsCardProps) {
  const { settings, saving, onUpdateSetting, onSave } = props

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>转移策略</CardTitle>
        <CardDescription>保存后对新请求立即生效</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="failure-threshold" className="text-xs">失败阈值</Label>
            <Input
              id="failure-threshold"
              type="number"
              min={1}
              className="h-8 text-xs"
              value={settings.consecutiveFailureThreshold}
              onChange={event => onUpdateSetting('consecutiveFailureThreshold', Number(event.target.value))}
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
              onChange={event => onUpdateSetting('cooldownBaseSeconds', Number(event.target.value))}
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
              onChange={event => onUpdateSetting('cooldownMaxSeconds', Number(event.target.value))}
              placeholder="例如：300"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="idle-timeout" className="text-xs">空闲超时（毫秒）</Label>
            <Input
              id="idle-timeout"
              type="number"
              min={1}
              className="h-8 text-xs"
              value={settings.idleTimeoutMilliseconds}
              onChange={event => onUpdateSetting('idleTimeoutMilliseconds', Number(event.target.value))}
              placeholder="例如：30000"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button size="sm" className="h-8 text-xs" disabled={saving} onClick={onSave}>
            {saving ? '保存中...' : '保存策略'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
