import { RadioTower } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { SettingsCardHeader } from './settings-card-header'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Settings } from '@common/schemas'

interface ListenConfigCardProps {
  listenHost: string
  listenPort: number
  proxyRunning: boolean
  onHostChange: (value: string) => void
  onPortChange: (value: number) => void
}

export function ListenConfigCard(props: ListenConfigCardProps) {
  const { listenHost, listenPort, proxyRunning, onHostChange, onPortChange } = props

  return (
    <Card>
      <SettingsCardHeader
        icon={<RadioTower />}
        title="监听服务"
        description="设置本地代理的访问地址"
        actions={<Badge variant={proxyRunning ? 'success' : 'muted'}>{proxyRunning ? '运行中' : '已停止'}</Badge>}
      />
      <CardContent className="grid gap-4 px-4 py-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="listen-host" className="text-sm">监听地址</Label>
          <Input
            id="listen-host"
            className="font-mono"
            value={listenHost}
            onChange={event => onHostChange(event.target.value)}
            placeholder="例如：127.0.0.1"
            aria-describedby="listen-host-description"
          />
          <p id="listen-host-description" className="text-xs leading-4 text-muted-foreground">
            推荐 127.0.0.1，仅允许本机访问
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="listen-port" className="text-sm">监听端口</Label>
          <Input
            id="listen-port"
            type="number"
            min={1}
            max={65535}
            value={listenPort}
            onChange={event => onPortChange(Number(event.target.value))}
            placeholder="例如：9300"
          />
        </div>
      </CardContent>
    </Card>
  )
}

export type SettingsType = Settings
