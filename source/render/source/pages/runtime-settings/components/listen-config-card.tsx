import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
      <CardHeader className="gap-3 pb-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div>
          <CardTitle>监听配置</CardTitle>
          <CardDescription className="mt-1">修改后保存会自动重启代理服务</CardDescription>
        </div>
        <Badge variant={proxyRunning ? 'success' : 'muted'}>
          {proxyRunning ? '运行中' : '已停止'}
        </Badge>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="listen-host" className="text-xs">监听地址</Label>
          <Input
            id="listen-host"
            className="h-8 font-mono text-xs"
            value={listenHost}
            onChange={event => onHostChange(event.target.value)}
            placeholder="例如：127.0.0.1"
          />
          <p className="text-[11px] text-muted-foreground">
            建议保留 127.0.0.1，仅允许本机访问。
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="listen-port" className="text-xs">监听端口</Label>
          <Input
            id="listen-port"
            type="number"
            min={1}
            max={65535}
            className="h-8 text-xs"
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
