import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Server } from 'lucide-react'
import { ProviderIcon } from './provider-icon'
import { findPresetByName, getBuiltInProviderSuggestions } from '../lib/provider-presets'
import type { ProviderPreset } from '../lib/provider-presets'
import type { Provider, ProviderModelRoute } from '@common/schemas'

interface ProviderGridProps {
  providers: Provider[]
  models: ProviderModelRoute[]
  selectedProviderId: string
  onSelectProvider: (id: string) => void
  onSelectBuiltInProvider: (preset: ProviderPreset) => void
}

export function ProviderGrid(props: ProviderGridProps) {
  const { providers, models, selectedProviderId, onSelectProvider, onSelectBuiltInProvider } = props
  const builtinSuggestions = getBuiltInProviderSuggestions(providers.map(provider => provider.name))

  const renderItem = (item: { id: string; name: string; enabled: boolean; modelCount: number; onSelect: () => void }) => {
    const active = selectedProviderId === item.id
    const preset = findPresetByName(item.name)
    const iconColor = preset?.color

    return (
      <button
        key={item.id}
        onClick={item.onSelect}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors',
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
            <ProviderIcon name={item.name} size={21} />
          </span>
          <div className="flex min-w-0 flex-1 items-baseline gap-1">
            <span className="min-w-0 truncate text-[12px] font-medium">{item.name}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{item.modelCount} 个模型</span>
          </div>
        </div>
        {!item.enabled && (
          <Badge variant="muted" className="shrink-0 text-[10px]">
            停用
          </Badge>
        )}
      </button>
    )
  }

  return (
    <Card className="h-fit">
      <CardHeader className="pb-3">
        <CardTitle>供应商</CardTitle>
        <CardDescription>
          密钥按供应商保存，可为每个协议配置默认接口地址，模型可单独覆盖。
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {providers.length || builtinSuggestions.length ? (
          <div className="px-2 pb-2">
            {providers.map(provider => {
              const modelCount = new Set(
                models.filter(model => model.providerId === provider.id).map(model => model.modelName),
              ).size
              return renderItem({
                id: provider.id,
                name: provider.name,
                enabled: provider.enabled,
                modelCount,
                onSelect: () => onSelectProvider(provider.id),
              })
            })}

            {builtinSuggestions.map(preset => renderItem({
              id: `builtin-${preset.key}`,
              name: preset.name,
              enabled: true,
              modelCount: 0,
              onSelect: () => onSelectBuiltInProvider(preset),
            }))}
          </div>
        ) : (
          <EmptyState
            icon={Server}
            title="还没有供应商"
            description="点击新建供应商手动配置，或稍后接入内置厂商。"
            className="min-h-36 py-6"
            embedded
          />
        )}
      </CardContent>
    </Card>
  )
}
