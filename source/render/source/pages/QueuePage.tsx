import { useState } from 'react'
import {
  BarChart3,
  CheckCircle2,
  Plug,
  RefreshCw,
  Lightbulb,
  Pencil,
  AlertTriangle,
  Plus,
  Activity,
  Copy,
  Server,
  KeyRound,
  GripVertical,
  ChevronUp,
  ChevronDown,
  CircleDot,
  Circle,
  ChevronDown as ChevronDownIcon,
  Target,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

type Protocol = 'openai' | 'anthropic' | 'gemini'

const PROTOCOLS: { key: Protocol; label: string; path: string }[] = [
  { key: 'openai', label: 'OpenAI', path: '/v1' },
  { key: 'anthropic', label: 'Anthropic', path: '/v1/anthropic' },
  { key: 'gemini', label: 'Gemini', path: '/v1/gemini' },
]

type BindingStatus = 'active' | 'standby' | 'warning' | 'cooling' | 'disabled'

interface Binding {
  id: string
  provider: string
  model: string
  protocol: string
  upstream: string
  priority: number
  status: BindingStatus
  latency: string
  successRate: string
  cooldownRemain?: string
}

const bindings: Binding[] = [
  {
    id: 'bind_001',
    provider: 'OpenAI',
    model: 'gpt-4o',
    protocol: 'OpenAI',
    upstream: 'https://api.openai.com/v1',
    priority: 1,
    status: 'active',
    latency: '1.2s',
    successRate: '99.8%',
  },
  {
    id: 'bind_002',
    provider: 'Anthropic',
    model: 'claude-3-5-sonnet-20240620',
    protocol: 'OpenAI',
    upstream: 'https://api.anthropic.com/v1',
    priority: 2,
    status: 'standby',
    latency: '2.1s',
    successRate: '99.5%',
  },
  {
    id: 'bind_003',
    provider: 'DeepSeek',
    model: 'deepseek-chat',
    protocol: 'OpenAI',
    upstream: 'https://api.deepseek.com/v1',
    priority: 3,
    status: 'warning',
    latency: '5.8s',
    successRate: '97.2%',
  },
  {
    id: 'bind_004',
    provider: 'Gemini',
    model: 'gemini-1.5-pro-002',
    protocol: 'OpenAI',
    upstream: 'https://generativelanguage.googleapis.com/v1beta',
    priority: 4,
    status: 'cooling',
    latency: '-',
    successRate: '-',
    cooldownRemain: '2分30秒',
  },
  {
    id: 'bind_005',
    provider: 'Ollama (本地)',
    model: 'qwen2.5:72b',
    protocol: 'OpenAI',
    upstream: 'http://localhost:11434/v1',
    priority: 5,
    status: 'standby',
    latency: '3.5s',
    successRate: '99.9%',
  },
]

const protocolModelCounts: Record<Protocol, number> = {
  openai: 5,
  anthropic: 3,
  gemini: 2,
}

const statusBadgeVariant: Record<BindingStatus, 'info' | 'success' | 'warning' | 'destructive' | 'muted'> = {
  active: 'info',
  standby: 'success',
  warning: 'warning',
  cooling: 'destructive',
  disabled: 'muted',
}

const statusLabel: Record<BindingStatus, string> = {
  active: '当前使用',
  standby: '待命',
  warning: '延迟高',
  cooling: '冷却中',
  disabled: '已禁用',
}

export default function QueuePage() {
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')
  const [manualBinding, setManualBinding] = useState<string>('')
  const [protocol, setProtocol] = useState<Protocol>('openai')
  const [copied, setCopied] = useState(false)

  const queueModelName = 'default'
  const isDefaultQueue = queueModelName === 'default'

  const currentProtocol = PROTOCOLS.find(p => p.key === protocol)!
  const availableCount = protocolModelCounts[protocol]
  const proxyBase = 'http://127.0.0.1:9300'
  const fullProxyUrl = `${proxyBase}${currentProtocol.path}`

  const copyEndpoint = () => {
    if (availableCount <= 0) return
    navigator.clipboard.writeText(fullProxyUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const copyModelName = () => {
    navigator.clipboard.writeText(queueModelName)
  }

  const handleSwitchToManual = () => {
    const active = bindings.find(b => b.status === 'active')
    if (active) setManualBinding(active.id)
    setMode('manual')
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">模型队列</h1>
        <p className="text-sm text-muted-foreground mt-1">管理请求优先级和故障转移策略</p>
      </div>

      {/* 服务接入配置 */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Server size={20} />
              </div>
              <div>
                <CardTitle className="text-base">服务接入配置</CardTitle>
                <CardDescription className="mt-1">
                  将你的应用请求地址指向下方代理地址即可使用
                </CardDescription>
              </div>
            </div>
            <Badge variant="success" className="gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
              运行中
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 代理地址 */}
            <div className="md:col-span-2 space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">
                <Plug size={12} className="inline mr-1 -mt-0.5" />
                代理地址
              </Label>
              <div className="flex items-stretch gap-2">
                <div className="relative flex-1">
                  <Input
                    readOnly
                    value={fullProxyUrl}
                    className={cn(
                      'pr-24 font-mono text-sm h-10',
                      availableCount <= 0 && 'opacity-50 bg-muted'
                    )}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 gap-1 px-2 text-xs font-medium"
                      >
                        {currentProtocol.label}
                        <ChevronDownIcon size={12} className="opacity-60" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      {PROTOCOLS.map(p => {
                        const count = protocolModelCounts[p.key]
                        const disabled = count <= 0
                        return (
                          <DropdownMenuItem
                            key={p.key}
                            disabled={disabled}
                            onClick={() => !disabled && setProtocol(p.key)}
                            className="flex items-center justify-between"
                          >
                            <span>{p.label}</span>
                            <span className="text-xs text-muted-foreground">
                              {count} 个模型可用
                            </span>
                          </DropdownMenuItem>
                        )
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={copyEndpoint}
                  disabled={availableCount <= 0}
                  className="shrink-0"
                >
                  <Copy size={14} />
                  {copied ? '已复制' : '复制'}
                </Button>
              </div>
            </div>

            {/* API Key */}
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">
                <KeyRound size={12} className="inline mr-1 -mt-0.5" />
                API Key
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value="无需配置，本地服务"
                  className="font-mono text-sm h-10 bg-muted"
                />
                <Badge variant="success" className="shrink-0">免认证</Badge>
              </div>
            </div>
          </div>

          {/* 使用提示 */}
          <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            <Lightbulb size={16} className="shrink-0 mt-0.5 text-warning" />
            <span>
              使用方式：将客户端的 <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs">baseURL</code> 设置为上方代理地址，
              模型名称填写下方队列的逻辑模型名即可。
              所有请求会自动按优先级队列进行故障转移。
            </span>
          </div>
        </CardContent>
      </Card>

      {/* 状态卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <BarChart3 size={16} />
              今日请求
            </div>
            <div className="text-2xl font-bold">1,284</div>
            <div className="text-xs text-success mt-1">+12.5% 较昨日</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <CheckCircle2 size={16} />
              成功率
            </div>
            <div className="text-2xl font-bold">99.2%</div>
            <div className="text-xs text-success mt-1">+0.3% 较昨日</div>
          </CardContent>
        </Card>
      </div>

      {/* 优先级队列 */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <CardTitle className="text-base">优先级队列</CardTitle>
                {isDefaultQueue ? (
                  <Badge variant="secondary" className="font-normal">
                    默认队列 · 任意模型
                  </Badge>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <code className="px-2 py-0.5 rounded bg-muted font-mono text-sm">
                      {queueModelName}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={copyModelName}
                      title="复制模型名"
                    >
                      <Copy size={12} />
                    </Button>
                  </div>
                )}
              </div>
              <CardDescription className="mt-1.5">
                拖拽调整优先级顺序，数字越小优先级越高
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Tabs value={mode} onValueChange={v => v === 'auto' ? setMode('auto') : handleSwitchToManual()}>
                <TabsList className="h-8">
                  <TabsTrigger value="auto" className="h-7 px-3 text-xs gap-1.5">
                    <RefreshCw size={13} />
                    自动转移
                  </TabsTrigger>
                  <TabsTrigger value="manual" className="h-7 px-3 text-xs gap-1.5">
                    <Target size={13} />
                    手动指定
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <Button variant="outline" size="sm">
                <Plus size={14} /> 添加绑定
              </Button>
              <Button size="sm">
                <Activity size={14} /> 测试全部
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {bindings.map((b, idx) => (
              <div
                key={b.id}
                onClick={() => {
                  if (mode === 'manual' && b.status !== 'cooling') {
                    setManualBinding(manualBinding === b.id ? '' : b.id)
                  }
                }}
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-3 transition-all',
                  b.status === 'active' && 'border-primary bg-primary/5 shadow-[0_0_0_3px_rgba(37,99,235,0.08)]',
                  b.status === 'cooling' && 'opacity-60',
                  mode === 'manual' && b.status !== 'cooling' && 'cursor-pointer hover:border-primary/50',
                  mode === 'manual' && manualBinding === b.id && 'border-primary bg-primary/5'
                )}
              >
                {/* 选择/拖拽 */}
                {mode === 'manual' ? (
                  <div className="shrink-0">
                    {manualBinding === b.id ? (
                      <CircleDot size={18} className="text-primary" />
                    ) : (
                      <Circle size={18} className="text-muted-foreground/40" />
                    )}
                  </div>
                ) : (
                  <div className="shrink-0 text-muted-foreground/40 cursor-grab">
                    <GripVertical size={16} />
                  </div>
                )}

                {/* 序号 */}
                <div
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold',
                    b.status === 'active'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {idx + 1}
                </div>

                {/* 信息 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'font-medium text-sm truncate',
                      b.status === 'active' && 'text-primary font-semibold'
                    )}>
                      {b.provider}
                    </span>
                    <span className="text-xs text-muted-foreground truncate font-mono">
                      {b.model}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span>协议: {b.protocol}</span>
                    <span>延迟: {b.latency}</span>
                    <span>成功率: {b.successRate}</span>
                    {b.status === 'cooling' && b.cooldownRemain && (
                      <span className="text-destructive">冷却剩余: {b.cooldownRemain}</span>
                    )}
                  </div>
                </div>

                {/* 状态徽章 */}
                <Badge variant={statusBadgeVariant[b.status]} className="shrink-0">
                  {statusLabel[b.status]}
                </Badge>

                {/* 操作按钮 */}
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8" title="上移">
                    <ChevronUp size={15} />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" title="下移">
                    <ChevronDown size={15} />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" title="编辑">
                    <Pencil size={15} />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" title="测试连接">
                    <Plug size={15} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 转移策略 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">转移策略</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fail-threshold">连续失败阈值</Label>
              <Input id="fail-threshold" defaultValue={3} type="number" />
              <p className="text-xs text-muted-foreground">达到此次数后进入冷却</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cooldown-base">冷却基础时间</Label>
              <Input id="cooldown-base" defaultValue={30} type="number" />
              <p className="text-xs text-muted-foreground">初始冷却时间（秒）</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cooldown-max">冷却最大时间</Label>
              <Input id="cooldown-max" defaultValue={300} type="number" />
              <p className="text-xs text-muted-foreground">冷却时间上限（秒）</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="idle-timeout">空闲超时</Label>
              <Input id="idle-timeout" defaultValue={30000} type="number" />
              <p className="text-xs text-muted-foreground">服务端连续无数据返回的超时时间（毫秒）</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="conn-timeout">连接超时</Label>
              <Input id="conn-timeout" defaultValue={10000} type="number" />
              <p className="text-xs text-muted-foreground">建立连接的超时时间（毫秒）</p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertTriangle size={16} className="text-warning" />
              <span>修改转移策略会立即生效，当前进行中的请求不受影响</span>
            </div>
            <Button>保存设置</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
