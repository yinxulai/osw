import { useState } from 'react'
import { Database, Trash2 } from 'lucide-react'
import type { PruneRequestLogsParams } from '@/api/observability'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { FormField, FormHint, FormRow } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import type { PruneRequestLogsResult } from '../hooks/use-request-log-retention'

interface LogRetentionCardProps {
  captureRequestLogs: boolean
  requestLogRetentionDays: number
  captureRequestContent: boolean
  contentRetentionDays: number
  onCaptureRequestLogsChange: (value: boolean) => void
  onRequestLogRetentionDaysChange: (value: number) => void
  onCaptureRequestContentChange: (value: boolean) => void
  onContentRetentionDaysChange: (value: number) => void
  onPrune: (params: PruneRequestLogsParams) => Promise<PruneRequestLogsResult | null>
}

/** 输入框只接受「天数」这一种整数语义：清空、负数、小数一律归一化成 0（= 永久保留）。 */
function parseRetentionDays(raw: string): number {
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

interface RetentionInputProps {
  id?: string
  ariaLabel: string
  value: number
  disabled?: boolean
  onChange: (value: number) => void
}

/**
 * 「保留天数」控件。`0` 不是「零天」而是「永久保留」，因此单位位置要跟着换词，
 * 否则输入框里一个孤零零的 0 会被读成「马上删」。
 */
function RetentionInput(props: RetentionInputProps) {
  const t = useTranslation()
  return (
    <div className={cn('flex items-center gap-2', props.disabled && 'opacity-50')}>
      <Input
        id={props.id}
        aria-label={props.ariaLabel}
        className="w-20 text-right"
        min={0}
        type="number"
        disabled={props.disabled}
        value={props.value}
        onChange={event => props.onChange(parseRetentionDays(event.target.value))}
      />
      <span className="w-14 shrink-0 system-xs-regular text-text-tertiary">
        {props.value === 0 ? t('settings.logs.forever') : t('settings.logs.retentionUnit')}
      </span>
    </div>
  )
}

export function LogRetentionCard(props: LogRetentionCardProps) {
  const {
    captureRequestLogs,
    requestLogRetentionDays,
    captureRequestContent,
    contentRetentionDays,
    onCaptureRequestLogsChange,
    onRequestLogRetentionDaysChange,
    onCaptureRequestContentChange,
    onContentRetentionDaysChange,
    onPrune,
  } = props
  const t = useTranslation()
  const [pruning, setPruning] = useState(false)
  const [pruneDialogOpen, setPruneDialogOpen] = useState(false)
  const [pruneRequestLogDays, setPruneRequestLogDays] = useState('0')
  const [pruneContentDays, setPruneContentDays] = useState('0')

  const parsedRequestLogDays = parseRetentionDays(pruneRequestLogDays)
  const parsedContentDays = parseRetentionDays(pruneContentDays)
  const nothingToPrune = parsedRequestLogDays === 0 && parsedContentDays === 0

  function openPruneDialog() {
    // 默认值取当前设置：用户想「按现在的保留期立刻清一遍」时不必自己重算天数。
    setPruneRequestLogDays(String(requestLogRetentionDays))
    setPruneContentDays(String(contentRetentionDays))
    setPruneDialogOpen(true)
  }

  async function handlePrune() {
    if (nothingToPrune || pruning) return
    setPruning(true)
    try {
      const result = await onPrune({
        requestLogRetentionDays: parsedRequestLogDays,
        contentRetentionDays: parsedContentDays,
      })
      if (result !== null) setPruneDialogOpen(false)
    } finally {
      setPruning(false)
    }
  }

  return (
    <Card data-screenshot="log-retention">
      <SettingsCardHeader
        icon={<Database />}
        title={t('settings.logs.title')}
        description={t('settings.logs.description')}
        actions={<Badge variant="muted">{t('settings.logs.localOnly')}</Badge>}
      />
      <CardContent className="divide-y divide-border/50 px-4">
        <FormRow
          title={t('settings.logs.record')}
          description={t('settings.logs.recordDescription')}
          control={<Switch checked={captureRequestLogs} onCheckedChange={onCaptureRequestLogsChange} />}
        />

        <FormRow
          title={t('settings.logs.requestRetention')}
          description={t('settings.logs.requestRetentionDescription')}
          control={(
            <RetentionInput
              ariaLabel={t('settings.logs.retentionAria')}
              value={requestLogRetentionDays}
              disabled={!captureRequestLogs}
              onChange={onRequestLogRetentionDaysChange}
            />
          )}
        />

        <FormRow
          title={t('settings.logs.capture')}
          description={t('settings.logs.captureDescription')}
          control={<Switch checked={captureRequestContent} onCheckedChange={onCaptureRequestContentChange} />}
        />

        <FormRow
          title={t('settings.logs.contentRetention')}
          description={t('settings.logs.contentRetentionDescription')}
          control={(
            <RetentionInput
              ariaLabel={t('settings.logs.retentionAria')}
              value={contentRetentionDays}
              disabled={!captureRequestLogs || !captureRequestContent}
              onChange={onContentRetentionDaysChange}
            />
          )}
        />

        <FormRow
          title={t('settings.logs.prune')}
          description={t('settings.logs.pruneDescription')}
          control={(
            <Button variant="outline" disabled={pruning} onClick={openPruneDialog}>
              <Trash2 />
              {t('settings.logs.pruneAction')}
            </Button>
          )}
        />
      </CardContent>
      <Dialog open={pruneDialogOpen} onOpenChange={open => !pruning && setPruneDialogOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.logs.pruneDialogTitle')}</DialogTitle>
            <DialogDescription>{t('settings.logs.pruneDialogDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <FormField label={t('settings.logs.pruneRequestLogs')} htmlFor="prune-request-log-days">
              <RetentionInput
                id="prune-request-log-days"
                ariaLabel={t('settings.logs.pruneAria')}
                value={parsedRequestLogDays}
                onChange={value => setPruneRequestLogDays(String(value))}
              />
              <FormHint>{t('settings.logs.pruneRequestLogsHint')} · {t('settings.logs.pruneSkip')}</FormHint>
            </FormField>
            <FormField label={t('settings.logs.pruneContents')} htmlFor="prune-content-days">
              <RetentionInput
                id="prune-content-days"
                ariaLabel={t('settings.logs.pruneAria')}
                value={parsedContentDays}
                onChange={value => setPruneContentDays(String(value))}
              />
              <FormHint>{t('settings.logs.pruneContentsHint')} · {t('settings.logs.pruneSkip')}</FormHint>
            </FormField>
            {nothingToPrune && (
              <p className="system-xs-regular text-text-tertiary">{t('settings.logs.pruneNothingToDo')}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPruneDialogOpen(false)} disabled={pruning}>{t('common.action.cancel')}</Button>
            <Button onClick={() => void handlePrune()} disabled={pruning || nothingToPrune}>
              {pruning ? t('settings.logs.pruning') : t('settings.logs.pruneConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
