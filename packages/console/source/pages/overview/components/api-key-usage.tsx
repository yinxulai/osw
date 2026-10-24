import { KeyRound } from 'lucide-react'
import type { ApiKey, ApiKeyStat } from '@common/schemas'
import { tableHeaderClass, tableRowClass } from '@/components/table-primitives'
import { TableStateRow } from '@/components/table-state'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useTranslation } from '@/i18n/provider'
import { formatNumber } from '@/pages/request-logs/lib/format'

interface ApiKeyUsageProps {
  stats: ApiKeyStat[]
  keys: ApiKey[]
}

/**
 * 按 Key 的用量表。
 *
 * 放在总览而不是 Key 管理页：它回答的是「额度花在谁身上」，与「这把 Key 还能不能用」
 * 是两个问题。Key 管理页只负责签发 / 停用 / 轮换，用量归统计分析。
 *
 * `apiKeyId === null` 的行是**未署名**：功能没开时的全部请求都在这里，界面如实显示，
 * 让「谁在花我的额度」即使没开校验也看得见。名字从当前 Key 列表实时反查
 * （请求日志只存 id，不存名字），查不到说明这把 Key 已被删除。
 */
export function ApiKeyUsage(props: ApiKeyUsageProps) {
  const t = useTranslation()
  const nameOf = (id: string | null): string => {
    if (id === null) return t('apiKeys.label.anonymous')
    return props.keys.find(key => key.id === id)?.name ?? t('apiKeys.label.unknown')
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="border-b border-border/50 px-4 py-3">
        <CardTitle>{t('overview.apiKeys.title')}</CardTitle>
        <CardDescription>{t('overview.apiKeys.description')}</CardDescription>
      </div>
      <div className="overflow-x-auto">
        <Table className="w-full text-left text-xs">
          <TableHeader className={tableHeaderClass}>
            <TableRow>
              <TableHead className="px-4 py-2">{t('overview.apiKeys.column.key')}</TableHead>
              <TableHead className="w-24 px-3 py-2 text-right">{t('overview.apiKeys.column.requests')}</TableHead>
              <TableHead className="w-28 px-3 py-2 text-right">{t('overview.apiKeys.column.tokens')}</TableHead>
              <TableHead className="w-24 px-3 py-2 text-right">{t('overview.apiKeys.column.successRate')}</TableHead>
              <TableHead className="w-28 px-4 py-2 text-right">{t('overview.apiKeys.column.avgLatency')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.stats.length === 0
              ? <TableStateRow colSpan={5} icon={KeyRound} title={t('overview.apiKeys.empty')} />
              : props.stats.map(stat => (
                <TableRow key={stat.apiKeyId ?? 'anonymous'} className={tableRowClass}>
                  <TableCell className="px-4 py-2.5 system-xs-medium text-text-primary">{nameOf(stat.apiKeyId)}</TableCell>
                  <TableCell className="px-3 py-2.5 text-right tabular-nums">{formatNumber(stat.requests)}</TableCell>
                  <TableCell className="px-3 py-2.5 text-right tabular-nums">{formatNumber(stat.totalTokens)}</TableCell>
                  <TableCell className="px-3 py-2.5 text-right tabular-nums">
                    {stat.requests > 0 ? `${Math.round((stat.success / stat.requests) * 100)}%` : '—'}
                  </TableCell>
                  <TableCell className="px-4 py-2.5 text-right tabular-nums">
                    {stat.requests > 0 ? `${Math.round(stat.avgLatencyMs)} ms` : '—'}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  )
}
