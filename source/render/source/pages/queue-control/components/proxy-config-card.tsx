import { useState } from 'react'
import { Check, Copy, KeyRound, Plug, Server } from 'lucide-react'
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

interface ProxyConfigCardProps {
  proxyBaseUrl: string
  proxyPort: number
  proxyRunning: boolean
  copied: boolean
  onCopyEndpoint: (url: string) => void
}

const PROTOCOLS = [
  { key: 'openai-completions', label: 'OpenAI Completions', path: '/v1/chat/completions' },
  { key: 'openai-responses', label: 'OpenAI Responses', path: '/v1/responses' },
  { key: 'anthropic-messages', label: 'Anthropic Messages', path: '/v1/messages' },
] as const

export function ProxyConfigCard(props: ProxyConfigCardProps) {
  const { proxyBaseUrl, proxyPort, proxyRunning, copied, onCopyEndpoint } = props
  const [selectedProtocol, setSelectedProtocol] = useState<string>('openai-completions')

  const protocolInfo = PROTOCOLS.find(p => p.key === selectedProtocol)
  const fullUrl = protocolInfo ? `${proxyBaseUrl}${protocolInfo.path}` : proxyBaseUrl

  return (
    <Card className="via-muted/25 bg-card">
      <CardHeader className="gap-3 p-4 pb-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
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
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
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
                variant="outline"
                className="shrink-0"
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
            <div className="flex h-8 items-center justify-between rounded-md bg-muted/40 px-3">
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

        <div className="flex items-start gap-3 rounded-lg bg-muted/35 px-3.5 py-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-success/10 text-success">
            <KeyRound size={14} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-xs font-medium text-foreground">本地服务无需 API Key</p>
              <span className="inline-flex items-center gap-1 text-[10px] text-success">
                <Check size={11} /> 已就绪
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              代理直接监听本地端口。请在「模型管理」中为各上游提供商单独配置 API Key。
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
