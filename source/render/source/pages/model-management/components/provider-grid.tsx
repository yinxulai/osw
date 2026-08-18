import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Server } from 'lucide-react'
import type { Provider, UpstreamModel, ProviderHealth } from '@common/schemas'

interface ProviderGridProps {
  providers: Provider[]
  models: UpstreamModel[]
  health: Record<string, ProviderHealth>
  selectedProviderId: string
  onSelect: (id: string) => void
}

function getProviderState(provider: Provider, health?: ProviderHealth) {
  if (!provider.enabled) return { label: '已禁用', variant: 'muted' as const, dot: 'bg-muted-foreground/30' }
  if (health?.cooldownUntilTime && health.cooldownUntilTime > Date.now()) {
    return { label: '冷却中', variant: 'destructive' as const, dot: 'bg-destructive' }
  }
  if (health?.consecutiveFailures) return { label: '连接异常', variant: 'warning' as const, dot: 'bg-warning' }
  return { label: '可用', variant: 'success' as const, dot: 'bg-success' }
}

export function ProviderGrid(props: ProviderGridProps) {
  const { providers, models, health, selectedProviderId, onSelect } = props

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>供应商</CardTitle>
        <CardDescription>
          密钥按供应商保存，可为每个协议配置默认接口地址，模型可单独覆盖。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {providers.length ? (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
            {providers.map(provider => {
              const state = getProviderState(provider, health[provider.id])
              const modelCount = new Set(
                models.filter(model => model.providerId === provider.id).map(model => model.upstreamModelId),
              ).size
              return (
                <button
                  key={provider.id}
                  onClick={() => onSelect(provider.id)}
                  className={cn(
                    'min-w-0 rounded-md border px-3 py-2.5 text-left transition-colors',
                    selectedProviderId === provider.id
                      ? 'border-primary bg-primary/[0.06] outline outline-1 outline-primary/15'
                      : 'hover:bg-muted/50',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className={cn('h-2 w-2 rounded-full', state.dot)} />
                    <span className="truncate text-xs font-medium">{provider.name}</span>
                  </span>
                  <span className="mt-1.5 block text-[10px] text-muted-foreground">
                    {modelCount} 个模型
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <EmptyState
            icon={Server}
            title="还没有供应商"
            description="创建供应商并配置凭据后，即可添加上游模型与协议地址。"
            className="min-h-36 py-6"
            embedded
          />
        )}
      </CardContent>
    </Card>
  )
}
