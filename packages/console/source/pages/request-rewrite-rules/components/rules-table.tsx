import { Copy, Globe2, Link2, Pencil, Search, SearchX, Trash2 } from 'lucide-react'
import { tableHeaderClass, tableRowClass } from '@/components/table-primitives'
import { TableStateRow } from '@/components/table-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { PROTOCOL_LABELS, type RequestRewriteRule, type RuleStatusFilter } from '../types'

interface RulesTableProps {
  rules: RequestRewriteRule[]
  search: string
  statusFilter: RuleStatusFilter
  onSearchChange: (value: string) => void
  onStatusFilterChange: (value: RuleStatusFilter) => void
  onEdit: (rule: RequestRewriteRule) => void
  onDuplicate: (rule: RequestRewriteRule) => void
  onDelete: (rule: RequestRewriteRule) => void
  onToggle: (rule: RequestRewriteRule, enabled: boolean) => void
}

export function RulesTable(props: RulesTableProps) {
  const t = useTranslation()
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-col gap-3 border-b border-border/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>{t('rules.table.title')}</CardTitle>
          <CardDescription>{t('rules.table.description')}</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-full sm:w-56">
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

      <div className="overflow-x-auto">
        <Table className={cn('w-full text-left text-xs', props.rules.length > 0 && 'min-w-205')}>
          <TableHeader className={tableHeaderClass}>
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
            {props.rules.map(rule => {
              const hasRequest = rule.actions.some(action => action.stage === 'request')
              const hasResponse = rule.actions.some(action => action.stage === 'response')
              const protocols = rule.protocols.map(protocol => PROTOCOL_LABELS[protocol])
              const protocolText = protocols.length ? protocols.join(t('common.listSeparator')) : t('rules.table.allProtocols')
              return (
                <TableRow key={rule.id} className={tableRowClass}>
                  <TableCell className="px-4 py-2.5">
                    <button type="button" onClick={() => props.onEdit(rule)} className="block max-w-80 text-left">
                      <span className="block truncate system-xs-medium hover:text-primary">{rule.name}</span>
                      <span className="mt-0.5 block truncate system-2xs-regular text-text-tertiary">{rule.description || t('rules.table.noDescription')}</span>
                    </button>
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    {rule.global ? (
                      <Badge variant="info" className="gap-1 font-normal"><Globe2 className="size-3" />{t('rules.scope.global')}</Badge>
                    ) : (
                      <div>
                        <Badge variant="outline" className="gap-1 font-normal"><Link2 className="size-3" />{t('rules.scope.normal')}</Badge>
                        <p className="mt-1 system-2xs-regular text-text-tertiary">{t('rules.boundProviders', { count: rule.boundProviders })}</p>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <Badge variant={hasRequest ? 'secondary' : 'warning'} className="font-normal">
                      {[hasRequest && t('rules.stage.request'), hasResponse && t('rules.stage.response')].filter(Boolean).join(' / ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <p className="max-w-40 truncate system-2xs-regular text-text-tertiary" title={protocolText}>
                      {protocolText}
                    </p>
                  </TableCell>
                  <TableCell className="px-3 py-2.5">{t('rules.table.actionCount', { count: rule.actions.length })}</TableCell>
                  <TableCell className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={enabled => props.onToggle(rule, enabled)}
                        aria-label={t('rules.table.toggleAria', { name: rule.name })}
                      />
                      <span className="system-2xs-regular text-text-tertiary">{rule.enabled ? t('rules.status.enabled') : t('rules.status.disabled')}</span>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-2.5">
                    <div className="flex justify-end gap-0.5">
                      <Button variant="ghost" size="icon-sm" onClick={() => props.onEdit(rule)} title={t('rules.table.edit')}><Pencil /></Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => props.onDuplicate(rule)} title={t('rules.table.duplicate')}><Copy /></Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => props.onDelete(rule)} title={t('rules.table.delete')} className="text-text-tertiary hover:text-text-destructive"><Trash2 /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
            {props.rules.length === 0 && (
              <TableStateRow colSpan={7} icon={SearchX} title={t('rules.filter.empty.title')} description={t('rules.filter.empty.description')} />
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  )
}
