import { Copy, Globe2, Link2, Pencil, Trash2 } from 'lucide-react'
import { tableRowClass } from '@/components/table-primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { TableCell, TableRow } from '@/components/ui/table'
import { useTranslation } from '@/i18n/provider'
import { PROTOCOL_LABELS, type RequestRewriteRule } from '../types'

interface RuleRowProps {
  rule: RequestRewriteRule
  onEdit: (rule: RequestRewriteRule) => void
  onDuplicate: (rule: RequestRewriteRule) => void
  onDelete: (rule: RequestRewriteRule) => void
  onToggle: (rule: RequestRewriteRule, enabled: boolean) => void
}

/** 规则表格的一行。拆出来只为让表格本体保持在「表头 + 三态 + 行列表」的读法里。 */
export function RuleRow(props: RuleRowProps) {
  const { rule } = props
  const t = useTranslation()
  const hasRequest = rule.actions.some(action => action.stage === 'request')
  const hasResponse = rule.actions.some(action => action.stage === 'response')
  const protocols = rule.protocols.map(protocol => PROTOCOL_LABELS[protocol])
  const protocolText = protocols.length ? protocols.join(t('common.listSeparator')) : t('rules.table.allProtocols')

  return (
    <TableRow className={tableRowClass}>
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
}
