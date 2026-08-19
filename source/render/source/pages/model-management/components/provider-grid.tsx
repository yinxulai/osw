import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Server } from 'lucide-react'
import { ProviderIcon } from './provider-icon'
import { findPresetByName } from '../lib/provider-presets'
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
    <Card className="h-fit overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle>供应商</CardTitle>
        <CardDescription>
          密钥按供应商保存，可为每个协议配置默认接口地址，模型可单独覆盖。
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {providers.length ? (
          <div className="divide-y">
            {providers.map(provider => {
              const state = getProviderState(provider, health[provider.id])
              const modelCount = new Set(
                models.filter(model => model.providerId === provider.id).map(model => model.upstreamModelId),
              ).size
              const active = selectedProviderId === provider.id
              const preset = findPresetByName(provider.name)
              const iconColor = preset?.color

              return (
                <button
                  key={provider.id}
                  onClick={() => onSelect(provider.id)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 border-l-2 px-3 py-3 text-left transition-colors',
                    active
                      ? 'border-l-primary bg-primary/5 text-foreground'
                      : 'border-l-transparent bg-background text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                      style={{
                        color: iconColor ?? 'var(--primary)',
                        backgroundColor: iconColor ? `${iconColor}14` : 'color-mix(in srgb, var(--primary) 10%, transparent)',
                      }}
                    >
                      <ProviderIcon name={provider.name} size={13} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn('h-2 w-2 rounded-full', state.dot)} />
                        <span className="truncate text-sm font-medium">{provider.name}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">{modelCount} 个模型</div>
                    </div>
                  </div>
                  <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium', active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                    {provider.enabled ? '启用' : '停用'}
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
