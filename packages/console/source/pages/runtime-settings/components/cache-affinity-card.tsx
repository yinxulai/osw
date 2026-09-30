import { Magnet } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { FormRow } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
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
  const ttl = settings.cacheAffinityTtlSeconds
  const outOfRange = !Number.isInteger(ttl) || ttl < 60 || ttl > 86400

  // 设置项会被直接写入后端，这里就地收敛到合法区间，避免留下 0 / NaN 这类非法值。
  const handleTtlChange = (raw: string) => {
    const parsed = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(parsed)) return
    onUpdate('cacheAffinityTtlSeconds', Math.min(86400, Math.max(60, Math.round(parsed))))
  }

  return (
    <Card>
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
        <FormRow
          title={t('settings.cacheAffinity.ttl')}
          description={t('settings.cacheAffinity.ttlDescription')}
          error={outOfRange ? t('settings.cacheAffinity.rangeError', { min: 60, max: 86400 }) : undefined}
          control={(
            <div className="flex items-center gap-2">
              <Input
                aria-label={t('settings.cacheAffinity.ttl')}
                aria-invalid={outOfRange}
                className="w-24 text-right font-mono"
                min={60}
                max={86400}
                placeholder="900"
                type="number"
                value={Number.isFinite(ttl) ? ttl : ''}
                onChange={event => handleTtlChange(event.target.value)}
              />
              <span className="w-8 system-xs-regular text-text-tertiary">{t('settings.failover.unitSeconds')}</span>
            </div>
          )}
        />
      </CardContent>
    </Card>
  )
}
