import { KeyRound, Power, PowerOff } from 'lucide-react'
import { MetricGrid } from '@/components/metric-grid'
import { useTranslation } from '@/i18n/provider'
import type { ApiKeyRow } from '../types'

interface ApiKeyStatsProps {
  keys: ApiKeyRow[]
}

/** 三个开关维度各一个数：总数、当前可用、当前不可用（含过期）。 */
export function ApiKeyStats(props: ApiKeyStatsProps) {
  const t = useTranslation()
  const enabled = props.keys.filter(key => key.status === 'enabled').length
  return (
    <MetricGrid items={[
      { label: t('apiKeys.stats.total'), value: props.keys.length, Icon: KeyRound },
      { label: t('apiKeys.stats.enabled'), value: enabled, Icon: Power },
      { label: t('apiKeys.stats.disabled'), value: props.keys.length - enabled, Icon: PowerOff },
    ]} />
  )
}
