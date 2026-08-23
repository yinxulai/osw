import { Globe2, Link2, Power, ScrollText } from 'lucide-react'
import { MetricGrid } from '@/components/metric-grid'
import type { ModificationRule } from '../types'

interface RuleStatsProps {
  rules: ModificationRule[]
}

export function RuleStats(props: RuleStatsProps) {
  return (
    <MetricGrid items={[
      { label: '全部规则', value: props.rules.length, Icon: ScrollText },
      { label: '全局规则', value: props.rules.filter(rule => rule.global).length, Icon: Globe2 },
      { label: '普通规则', value: props.rules.filter(rule => !rule.global).length, Icon: Link2 },
      { label: '已启用', value: props.rules.filter(rule => rule.enabled).length, Icon: Power },
    ]} />
  )
}
