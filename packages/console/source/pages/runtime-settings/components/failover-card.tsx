import { RefreshCcw } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { SettingsNumberRow } from '@/components/settings-number-row'
import type { Settings } from '@common/schemas'
import { useTranslation } from '@/i18n/provider'

interface FailoverCardProps {
  settings: Pick<Settings, 'consecutiveFailureThreshold' | 'cooldownBaseSeconds' | 'cooldownMaxSeconds' | 'idleTimeoutMilliseconds'>
  onUpdate: <K extends keyof FailoverCardProps['settings']>(key: K, value: Settings[K]) => void
}

export function FailoverCard(props: FailoverCardProps) {
  const { settings, onUpdate } = props
  const t = useTranslation()

  return (
    <Card>
      <SettingsCardHeader
        icon={<RefreshCcw />}
        title={t('settings.failover.title')}
        description={t('settings.failover.description')}
      />
      <CardContent className="divide-y divide-border/50 px-4">
        <SettingsNumberRow
          title={t('settings.failover.threshold')}
          description={t('settings.failover.thresholdDescription')}
          placeholder="3"
          suffix={t('settings.failover.thresholdUnit')}
          min={1}
          max={100}
          rangeErrorText={t('settings.failover.rangeError', { min: 1, max: 100 })}
          value={settings.consecutiveFailureThreshold}
          onChange={value => onUpdate('consecutiveFailureThreshold', value)}
        />
        <SettingsNumberRow
          title={t('settings.failover.base')}
          description={t('settings.failover.baseDescription')}
          placeholder="30"
          suffix={t('settings.failover.unitSeconds')}
          min={1}
          max={86400}
          rangeErrorText={t('settings.failover.rangeError', { min: 1, max: 86400 })}
          value={settings.cooldownBaseSeconds}
          onChange={value => onUpdate('cooldownBaseSeconds', value)}
        />
        <SettingsNumberRow
          title={t('settings.failover.max')}
          description={t('settings.failover.maxDescription')}
          placeholder="300"
          suffix={t('settings.failover.unitSeconds')}
          min={1}
          max={86400}
          rangeErrorText={t('settings.failover.rangeError', { min: 1, max: 86400 })}
          value={settings.cooldownMaxSeconds}
          onChange={value => onUpdate('cooldownMaxSeconds', value)}
        />
        <SettingsNumberRow
          title={t('settings.failover.timeout')}
          description={t('settings.failover.timeoutDescription')}
          placeholder="30000"
          suffix={t('settings.failover.unitMilliseconds')}
          min={1000}
          max={600000}
          rangeErrorText={t('settings.failover.rangeError', { min: 1000, max: 600000 })}
          value={settings.idleTimeoutMilliseconds}
          onChange={value => onUpdate('idleTimeoutMilliseconds', value)}
        />
      </CardContent>
    </Card>
  )
}
