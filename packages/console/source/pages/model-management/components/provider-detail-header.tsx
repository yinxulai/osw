import { BarChart3, Download, Pencil, Trash2 } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useTranslation } from '@/i18n/provider'
import { routePaths } from '@/routes'
import { ProviderIcon } from './provider-icon'
import { ProviderWebsiteLink } from './provider-website-link'
import { findPresetByName } from '../lib/provider-presets'
import type { Provider } from '@common/schemas'

interface ProviderDetailHeaderProps {
  provider: Provider
  onToggleProviderEnabled: (enabled: boolean) => void
  onEditProvider: () => void
  onExportProvider: () => void
  onRemoveProvider: () => void
}

export function ProviderDetailHeader(props: ProviderDetailHeaderProps) {
  const { provider, onToggleProviderEnabled, onEditProvider, onExportProvider, onRemoveProvider } = props
  const t = useTranslation()
  const preset = findPresetByName(provider.name)
  const iconColor = preset?.color

  return (
    <CardHeader className="flex-row justify-between gap-3 pb-2">
      <div className="flex min-w-0 items-start gap-3">
        <div
          className="flex size-9 items-center justify-center rounded-lg"
          style={{
            color: iconColor ?? 'var(--primary)',
            backgroundColor: iconColor ? `${iconColor}14` : 'color-mix(in srgb, var(--primary) 10%, transparent)',
          }}
        >
          <ProviderIcon name={provider.name} size={27} />
        </div>
        <div className="min-w-0">
          {/* 官网跟着标题走：它是「这家厂商是谁」的一部分，不是对这家供应商的操作，所以不进右侧按钮组。 */}
          <div className="flex min-w-0 items-center gap-2">
            <CardTitle className="truncate">{provider.name}</CardTitle>
            <ProviderWebsiteLink url={preset?.websiteUrl} />
          </div>
          <CardDescription className="mt-1">
            {t('providers.detail.description')}
          </CardDescription>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          checked={provider.enabled}
          onCheckedChange={onToggleProviderEnabled}
          aria-label={t('models.row.enabledState', { name: provider.name })}
        />
        <Button variant="outline" onClick={onExportProvider}>
          <Download size={13} /> {t('providers.action.export')}
        </Button>
        <Button asChild variant="outline">
          <Link to={routePaths.overviewProvider} params={{ providerId: provider.id }} search={{ range: '7d' }}>
            <BarChart3 size={13} /> {t('providers.action.analytics')}
          </Link>
        </Button>
        <Button variant="outline" onClick={onEditProvider}>
          <Pencil size={13} /> {t('providers.action.edit')}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-text-destructive"
          title={t('providers.action.delete')}
          onClick={onRemoveProvider}
        >
          <Trash2 size={13} />
        </Button>
      </div>
    </CardHeader>
  )
}
