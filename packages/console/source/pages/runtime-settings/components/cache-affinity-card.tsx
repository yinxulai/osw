import { Magnet } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { FormRow } from '@/components/form-kit'
import { SettingsNumberRow } from '@/components/settings-number-row'
import { Switch } from '@/components/ui/switch'
import type { Settings } from '@common/schemas'
import { useTranslation } from '@/i18n/provider'

interface CacheAffinityCardProps {
  settings: Pick<Settings, 'cacheAffinityEnabled' | 'cacheAffinityTtlSeconds'>
  onUpdate: <K extends keyof CacheAffinityCardProps['settings']>(key: K, value: Settings[K]) => void
}

/** 缓存亲和：会话粘住它最近一次成功的供应商模型，保护 provider 侧 prompt cache（见 `upstream/affinity`）。 */
export function CacheAffinityCard(props: CacheAffinityCardProps) {
  const { settings, onUpdate } = props
  const t = useTranslation()

  return (
    <Card data-screenshot="cache-affinity">
      <SettingsCardHeader
        icon={<Magnet />}
        title={t('settings.cacheAffinity.title')}
        description={t('settings.cacheAffinity.description')}
      />
      <CardContent className="divide-y divide-border/50 px-4">
        <FormRow
          title={t('settings.cacheAffinity.enabled')}
          description={t('settings.cacheAffinity.enabledDescription')}
          control={<Switch checked={settings.cacheAffinityEnabled} onCheckedChange={value => onUpdate('cacheAffinityEnabled', value)} />}
        />
        <SettingsNumberRow
          title={t('settings.cacheAffinity.ttl')}
          description={t('settings.cacheAffinity.ttlDescription')}
          placeholder="900"
          suffix={t('settings.failover.unitSeconds')}
          min={60}
          max={86400}
          rangeErrorText={t('settings.cacheAffinity.rangeError', { min: 60, max: 86400 })}
          value={settings.cacheAffinityTtlSeconds}
          onChange={value => onUpdate('cacheAffinityTtlSeconds', value)}
        />
      </CardContent>
    </Card>
  )
}
