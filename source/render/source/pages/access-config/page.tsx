import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Circle,
  ClipboardCheck,
  Copy,
  ExternalLink,
  KeyRound,
  Plug,
  Server,
  Settings2,
} from 'lucide-react'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { useProxyStatus } from '@/features/proxy/hooks'
import { useProxyToggle } from '../queue-control/hooks/use-proxy-toggle'
import { cn } from '@/lib/utils'

interface AccessConfigPageProps {
  onNavigateToModels?: () => void
  onNavigateToSettings?: () => void
}

const PROTOCOLS = [
  { key: 'openai-completions', label: 'OpenAI Chat Completions', path: '/v1/chat/completions', baseUrl: true },
  { key: 'openai-responses', label: 'OpenAI Responses', path: '/v1/responses', baseUrl: true },
  { key: 'anthropic-messages', label: 'Anthropic Messages', path: '/v1/messages', baseUrl: false },
] as const

function useCopyValue() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)
  useEffect(() => () => { if (timerRef.current !== null) window.clearTimeout(timerRef.current) }, [])

  const copy = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value)
    setCopiedKey(key)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setCopiedKey(null), 1500)
  }
  return { copiedKey, copy }
}

export function AccessConfigPage(props: AccessConfigPageProps) {
  const toast = useToast()
  const proxyStatus = useProxyStatus()
  const { toggleProxy } = useProxyToggle()
  const { copiedKey, copy } = useCopyValue()
  const proxyRunning = proxyStatus?.running ?? false
  const proxyBaseUrl = proxyStatus ? `http://${proxyStatus.host}:${proxyStatus.port}` : ''
  const baseUrl = proxyBaseUrl ? `${proxyBaseUrl}/v1` : ''

  const copyValue = async (key: string, value: string) => {
    try {
      await copy(key, value)
      toast.success('已复制到剪贴板')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '复制失败')
    }
  }

  return (
    <PageLayout>
      <PageHeader
        title="接入配置"
        description="查看本地代理地址，并将 One Switch 接入你的 AI 客户端"
        actions={(
          <Button
            variant={proxyRunning ? 'secondary' : 'default'}
            aria-label={proxyRunning ? '暂停服务' : '启动服务'}
            onClick={() => void toggleProxy()}
          >
            {proxyRunning ? <Circle size={8} className="fill-success text-success motion-safe:animate-pulse motion-reduce:animate-none" /> : <Server size={13} />}
            {proxyRunning ? '运行中' : '启动服务'}
          </Button>
        )}
      />

      <PageContent>
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4 pb-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Server size={16} />
              </div>
              <div>
                <CardTitle>本地代理服务</CardTitle>
                <CardDescription className="mt-0.5">所有模型请求都会进入 default 默认队列，并由队列转发到上游</CardDescription>
              </div>
            </div>
            <Badge variant={proxyRunning ? 'success' : 'muted'}>
              <span className={cn('size-1.5 rounded-full', proxyRunning ? 'bg-success-foreground motion-safe:animate-pulse' : 'bg-muted-foreground')} />
              {proxyRunning ? '服务运行中' : '服务已停止'}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3.5 py-3">
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground">监听地址</p>
                <p className="mt-1 truncate font-mono text-sm">{proxyBaseUrl || '正在读取服务状态…'}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">端口 {proxyStatus?.port ?? '—'}</span>
                <Button variant="outline" size="sm" disabled={!proxyBaseUrl} onClick={() => void copyValue('base', proxyBaseUrl)}>
                  {copiedKey === 'base' ? <Check /> : <Copy />} {copiedKey === 'base' ? '已复制' : '复制地址'}
                </Button>
              </div>
            </div>

            <div className="rounded-lg border">
              <div className="flex items-center gap-2 border-b px-3.5 py-3">
                <Plug size={14} className="text-primary" />
                <div>
                  <p className="text-xs font-medium">协议接入地址</p>
                  <p className="text-[11px] text-muted-foreground">根据客户端支持的协议选择对应地址</p>
                </div>
              </div>
              <div className="divide-y">
                {PROTOCOLS.map(protocol => {
                  const url = proxyBaseUrl
                    ? protocol.baseUrl ? baseUrl : `${proxyBaseUrl}${protocol.path}`
                    : ''
                  return (
                    <div key={protocol.key} className="flex flex-col gap-2 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-xs font-medium">{protocol.label}</p>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{url || '服务启动后显示'}</p>
                      </div>
                      <Button variant="outline" size="sm" className="self-start sm:self-auto" disabled={!proxyRunning || !url} onClick={() => void copyValue(protocol.key, url)}>
                        {copiedKey === protocol.key ? <Check /> : <Copy />} {copiedKey === protocol.key ? '已复制' : '复制'}
                      </Button>
                    </div>
                  )
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2"><KeyRound size={15} className="text-primary" />客户端配置</CardTitle>
              <CardDescription>本地服务无需 API Key 鉴权；客户端若强制要求填写，可使用任意值</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2"><span className="text-muted-foreground">模型名</span><code className="font-mono">任意模型 ID</code></div>
              <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2"><span className="text-muted-foreground">OpenAI Base URL</span><code className="font-mono">{baseUrl || '服务启动后显示'}</code></div>
              <div className="flex items-start gap-2 pt-1 text-[11px] leading-5 text-muted-foreground"><ClipboardCheck size={13} className="mt-0.5 shrink-0 text-success" />所有模型请求都会路由到 default 默认队列，因此这里配置任意模型 ID 都可以；真实上游 API Key 由 One Switch 按供应商配置注入。</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2"><Settings2 size={15} className="text-primary" />下一步</CardTitle>
              <CardDescription>从这里快速完成模型和监听配置</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {props.onNavigateToModels && <Button variant="outline" size="sm" onClick={props.onNavigateToModels}>配置上游模型 <ExternalLink /></Button>}
              {props.onNavigateToSettings && <Button variant="outline" size="sm" onClick={props.onNavigateToSettings}>调整监听设置 <ExternalLink /></Button>}
            </CardContent>
          </Card>
        </div>
      </PageContent>
    </PageLayout>
  )
}
