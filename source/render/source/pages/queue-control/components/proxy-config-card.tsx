import { useState } from 'react'
import { Copy, Info, KeyRound, Plug, Server } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { UpstreamModel } from '@common/schemas'

interface ProxyConfigCardProps {
  proxyBaseUrl: string
  proxyPort: number
  proxyRunning: boolean
  copied: boolean
  models: UpstreamModel[]
  onToggleProxy: () => void
  onCopyEndpoint: (url: string) => void
}

const PROTOCOLS = [
  { key: 'openai-completions', label: 'OpenAI Completions', path: '/v1/chat/completions' },
  { key: 'openai-responses', label: 'OpenAI Responses', path: '/v1/responses' },
  { key: 'anthropic-messages', label: 'Anthropic Messages', path: '/v1/messages' },
] as const

export function ProxyConfigCard(props: ProxyConfigCardProps) {
  const { proxyBaseUrl, proxyPort, proxyRunning, copied, models, onToggleProxy, onCopyEndpoint } = props
  const [selectedProtocol, setSelectedProtocol] = useState<string>('openai-completions')

  const protocolInfo = PROTOCOLS.find(p => p.key === selectedProtocol)
  const fullUrl = protocolInfo ? `${proxyBaseUrl}${protocolInfo.path}` : proxyBaseUrl

  return (
    <Card>
      <CardHeader className="gap-3 pb-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div className="flex items-start gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Server size={16} />
          </div>
          <div>
            <CardTitle>服务接入配置</CardTitle>
            <CardDescription className="mt-0.5">
              本地代理服务，统一入口转发到各上游提供商
            </CardDescription>
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
              <Plug size={11} className="mr-1 inline" />接入地址
            </Label>
            <div className="flex gap-2">
              <Select value={selectedProtocol} onValueChange={setSelectedProtocol}>
                <SelectTrigger className="h-8 w-44 shrink-0 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROTOCOLS.map(p => (
                    <SelectItem key={p.key} value={p.key} className="text-xs">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input readOnly value={fullUrl} className="h-8 flex-1 font-mono text-xs" />
              <Button
                variant="secondary"
                size="sm"
                className="h-8 shrink-0 text-xs"
                disabled={!proxyRunning}
                onClick={() => void onCopyEndpoint(fullUrl)}
              >
                <Copy size={13} /> {copied ? '已复制' : '复制'}
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">
              <KeyRound size={11} className="mr-1 inline" />服务状态
            </Label>
            <div className="flex h-8 items-center justify-between rounded-md border px-3">
              <div className="flex items-center">
                <span
                  className={cn(
                    'mr-2 h-1.5 w-1.5 rounded-full',
                    proxyRunning ? 'bg-success animate-pulse' : 'bg-muted-foreground',
                  )}
                />
                <span className="text-xs">{proxyRunning ? '运行中' : '已暂停'}</span>
              </div>
              <span className="font-mono text-[11px] text-muted-foreground">
                :{proxyPort}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {PROTOCOLS.map(protocol => {
            const count = models.filter(
              model => model.endpoints.some(endpoint => endpoint.protocol === protocol.key) && model.enabled,
            ).length
            return (
              <Badge key={protocol.key} variant="secondary">
                {protocol.label} · {count}
              </Badge>
            )
          })}
        </div>

        <div className="flex gap-2 rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-[11px]">
          <Info size={13} className="mt-0.5 shrink-0 text-blue-500" />
          <div>
            <p className="font-medium text-blue-600 dark:text-blue-400">无需配置 API Key</p>
            <p className="mt-0.5 text-muted-foreground">
              代理服务本身不需要 API Key 鉴权，直接在本地端口监听。上游提供商的 API Key 在「模型管理」中为每个提供商单独配置。
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
