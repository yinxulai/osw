import { Copy, KeyRound, Plug, Server } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { UpstreamModel } from '@common/schemas'

interface ProxyConfigCardProps {
  proxyBaseUrl: string
  proxyRunning: boolean
  copied: boolean
  models: UpstreamModel[]
  onToggleProxy: () => void
  onCopyEndpoint: () => void
}

const PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages'] as const

export function ProxyConfigCard(props: ProxyConfigCardProps) {
  const { proxyBaseUrl, proxyRunning, copied, models, onToggleProxy, onCopyEndpoint } = props

  return (
    <Card>
      <CardHeader className="gap-3 pb-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div className="flex items-start gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Server size={16} />
          </div>
          <div>
            <CardTitle>服务接入配置</CardTitle>
            <CardDescription className="mt-0.5">所有协议统一使用同一个本地 Base URL</CardDescription>
          </div>
        </div>
        <Button
          variant={proxyRunning ? 'outline' : 'default'}
          size="sm"
          className="h-8 text-xs"
          onClick={onToggleProxy}
        >
          {proxyRunning ? '暂停服务' : '启动服务'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_1fr]">
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">
              <Plug size={11} className="mr-1 inline" />代理地址
            </Label>
            <div className="flex gap-2">
              <Input readOnly value={proxyBaseUrl} className="h-8 font-mono text-xs" />
              <Button
                variant="secondary"
                size="sm"
                className="h-8 text-xs"
                disabled={!proxyRunning}
                onClick={onCopyEndpoint}
              >
                <Copy size={13} /> {copied ? '已复制' : '复制'}
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">
              <KeyRound size={11} className="mr-1 inline" />服务状态
            </Label>
            <div className="flex h-8 items-center rounded-md border px-3">
              <span
                className={cn(
                  'mr-2 h-1.5 w-1.5 rounded-full',
                  proxyRunning ? 'bg-success' : 'bg-muted-foreground',
                )}
              />
              <span className="text-xs">{proxyRunning ? '运行中' : '已暂停'}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {PROTOCOLS.map(protocol => {
            const count = models.filter(
              model => model.endpoints.some(endpoint => endpoint.protocol === protocol) && model.enabled,
            ).length
            return (
              <Badge key={protocol} variant="secondary">
                {protocol.toUpperCase()} · {count}
              </Badge>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
