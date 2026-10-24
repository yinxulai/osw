import { CalendarClock, KeyRound, Power, PowerOff } from 'lucide-react'
import { MetricGrid } from '@/components/metric-grid'
import { useTranslation } from '@/i18n/provider'
import type { ApiKeyRow } from '../types'

interface ApiKeyStatsProps {
  keys: ApiKeyRow[]
}

/**
 * 四个维度各一个数：总数、已启用、已停用、已过期。
 *
 * 「停用」与「过期」分开：两者都不是「可用」，但原因不同（人关的 vs 时间到的），
 * 合成一个数会让「我明明没关过它」变成一个没法拆的问题。
 */
export function ApiKeyStats(props: ApiKeyStatsProps) {
  const t = useTranslation()
  const count = (status: ApiKeyRow['status']) => props.keys.filter(key => key.status === status).length
  return (
    <MetricGrid items={[
      { label: t('apiKeys.stats.total'), value: props.keys.length, Icon: KeyRound },
      { label: t('apiKeys.stats.enabled'), value: count('enabled'), Icon: Power },
      { label: t('apiKeys.stats.disabled'), value: count('disabled'), Icon: PowerOff },
      { label: t('apiKeys.stats.expired'), value: count('expired'), Icon: CalendarClock },
    ]} />
  )
}
