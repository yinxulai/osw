import { useState } from 'react'
import {
  Plug,
  Key,
  Lightbulb,
  Search,
  Plus,
  Pencil,
  Trash2,
  Activity,
  Server,
  Clock,
  Link2,
  GripVertical,
  ChevronUp,
  ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'

type ProviderStatus = 'healthy' | 'warning' | 'cooling' | 'disabled'
type ModelStatus = 'active' | 'standby' | 'warning' | 'cooling' | 'disabled'

interface Provider {
  id: string
  name: string
  apiKeyRef: string
  baseUrl: string
  timeout: number
  enabled: boolean
  status: ProviderStatus
  latency: string
  createdTime: string
}

interface ProviderModel {
  id: string
  name: string
  upstreamModel: string
  protocol: string
  priority: number
  status: ModelStatus
  latency: string
  successRate: string
}

const providers: Provider[] = [
  { id: 'prov_001', name: 'OpenAI', apiKeyRef: 'key_openai_abc123', baseUrl: 'https://api.openai.com/v1', timeout: 30000, enabled: true, status: 'healthy', latency: '1.2s', createdTime: '2024-01-15 10:30' },
  { id: 'prov_002', name: 'Anthropic', apiKeyRef: 'key_anthropic_def456', baseUrl: 'https://api.anthropic.com/v1', timeout: 30000, enabled: true, status: 'healthy', latency: '2.1s', createdTime: '2024-01-16 14:20' },
  { id: 'prov_003', name: 'DeepSeek', apiKeyRef: 'key_deepseek_ghi789', baseUrl: 'https://api.deepseek.com/v1', timeout: 60000, enabled: true, status: 'warning', latency: '5.8s', createdTime: '2024-01-18 09:15' },
  { id: 'prov_004', name: 'Gemini', apiKeyRef: 'key_gemini_jkl012', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', timeout: 30000, enabled: true, status: 'cooling', latency: '-', createdTime: '2024-01-20 16:45' },
  { id: 'prov_005', name: 'Ollama (本地)', apiKeyRef: '', baseUrl: 'http://localhost:11434/v1', timeout: 120000, enabled: true, status: 'healthy', latency: '3.5s', createdTime: '2024-01-22 08:00' },
]

const providerModels: Record<string, ProviderModel[]> = {
  'prov_001': [
    { id: 'm_001', name: '默认模型', upstreamModel: 'gpt-4o', protocol: 'OpenAI', priority: 1, status: 'active', latency: '1.2s', successRate: '99.8%' },
    { id: 'm_002', name: '代码模型', upstreamModel: 'gpt-4o', protocol: 'OpenAI', priority: 2, status: 'standby', latency: '1.2s', successRate: '99.8%' },
    { id: 'm_003', name: '快速模型', upstreamModel: 'gpt-4o-mini', protocol: 'OpenAI', priority: 3, status: 'standby', latency: '0.6s', successRate: '99.9%' },
  ],
  'prov_002': [
    { id: 'm_004', name: '默认模型', upstreamModel: 'claude-3-5-sonnet-20240620', protocol: 'OpenAI', priority: 2, status: 'standby', latency: '2.1s', successRate: '99.5%' },
    { id: 'm_005', name: '长文本模型', upstreamModel: 'claude-3-opus-20240229', protocol: 'OpenAI', priority: 5, status: 'standby', latency: '3.8s', successRate: '99.0%' },
  ],
  'prov_003': [
    { id: 'm_006', name: '默认模型', upstreamModel: 'deepseek-chat', protocol: 'OpenAI', priority: 3, status: 'warning', latency: '5.8s', successRate: '97.2%' },
  ],
  'prov_004': [
    { id: 'm_007', name: '图像模型', upstreamModel: 'gemini-1.5-pro-002', protocol: 'OpenAI', priority: 4, status: 'cooling', latency: '-', successRate: '-' },
  ],
  'prov_005': [
    { id: 'm_008', name: '本地模型', upstreamModel: 'qwen2.5:72b', protocol: 'OpenAI', priority: 5, status: 'standby', latency: '3.5s', successRate: '99.9%' },
  ],
}

const statusDotColor: Record<ProviderStatus, string> = {
  healthy: 'bg-success',
  warning: 'bg-warning',
  cooling: 'bg-destructive',
  disabled: 'bg-muted-foreground/30',
}

const providerStatusBadge: Record<ProviderStatus, { variant: 'success' | 'warning' | 'destructive' | 'muted'; label: string }> = {
  healthy: { variant: 'success', label: '正常' },
  warning: { variant: 'warning', label: '延迟高' },
  cooling: { variant: 'destructive', label: '冷却中' },
  disabled: { variant: 'muted', label: '已禁用' },
}

const modelStatusBadge: Record<ModelStatus, { variant: 'info' | 'success' | 'warning' | 'destructive' | 'muted'; label: string }> = {
  active: { variant: 'info', label: '当前使用' },
  standby: { variant: 'success', label: '待命' },
  warning: { variant: 'warning', label: '延迟高' },
  cooling: { variant: 'destructive', label: '冷却中' },
  disabled: { variant: 'muted', label: '已禁用' },
}

export default function ProvidersPage() {
  const [selectedId, setSelectedId] = useState('prov_001')
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const filtered = providers.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  )
  const selected = providers.find(p => p.id === selectedId)
  const models = providerModels[selectedId] || []

  const modelsOf = (id: string) => providerModels[id]?.length || 0

  const handleEdit = (id: string) => {
    setEditingId(id)
    setShowModal(true)
  }
  const handleNew = () => {
    setEditingId(null)
    setShowModal(true)
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">供应商</h1>
        <p className="text-xs text-muted-foreground mt-0.5">管理上游服务供应商和模型配置</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
        {/* 左侧：供应商列表 */}
        <Card className="h-fit">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle>供应商</CardTitle>
              <Button size="sm" onClick={handleNew} className="h-7 px-2 text-xs">
                <Plus size={13} /> 新建
              </Button>
            </div>
            <div className="relative mt-2">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-0.5 -mx-2">
              {filtered.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 text-left transition-colors border-l-2',
                    selectedId === p.id
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-transparent hover:bg-muted'
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {modelsOf(p.id)} 模型 · {p.latency}
                    </div>
                  </div>
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusDotColor[p.status])} />
                </button>
              ))}
            </div>
            {filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Plug size={24} className="text-muted-foreground/40 mb-1.5" />
                <p className="text-xs text-muted-foreground">没有找到匹配的供应商</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 右侧：详情 */}
        <div className="space-y-4">
          {selected ? (
            <>
              {/* 供应商信息 */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Server size={16} />
                      </div>
                      <div>
                        <CardTitle>{selected.name}</CardTitle>
                        <CardDescription className="mt-0.5">供应商配置信息</CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={providerStatusBadge[selected.status].variant} className="h-5 px-1.5 text-[11px]">
                        {providerStatusBadge[selected.status].label}
                      </Badge>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                        <Activity size={13} /> 测试
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleEdit(selected.id)} className="h-7 px-2 text-xs">
                        <Pencil size={13} /> 编辑
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Plug size={11} /> 基础地址
                      </Label>
                      <div className="font-mono text-xs bg-muted rounded-sm px-2.5 py-1.5 break-all">
                        {selected.baseUrl}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Key size={11} /> API Key
                      </Label>
                      <div className="text-xs h-7 flex items-center">
                        {selected.apiKeyRef ? (
                          <span>已配置 · 钥匙串存储</span>
                        ) : (
                          <span className="text-muted-foreground">未配置（本地服务）</span>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Clock size={11} /> 请求超时
                      </Label>
                      <div className="text-xs h-7 flex items-center">
                        {selected.timeout / 1000} 秒
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Activity size={11} /> 状态
                      </Label>
                      <div className="text-xs h-7 flex items-center">
                        {selected.enabled ? '已启用' : '已禁用'} · 延迟 {selected.latency}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* 模型列表 */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-1.5">
                        <Link2 size={14} className="text-primary" />
                        已配置模型
                      </CardTitle>
                      <CardDescription className="mt-0.5">
                        共 {models.length} 个上游模型绑定
                      </CardDescription>
                    </div>
                    <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
                      <Plus size={13} /> 添加模型
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {models.length > 0 ? (
                    <div className="divide-y -mx-4">
                      {models.map((m, idx) => (
                        <div
                          key={m.id}
                          className={cn(
                            'flex items-center gap-2 px-4 py-2',
                            m.status === 'cooling' && 'opacity-60'
                          )}
                        >
                          <div className="text-muted-foreground/40 cursor-grab shrink-0">
                            <GripVertical size={14} />
                          </div>
                          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground text-[11px] font-semibold">
                            {idx + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium">
                              {m.name}
                              <span className="text-muted-foreground font-normal ml-1.5 font-mono text-[11px]">
                                → {m.upstreamModel}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
                              <span>协议: {m.protocol}</span>
                              <span>延迟: {m.latency}</span>
                              <span>成功率: {m.successRate}</span>
                            </div>
                          </div>
                          <Badge variant={modelStatusBadge[m.status].variant} className="shrink-0 h-5 px-1.5 text-[11px]">
                            {modelStatusBadge[m.status].label}
                          </Badge>
                          <div className="flex items-center gap-0 shrink-0">
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="上移">
                              <ChevronUp size={13} />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="下移">
                              <ChevronDown size={13} />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="编辑">
                              <Pencil size={13} />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="测试">
                              <Activity size={13} />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="删除">
                              <Trash2 size={13} />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <Link2 size={24} className="text-muted-foreground/40 mb-1.5" />
                      <p className="text-xs text-muted-foreground mb-2.5">该供应商暂无配置模型</p>
                      <Button size="sm" className="h-7 px-2.5 text-xs">
                        <Plus size={13} /> 添加第一个模型
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="flex items-center justify-center py-16">
              <div className="text-center">
                <Plug size={32} className="text-muted-foreground/40 mx-auto mb-1.5" />
                <p className="text-xs text-muted-foreground">选择一个供应商查看详情</p>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* 新建/编辑供应商弹窗 */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? '编辑供应商' : '新建供应商'}</DialogTitle>
            <DialogDescription>
              配置上游服务的连接信息和认证凭据
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="prov-name">供应商名称</Label>
              <Input id="prov-name" defaultValue={editingId ? 'OpenAI' : ''} placeholder="例如：OpenAI" />
              <p className="text-xs text-muted-foreground">用于识别和展示的显示名称</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="prov-url">基础地址 (Base URL)</Label>
              <Input id="prov-url" defaultValue={editingId ? 'https://api.openai.com/v1' : ''} placeholder="https://api.example.com/v1" />
              <p className="text-xs text-muted-foreground">API 请求的基础地址</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="prov-key">API Key</Label>
              <div className="flex gap-2">
                <Input id="prov-key" type="password" placeholder="sk-..." defaultValue={editingId ? '••••••••••••' : ''} />
                <Button variant="outline">更换</Button>
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Key size={12} /> API Key 安全存储在系统钥匙串中，数据库只保存引用 ID
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="prov-timeout">请求超时</Label>
                <Input id="prov-timeout" type="number" defaultValue={30000} />
                <p className="text-xs text-muted-foreground">毫秒</p>
              </div>
              <div className="space-y-2">
                <Label>启用状态</Label>
                <div className="h-10 flex items-center">
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-9 rounded-full bg-primary relative cursor-pointer">
                      <div className="absolute right-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm" />
                    </div>
                    <span className="text-sm text-muted-foreground">启用此供应商</span>
                  </div>
                </div>
              </div>
            </div>
            <Separator />
            <div className="text-sm text-muted-foreground space-y-1.5">
              <div className="font-medium text-foreground flex items-center gap-1.5">
                <Lightbulb size={14} className="text-warning" /> 提示
              </div>
              <p className="text-xs leading-relaxed">
                供应商只负责连接配置和认证信息。
                你需要在「已配置模型」中添加具体的上游模型，才能在逻辑模型队列中使用。
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>取消</Button>
            <Button onClick={() => setShowModal(false)}>
              {editingId ? '保存修改' : '创建供应商'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
