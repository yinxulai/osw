import { BarChart3, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { ProviderIcon } from './provider-icon'
import { findPresetByName } from '../lib/provider-presets'
import type { Provider } from '@common/schemas'

interface ProviderDetailHeaderProps {
  provider: Provider
  onToggleProviderEnabled: (enabled: boolean) => void
  onEditProvider: () => void
  onRemoveProvider: () => void
  onNavigateToAnalytics?: () => void
}

export function ProviderDetailHeader(props: ProviderDetailHeaderProps) {
  const { provider, onToggleProviderEnabled, onEditProvider, onRemoveProvider } = props
  const iconColor = findPresetByName(provider.name)?.color

  return (
    <CardHeader className="flex-row justify-between gap-3 pb-2">
      <div className="flex min-w-0 items-start gap-3">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-md"
          style={{
            color: iconColor ?? 'var(--primary)',
            backgroundColor: iconColor ? `${iconColor}14` : 'color-mix(in srgb, var(--primary) 10%, transparent)',
          }}
        >
          <ProviderIcon name={provider.name} size={27} />
        </div>
        <div>
          <CardTitle>{provider.name}</CardTitle>
          <CardDescription className="mt-1">
            凭据按供应商保存，模型沿用默认接口地址，也可单独覆盖。
          </CardDescription>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          checked={provider.enabled}
          onCheckedChange={onToggleProviderEnabled}
          aria-label={`${provider.name} 启用状态`}
        />
        {props.onNavigateToAnalytics && (
          <Button variant="outline" onClick={props.onNavigateToAnalytics}>
            <BarChart3 size={13} /> 数据分析
          </Button>
        )}
        <Button variant="outline" onClick={onEditProvider}>
          <Pencil size={13} /> 编辑
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive"
          title="删除供应商"
          onClick={onRemoveProvider}
        >
          <Trash2 size={13} />
        </Button>
      </div>
    </CardHeader>
  )
}
