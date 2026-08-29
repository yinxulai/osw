import { useState } from 'react'
import { CheckCircle2, Loader2, PlugZap, XCircle } from 'lucide-react'
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
  const [targetUrl, setTargetUrl] = useState('https://www.google.com/generate_204')

  return (
    <Card className="border-border">
      <SettingsCardHeader title="上游代理" description="控制 One Switch 访问模型服务时使用的网络代理" />
      <CardContent className="space-y-4 px-4 py-4">
        <RadioGroup value={props.mode} onValueChange={value => props.onModeChange(value as OutboundProxyMode)}>
          {modes.map(option => (
            <Label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-md bg-muted/40 px-3 py-2.5">
              <RadioGroupItem value={option.value} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{option.title}</span>
                <span className="block text-xs font-normal text-muted-foreground">{option.description}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>

        {props.mode === 'custom' && (
          <div className="space-y-1.5">
            <Label htmlFor="outbound-proxy-url" className="text-xs">代理 URL</Label>
            <Input
              id="outbound-proxy-url"
              className="h-8 font-mono text-xs"
              value={props.proxyUrl}
              onChange={event => props.onProxyUrlChange(event.target.value)}
              placeholder="http://user:password@127.0.0.1:7890"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="outbound-proxy-bypass" className="text-xs">不使用代理的地址</Label>
          <Input
            id="outbound-proxy-bypass"
            className="h-8 font-mono text-xs"
            value={props.bypass}
            onChange={event => props.onBypassChange(event.target.value)}
            placeholder="localhost,127.0.0.1,::1"
          />
          <p className="text-[11px] text-muted-foreground">使用逗号分隔，支持 *.example.com 和 &lt;local&gt;。</p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="outbound-proxy-test-target" className="text-xs">测试地址</Label>
            <Input
              id="outbound-proxy-test-target"
              className="h-8 font-mono text-xs"
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
