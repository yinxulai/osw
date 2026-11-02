import { Plus, Search, SearchX, X } from 'lucide-react'
import { tableHeaderClass } from '@/components/table-primitives'
import { TableStateRow } from '@/components/table-state'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import type { RequestRewriteRule, RuleStatusFilter } from '../types'
import { RuleRow } from './rule-row'

interface RulesTableProps {
  rules: RequestRewriteRule[]
  search: string
  statusFilter: RuleStatusFilter
  /** 过滤前是否有规则；用来区分「一条都没有」与「筛选后为空」。 */
  hasAnyRules: boolean
  onSearchChange: (value: string) => void
  onStatusFilterChange: (value: RuleStatusFilter) => void
  onEdit: (rule: RequestRewriteRule) => void
  onDuplicate: (rule: RequestRewriteRule) => void
  onDelete: (rule: RequestRewriteRule) => void
  onToggle: (rule: RequestRewriteRule, enabled: boolean) => void
  onCreate: () => void
  onClearFilters: () => void
}

const COLUMN_COUNT = 7

/** 表格骨架：列宽与真实行对齐，行数不超过一屏。 */
export function RulesTableSkeleton() {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="border-b border-border/50 px-4 py-3">
        <Skeleton className="mb-2 h-4 w-24" />
        <Skeleton className="h-3 w-56" />
      </div>
      <div className="divide-y divide-border/40">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-14" />
            <Skeleton className="hidden h-3 w-24 sm:block" />
            <Skeleton className="h-5 w-10" />
            <Skeleton className="h-7 w-20" />
          </div>
        ))}
      </div>
    </Card>
  )
}

export function RulesTable(props: RulesTableProps) {
  const t = useTranslation()
  const filtered = props.hasAnyRules && (props.search.trim() !== '' || props.statusFilter !== 'all')
  const showEmpty = props.rules.length === 0

  return (
    <Card className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden py-0">
      <div className="flex flex-col gap-3 border-b border-border/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <CardTitle>{t('rules.table.title')}</CardTitle>
          <CardDescription>{t('rules.table.description')}</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-tertiary" />
            <Input
              value={props.search}
              onChange={event => props.onSearchChange(event.target.value)}
              placeholder={t('rules.filter.searchPlaceholder')}
              className="pl-9"
              aria-label={t('rules.filter.searchAria')}
            />
          </div>
          <Select value={props.statusFilter} onValueChange={value => props.onStatusFilterChange(value as RuleStatusFilter)}>
            <SelectTrigger className="w-28" aria-label={t('rules.filter.statusAria')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('rules.filter.statusAll')}</SelectItem>
              <SelectItem value="enabled">{t('rules.filter.statusEnabled')}</SelectItem>
              <SelectItem value="disabled">{t('rules.filter.statusDisabled')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <Table className={cn('w-full text-left text-xs', !showEmpty && 'min-w-205')}>
          <TableHeader className={cn(tableHeaderClass, 'sticky top-0 z-10')}>
            <TableRow>
              <TableHead className="px-4 py-2">{t('rules.table.column.rule')}</TableHead>
              <TableHead className="w-28 px-3 py-2">{t('rules.table.column.scope')}</TableHead>
              <TableHead className="w-24 px-3 py-2">{t('rules.table.column.stage')}</TableHead>
              <TableHead className="w-44 px-3 py-2">{t('rules.table.column.protocols')}</TableHead>
              <TableHead className="w-24 px-3 py-2">{t('rules.table.column.actions')}</TableHead>
              <TableHead className="w-24 px-3 py-2">{t('rules.table.column.status')}</TableHead>
              <TableHead className="w-32 px-4 py-2 text-right">{t('rules.table.column.operations')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.rules.map(rule => (
              <RuleRow
                key={rule.id}
                rule={rule}
                onEdit={props.onEdit}
                onDuplicate={props.onDuplicate}
                onDelete={props.onDelete}
                onToggle={props.onToggle}
              />
            ))}
            {showEmpty && (filtered ? (
              <TableStateRow
                colSpan={COLUMN_COUNT}
                icon={SearchX}
                title={t('rules.filter.empty.title')}
                description={t('rules.filter.empty.description')}
                action={(
                  <Button variant="outline" className="mt-1" onClick={props.onClearFilters}>
                    <X size={14} />
                    {t('rules.filter.empty.action')}
                  </Button>
                )}
              />
            ) : (
              <TableStateRow
                colSpan={COLUMN_COUNT}
                icon={Plus}
                title={t('rules.empty.title')}
                description={t('rules.empty.description')}
                action={(
                  <Button variant="outline" className="mt-1" onClick={props.onCreate}>
                    <Plus size={14} />
                    {t('rules.create')}
                  </Button>
                )}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  )
}
