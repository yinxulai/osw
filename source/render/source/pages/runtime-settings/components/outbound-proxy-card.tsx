import { useState } from 'react'
import { CheckCircle2, Loader2, Network, PlugZap, ShieldCheck, XCircle } from 'lucide-react'
import type { OutboundProxyMode } from '@common/schemas'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { SettingsCardHeader } from './settings-card-header'
import { useOutboundProxyTest } from '../hooks/use-outbound-proxy-test'

interface OutboundProxyCardProps {
  mode: OutboundProxyMode
  proxyUrl: string
  bypass: string
  onModeChange: (value: OutboundProxyMode) => void
  onProxyUrlChange: (value: string) => void
  onBypassChange: (value: string) => void
}

const modes: { value: OutboundProxyMode; title: string; description: string }[] = [
  { value: 'direct', title: '不使用任何代理', description: '所有上游请求强制直连' },
  { value: 'system', title: '使用系统代理', description: '跟随操作系统代理设置' },
  { value: 'custom', title: '自定义代理', description: '使用指定的 HTTP、HTTPS 或 SOCKS 代理' },
]

export function OutboundProxyCard(props: OutboundProxyCardProps) {
  const test = useOutboundProxyTest()
  const [targetUrl, setTargetUrl] = useState('https://www.gstatic.com/generate_204')

  return (
    <Card>
      <SettingsCardHeader icon={<Network />} title="上游代理" description="控制 One Switch 访问模型服务时使用的网络路径" />
      <CardContent className="space-y-5 px-4 py-4">
        <RadioGroup className="grid gap-2 md:grid-cols-3" value={props.mode} onValueChange={value => props.onModeChange(value as OutboundProxyMode)}>
          {modes.map(option => (
            <Label
              key={option.value}
              data-checked={props.mode === option.value}
              className="flex min-h-20 cursor-pointer items-start gap-3 rounded-lg bg-muted/40 px-3 py-3 transition-colors hover:bg-muted/70 data-[checked=true]:bg-primary/10"
            >
              <RadioGroupItem value={option.value} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{option.title}</span>
                <span className="block text-xs font-normal text-muted-foreground">{option.description}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>

        {props.mode === 'custom' && (
          <div className="grid gap-4 rounded-lg bg-muted/30 p-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="outbound-proxy-url" className="text-sm">代理 URL</Label>
              <Input
                id="outbound-proxy-url"
                className="font-mono"
                value={props.proxyUrl}
                onChange={event => props.onProxyUrlChange(event.target.value)}
                placeholder="http://user:password@127.0.0.1:7890"
              />
              <p className="flex items-center gap-1.5 text-xs leading-4 text-muted-foreground">
                <ShieldCheck className="size-3.5 shrink-0" />仅使用可信代理，凭据会保存在本机
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="outbound-proxy-bypass" className="text-sm">直连地址</Label>
              <Input
                id="outbound-proxy-bypass"
                className="font-mono"
                value={props.bypass}
                onChange={event => props.onBypassChange(event.target.value)}
                placeholder="localhost,127.0.0.1,::1"
              />
              <p className="text-xs leading-4 text-muted-foreground">逗号分隔，支持 *.example.com 和 &lt;local&gt;</p>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="outbound-proxy-test-target" className="text-sm">连接测试</Label>
            <Input
              id="outbound-proxy-test-target"
              className="font-mono"
              value={targetUrl}
              onChange={event => setTargetUrl(event.target.value)}
            />
          </div>
          <Button
            variant="outline"
            disabled={test.status === 'running' || (props.mode === 'custom' && !props.proxyUrl.trim())}
            onClick={() => void test.run({ mode: props.mode, proxyUrl: props.proxyUrl, bypass: props.bypass, targetUrl })}
          >
            {test.status === 'running' ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <PlugZap className="mr-1 size-3.5" />}
            {test.status === 'running' ? '测试中' : '测试连接'}
          </Button>
        </div>

        {test.status === 'success' && test.result && (
          <Alert className="border-0 bg-success/10 text-success">
            <CheckCircle2 />
            <AlertDescription className="text-current">连接成功，HTTP {test.result.statusCode}，耗时 {test.result.durationMilliseconds} ms</AlertDescription>
          </Alert>
        )}
        {test.status === 'error' && (
          <Alert variant="destructive" className="border-0 bg-destructive/10">
            <XCircle />
            <AlertDescription>{test.errorMessage}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
