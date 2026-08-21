import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Server } from 'lucide-react'
import { ProviderIcon } from './provider-icon'
import { findPresetByName } from '../lib/provider-presets'
import type { Provider, ProviderModelRoute } from '@common/schemas'

interface ProviderGridProps {
  providers: Provider[]
  models: ProviderModelRoute[]
  selectedProviderId: string
  onSelect: (id: string) => void
}

export function ProviderGrid(props: ProviderGridProps) {
  const { providers, models, selectedProviderId, onSelect } = props

  return (
    <Card className="h-fit">
      <CardHeader className="pb-3">
        <CardTitle>供应商</CardTitle>
        <CardDescription>
          密钥按供应商保存，可为每个协议配置默认接口地址，模型可单独覆盖。
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {providers.length ? (
          <div className="px-2 pb-2">
            {providers.map(provider => {
              const active = selectedProviderId === provider.id
              const preset = findPresetByName(provider.name)
              const iconColor = preset?.color
              const modelCount = new Set(
                models.filter(model => model.providerId === provider.id).map(model => model.modelName),
              ).size

              return (
                <button
                  key={provider.id}
                  onClick={() => onSelect(provider.id)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2.5 text-left transition-colors',
                    active
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                      style={{
                        color: iconColor ?? 'var(--primary)',
                        backgroundColor: iconColor ? `${iconColor}14` : 'color-mix(in srgb, var(--primary) 10%, transparent)',
                      }}
                    >
                      <ProviderIcon name={provider.name} size={13} />
                    </span>
                    <div className="flex min-w-0 flex-1 items-baseline gap-1">
                      <span className="min-w-0 truncate text-[12px] font-medium">{provider.name}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{modelCount} 个模型</span>
                    </div>
                  </div>
                  {!provider.enabled && (
                    <Badge variant="muted" className="shrink-0 text-[10px]">
                      停用
                    </Badge>
                  )}
                </button>
              )
            })}
          </div>
        ) : (
          <EmptyState
            icon={Server}
            title="还没有供应商"
            description="创建供应商并配置凭据后，即可添加供应商模型与协议地址。"
            className="min-h-36 py-6"
            embedded
          />
        )}
      </CardContent>
    </Card>
  )
}
