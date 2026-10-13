import { KeyRound, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { tableHeaderClass, tableRowClass } from '@/components/table-primitives'
import { TableStateRow } from '@/components/table-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useTranslation } from '@/i18n/provider'
import { formatApiKeyStatus, formatExpiry } from '../lib/format'
import type { ApiKeyRow } from '../types'

interface ApiKeysTableProps {
  keys: ApiKeyRow[]
  now: number
  onEdit: (key: ApiKeyRow) => void
  onRotate: (key: ApiKeyRow) => void
  onDelete: (key: ApiKeyRow) => void
  onToggle: (key: ApiKeyRow, enabled: boolean) => void
}

/**
 * Key 列表。
 *
 * 名字下面只放一个弱化行（无描述就留空），不放明文预览——明文根本不存在于列表数据里，
 * 这里能显示的只有元数据。
 */
export function ApiKeysTable(props: ApiKeysTableProps) {
  const t = useTranslation()
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="border-b border-border/50 px-4 py-3">
        <CardTitle>{t('apiKeys.table.title')}</CardTitle>
        <CardDescription>{t('apiKeys.table.description')}</CardDescription>
      </div>

      <div className="overflow-x-auto">
        <Table className="w-full text-left text-xs">
          <TableHeader className={tableHeaderClass}>
            <TableRow>
              <TableHead className="px-4 py-2">{t('apiKeys.table.column.key')}</TableHead>
              <TableHead className="w-40 px-3 py-2">{t('apiKeys.table.column.status')}</TableHead>
              <TableHead className="w-36 px-3 py-2">{t('apiKeys.table.column.expires')}</TableHead>
              <TableHead className="w-40 px-3 py-2">{t('apiKeys.table.column.created')}</TableHead>
              <TableHead className="w-32 px-4 py-2 text-right">{t('apiKeys.table.column.operations')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.keys.length === 0
              ? <TableStateRow colSpan={5} icon={KeyRound} title={t('apiKeys.empty.title')} description={t('apiKeys.empty.description')} />
              : props.keys.map(key => (
                <TableRow key={key.id} className={tableRowClass}>
                  <TableCell className="px-4 py-2.5">
                    <button type="button" onClick={() => props.onEdit(key)} className="block max-w-80 text-left">
                      <span className="block truncate system-xs-medium hover:text-primary">{key.name}</span>
                      <span className="mt-0.5 block truncate system-2xs-regular text-text-tertiary">{key.id}</span>
                    </button>
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={key.status === 'enabled'}
                        disabled={key.status === 'expired'}
                        onCheckedChange={enabled => props.onToggle(key, enabled)}
                        aria-label={t('apiKeys.table.toggleAria', { name: key.name })}
                      />
                      <Badge variant={key.status === 'enabled' ? 'success' : key.status === 'expired' ? 'warning' : 'secondary'} className="font-normal">
                        {formatApiKeyStatus(t, key.status)}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-2.5 system-2xs-regular text-text-tertiary">
                    {formatExpiry(t, key.expiresTime)}
                  </TableCell>
                  <TableCell className="px-3 py-2.5 system-2xs-regular text-text-tertiary">
                    {new Date(key.createdTime).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="px-4 py-2.5">
                    <div className="flex justify-end gap-0.5">
                      <Button variant="ghost" size="icon-sm" onClick={() => props.onEdit(key)} title={t('apiKeys.table.edit')} aria-label={t('apiKeys.table.edit')}><Pencil /></Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => props.onRotate(key)} title={t('apiKeys.table.rotate')} aria-label={t('apiKeys.table.rotate')}><RefreshCw /></Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => props.onDelete(key)} title={t('apiKeys.table.delete')} aria-label={t('apiKeys.table.delete')}><Trash2 /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  )
}
