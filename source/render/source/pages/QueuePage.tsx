import { type ReactNode, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'

type Protocol = 'openai-completions' | 'openai-responses' | 'anthropic-messages'

const PROXY_BASE_URL = 'http://127.0.0.1:9300'

const PROTOCOLS: { key: Protocol; label: string; path: string }[] = [
  { key: 'openai-completions', label: 'OpenAI Completions', path: '/v1/completions' },
  { key: 'openai-responses', label: 'OpenAI Responses', path: '/v1/responses' },
  { key: 'anthropic-messages', label: 'Anthropic Messages', path: '/v1/messages' },
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

const initialBindings: Binding[] = [
  {
    id: 'bind_001',
    provider: 'OpenAI',
    model: 'gpt-4o',
    protocol: 'openai-responses',
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
    protocol: 'anthropic-messages',
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
    protocol: 'openai-completions',
    upstream: 'https://api.deepseek.com/v1',
    priority: 3,
    status: 'warning',
    latency: '5.8s',
    successRate: '97.2%',
  },
  {
    id: 'bind_004',
    provider: 'Ollama (本地)',
    model: 'qwen2.5:72b',
    protocol: 'openai-completions',
    upstream: 'http://localhost:11434/v1',
    priority: 4,
    status: 'standby',
    latency: '3.5s',
    successRate: '99.9%',
  },
]

const protocolModelCounts: Record<Protocol, number> = {
  'openai-completions': 5,
  'openai-responses': 4,
  'anthropic-messages': 3,
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

const providerOptions = [
  { name: 'OpenAI Completions', protocol: 'openai-completions', upstream: 'https://api.openai.com/v1' },
  { name: 'OpenAI Responses', protocol: 'openai-responses', upstream: 'https://api.openai.com/v1' },
  { name: 'Anthropic Messages', protocol: 'anthropic-messages', upstream: 'https://api.anthropic.com/v1' },
  { name: 'DeepSeek', protocol: 'openai-completions', upstream: 'https://api.deepseek.com/v1' },
  { name: 'Ollama (本地)', protocol: 'openai-completions', upstream: 'http://localhost:11434/v1' },
]

interface SortableBindingProps {
  id: string
  children: (handleProps: Record<string, unknown>, dragging: boolean) => ReactNode
}

function SortableBinding(props: SortableBindingProps) {
  const { id, children } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('relative bg-card', isDragging && 'z-10 shadow-md')}
    >
      {children({ ...attributes, ...listeners }, isDragging)}
    </div>
  )
}

export default function QueuePage() {
  const [bindingItems, setBindingItems] = useState(initialBindings)
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')
  const [manualBinding, setManualBinding] = useState<string>('')
  const [protocol, setProtocol] = useState<Protocol>('openai-responses')
  const [copied, setCopied] = useState(false)
  const [bindingDialogOpen, setBindingDialogOpen] = useState(false)
  const [bindingProvider, setBindingProvider] = useState(providerOptions[0].name)
  const [bindingProtocol, setBindingProtocol] = useState(providerOptions[0].protocol)
  const [bindingModel, setBindingModel] = useState('')
  const [bindingUpstream, setBindingUpstream] = useState(providerOptions[0].upstream)
  const [bindingEnabled, setBindingEnabled] = useState(true)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const queueModelName = 'default'
  const isDefaultQueue = queueModelName === 'default'

  const currentProtocol = PROTOCOLS.find(p => p.key === protocol)!
  const availableCount = protocolModelCounts[protocol]
  const fullProxyUrl = `${PROXY_BASE_URL}${currentProtocol.path}`

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
    const active = bindingItems.find(b => b.status === 'active')
    if (active) setManualBinding(active.id)
    setMode('manual')
  }

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    setBindingItems(current => {
      const oldIndex = current.findIndex(binding => binding.id === active.id)
      const newIndex = current.findIndex(binding => binding.id === over.id)
      return arrayMove(current, oldIndex, newIndex).map((binding, index) => ({ ...binding, priority: index + 1 }))
    })
  }

  const handleProviderChange = (providerName: string) => {
    const provider = providerOptions.find(option => option.name === providerName)!
    setBindingProvider(provider.name)
    setBindingProtocol(provider.protocol)
    setBindingUpstream(provider.upstream)
  }

  const openBindingDialog = () => {
    handleProviderChange(providerOptions[0].name)
    setBindingModel('')
    setBindingEnabled(true)
    setBindingDialogOpen(true)
  }

  const addBinding = () => {
    if (!bindingModel.trim() || !bindingUpstream.trim()) return
    setBindingItems(current => [
      ...current,
      {
        id: `bind_${Date.now()}`,
        provider: bindingProvider,
        model: bindingModel.trim(),
        protocol: bindingProtocol,
        upstream: bindingUpstream.trim(),
        priority: current.length + 1,
        status: bindingEnabled ? 'standby' : 'disabled',
        latency: '-',
        successRate: '-',
      },
    ])
    setBindingDialogOpen(false)
  }

  return (
    <PageLayout>
      <PageHeader title="模型队列" description="管理请求优先级和故障转移策略" />
      <PageContent>

      {/* 服务接入配置 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Server size={16} />
              </div>
              <div>
                <CardTitle>服务接入配置</CardTitle>
                <CardDescription className="mt-0.5">
                  将应用请求地址指向下方代理地址即可使用
                </CardDescription>
              </div>
            </div>
            <Badge variant="success" className="gap-1 h-5 px-1.5 text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
              运行中
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* 代理地址 */}
            <div className="md:col-span-2 space-y-1.5">
              <Label className="text-[11px] font-medium text-muted-foreground">
                <Plug size={11} className="inline mr-1 -mt-0.5" />
                代理地址
              </Label>
              <div className="flex items-stretch gap-2">
                <div className="relative flex-1">
                  <Input
                    readOnly
                    value={fullProxyUrl}
                    className={cn(
                      'pr-20 font-mono text-xs h-8',
                      availableCount <= 0 && 'opacity-50 bg-muted'
                    )}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute right-0.5 top-1/2 -translate-y-1/2 h-6 gap-0.5 px-1.5 text-[11px] font-medium"
                      >
                        {currentProtocol.label}
                        <ChevronDownIcon size={11} className="opacity-60" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-80">
                      {PROTOCOLS.map(p => {
                        const count = protocolModelCounts[p.key]
                        const disabled = count <= 0
                        const protocolUrl = `${PROXY_BASE_URL}${p.path}`
                        return (
                          <DropdownMenuItem
                            key={p.key}
                            disabled={disabled}
                            onClick={() => !disabled && setProtocol(p.key)}
                            className="flex items-start justify-between gap-3 py-2 text-xs"
                          >
                            <span className="min-w-0">
                              <span className="block font-medium">{p.label}</span>
                              <span className="block truncate font-mono text-[11px] text-muted-foreground">
                                {protocolUrl}
                              </span>
                            </span>
                            <span className="shrink-0 text-[11px] text-muted-foreground">{count} 个模型</span>
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
                  className="shrink-0 h-8 px-2.5 text-xs"
                >
                  <Copy size={13} />
                  {copied ? '已复制' : '复制'}
                </Button>
              </div>
            </div>

            {/* API Key */}
            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium text-muted-foreground">
                <KeyRound size={11} className="inline mr-1 -mt-0.5" />
                API Key
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value="无需配置，本地服务"
                  className="font-mono text-xs h-8 bg-muted flex-1"
                />
                <Badge variant="success" className="shrink-0 h-5 px-1.5 text-[11px]">免认证</Badge>
              </div>
            </div>
          </div>

          {/* 使用提示 */}
          <div className="flex items-start gap-2 rounded-sm border border-l-2 border-l-warning bg-muted/30 p-2.5 text-xs text-muted-foreground">
            <Lightbulb size={14} className="shrink-0 mt-0.5 text-warning" />
            <span>
              使用方式：将客户端的 <code className="px-1 py-0.5 rounded bg-muted font-mono text-[11px]">baseURL</code> 设置为上方代理地址，
              模型名称填写下方队列的逻辑模型名即可。所有请求会自动按优先级队列进行故障转移。
            </span>
          </div>
        </CardContent>
      </Card>

      {/* 状态指标 - 线条分隔 */}
      <div className="grid grid-cols-2 gap-0 rounded-md border">
        <div className="p-3 border-r">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
            <BarChart3 size={13} />
            今日请求
          </div>
          <div className="text-xl font-semibold tabular-nums">1,284</div>
          <div className="text-[11px] text-success mt-0.5">+12.5% 较昨日</div>
        </div>
        <div className="p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
            <CheckCircle2 size={13} />
            成功率
          </div>
          <div className="text-xl font-semibold tabular-nums">99.2%</div>
          <div className="text-[11px] text-success mt-0.5">+0.3% 较昨日</div>
        </div>
      </div>

      {/* 优先级队列 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle>优先级队列</CardTitle>
                {isDefaultQueue ? (
                  <Badge variant="secondary" className="font-normal h-5 px-1.5 text-[11px]">
                    默认队列 · 任意模型
                  </Badge>
                ) : (
                  <div className="flex items-center gap-1">
                    <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">
                      {queueModelName}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={copyModelName}
                      title="复制模型名"
                    >
                      <Copy size={11} />
                    </Button>
                  </div>
                )}
              </div>
              <CardDescription className="mt-0.5">
                拖拽调整优先级顺序，数字越小优先级越高
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Tabs value={mode} onValueChange={v => v === 'auto' ? setMode('auto') : handleSwitchToManual()}>
                <TabsList className="h-7">
                  <TabsTrigger value="auto" className="h-6 px-2.5 text-[11px] gap-1">
                    <RefreshCw size={12} />
                    自动转移
                  </TabsTrigger>
                  <TabsTrigger value="manual" className="h-6 px-2.5 text-[11px] gap-1">
                    <Target size={12} />
                    手动指定
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={openBindingDialog}>
                <Plus size={13} /> 添加模型
              </Button>
              <Button size="sm" className="h-7 px-2 text-xs">
                <Activity size={13} /> 测试全部
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={bindingItems.map(binding => binding.id)} strategy={verticalListSortingStrategy}>
              <div className="-mx-4 divide-y">
                {bindingItems.map((b, idx) => (
                  <SortableBinding key={b.id} id={b.id}>
                    {(handleProps, dragging) => (
                      <div
                        onClick={() => {
                          if (mode === 'manual' && b.status !== 'cooling') {
                            setManualBinding(manualBinding === b.id ? '' : b.id)
                          }
                        }}
                        className={cn(
                          'flex items-center gap-2 border-l-2 px-4 py-2 transition-colors',
                          b.status === 'active' && 'border-l-primary bg-primary/5',
                          b.status !== 'active' && 'border-l-transparent',
                          b.status === 'cooling' && 'opacity-60',
                          mode === 'manual' && b.status !== 'cooling' && 'cursor-pointer hover:bg-muted/50',
                          mode === 'manual' && manualBinding === b.id && 'border-l-primary bg-primary/5',
                          dragging && 'bg-muted/60',
                        )}
                      >
                {/* 选择/拖拽 */}
                {mode === 'manual' ? (
                  <div className="shrink-0">
                    {manualBinding === b.id ? (
                      <CircleDot size={16} className="text-primary" />
                    ) : (
                      <Circle size={16} className="text-muted-foreground/40" />
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    aria-label={`拖动 ${b.provider} 调整优先级`}
                    className="shrink-0 cursor-grab touch-none rounded-sm p-0.5 text-muted-foreground/50 hover:bg-muted hover:text-foreground active:cursor-grabbing"
                    {...handleProps}
                  >
                    <GripVertical size={14} />
                  </button>
                )}

                {/* 序号 */}
                <div
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-[11px] font-semibold',
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
                      'font-medium text-xs truncate',
                      b.status === 'active' && 'text-primary font-semibold'
                    )}>
                      {b.provider}
                    </span>
                    <span className="text-[11px] text-muted-foreground truncate font-mono">
                      {b.model}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
                    <span>协议: {b.protocol}</span>
                    <span>延迟: {b.latency}</span>
                    <span>成功率: {b.successRate}</span>
                    {b.status === 'cooling' && b.cooldownRemain && (
                      <span className="text-destructive">冷却: {b.cooldownRemain}</span>
                    )}
                  </div>
                </div>

                {/* 状态徽章 */}
                <Badge variant={statusBadgeVariant[b.status]} className="shrink-0 h-5 px-1.5 text-[11px]">
                  {statusLabel[b.status]}
                </Badge>

                {/* 操作按钮 */}
                <div className="flex items-center gap-0 shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="编辑">
                    <Pencil size={13} />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="测试连接">
                    <Plug size={13} />
                  </Button>
                </div>
                      </div>
                    )}
                  </SortableBinding>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </CardContent>
      </Card>

      {/* 转移策略 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>转移策略</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="fail-threshold" className="text-xs">连续失败阈值</Label>
              <Input id="fail-threshold" defaultValue={3} type="number" className="h-8 text-xs" placeholder="例如：3" />
              <p className="text-[11px] text-muted-foreground">达到此次数后进入冷却</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cooldown-base" className="text-xs">冷却基础时间</Label>
              <Input id="cooldown-base" defaultValue={30} type="number" className="h-8 text-xs" placeholder="例如：30" />
              <p className="text-[11px] text-muted-foreground">初始冷却时间（秒）</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cooldown-max" className="text-xs">冷却最大时间</Label>
              <Input id="cooldown-max" defaultValue={300} type="number" className="h-8 text-xs" placeholder="例如：300" />
              <p className="text-[11px] text-muted-foreground">冷却时间上限（秒）</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="idle-timeout" className="text-xs">空闲超时</Label>
              <Input id="idle-timeout" defaultValue={30000} type="number" className="h-8 text-xs" placeholder="例如：30000" />
              <p className="text-[11px] text-muted-foreground">服务端连续无数据返回的超时时间（毫秒）</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="conn-timeout" className="text-xs">连接超时</Label>
              <Input id="conn-timeout" defaultValue={10000} type="number" className="h-8 text-xs" placeholder="例如：10000" />
              <p className="text-[11px] text-muted-foreground">建立连接的超时时间（毫秒）</p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle size={13} className="text-warning" />
              <span>修改转移策略会立即生效，当前进行中的请求不受影响</span>
            </div>
            <Button className="h-8 px-3 text-xs">保存设置</Button>
          </div>
        </CardContent>
      </Card>
      </PageContent>

      <Dialog open={bindingDialogOpen} onOpenChange={setBindingDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>添加模型</DialogTitle>
            <DialogDescription>选择供应商和上游模型，将其加入当前优先级队列。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="binding-provider">供应商</Label>
                <Select
                  value={bindingProvider}
                  onValueChange={handleProviderChange}
                >
                  <SelectTrigger id="binding-provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {providerOptions.map(provider => (
                      <SelectItem key={provider.name} value={provider.name}>{provider.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="binding-protocol">请求协议</Label>
                <Select
                  value={bindingProtocol}
                  onValueChange={setBindingProtocol}
                >
                  <SelectTrigger id="binding-protocol">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai-completions">OpenAI Completions</SelectItem>
                    <SelectItem value="openai-responses">OpenAI Responses</SelectItem>
                    <SelectItem value="anthropic-messages">Anthropic Messages</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="binding-model">上游模型 ID</Label>
              <Input
                id="binding-model"
                value={bindingModel}
                onChange={event => setBindingModel(event.target.value)}
                placeholder="例如：gpt-4o"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="binding-upstream">完整接口地址</Label>
              <Input
                id="binding-upstream"
                type="url"
                value={bindingUpstream}
                onChange={event => setBindingUpstream(event.target.value)}
                placeholder="https://api.example.com/v1/chat/completions"
                className="font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground">请求会直接发送到该地址，可覆盖供应商的默认地址。</p>
            </div>
            <div className="flex items-center justify-between rounded-sm border bg-muted/20 px-3 py-2.5">
              <div>
                <Label htmlFor="binding-enabled">立即启用</Label>
                <p className="mt-1 text-[11px] text-muted-foreground">启用后作为队列最后一个备用绑定。</p>
              </div>
              <Switch id="binding-enabled" checked={bindingEnabled} onCheckedChange={setBindingEnabled} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBindingDialogOpen(false)}>取消</Button>
            <Button disabled={!bindingModel.trim() || !bindingUpstream.trim()} onClick={addBinding}>添加模型</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  )
}
