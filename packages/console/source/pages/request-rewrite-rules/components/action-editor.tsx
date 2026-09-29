import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { FormField } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useTranslation, type AppTranslator } from '@/i18n/provider'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import type { RuleAction, RuleActionOperation, RuleActionTarget } from '../types'

const OPERATION_LABEL_KEY: Record<RuleActionOperation, UiCatalogKey> = {
  set: 'rules.actions.operation.set',
  append: 'rules.actions.operation.append',
  remove: 'rules.actions.operation.remove',
  replace: 'rules.actions.operation.replace',
}

/** 值字段的标签与占位符按「是否替换」和「目标是 Header 还是 Body」分档。 */
const VALUE_LABEL_KEY: Record<'replace' | 'header' | 'body', UiCatalogKey> = {
  replace: 'rules.actions.valueLabel.replace',
  header: 'rules.actions.valueLabel.header',
  body: 'rules.actions.valueLabel.body',
}
const VALUE_PLACEHOLDER_KEY: Record<'replace' | 'header' | 'body', UiCatalogKey> = {
  replace: 'rules.actions.valuePlaceholder.replace',
  header: 'rules.actions.valuePlaceholder.header',
  body: 'rules.actions.valuePlaceholder.body',
}

/** 目标只影响标签与占位符的接继，文案各自取自目录。 */
function targetFieldLabels(t: AppTranslator, target: RuleActionTarget, operation: RuleActionOperation) {
  const isHeader = target === 'header'
  const suffix = operation === 'replace' ? 'replace' : isHeader ? 'header' : 'body'
  return {
    path: isHeader ? t('rules.actions.pathLabel.header') : t('rules.actions.pathLabel.body'),
    pathPlaceholder: isHeader ? t('rules.actions.pathPlaceholder.header') : t('rules.actions.pathPlaceholder.body'),
    value: t(VALUE_LABEL_KEY[suffix]),
    valuePlaceholder: t(VALUE_PLACEHOLDER_KEY[suffix]),
  }
}

interface ActionEditorProps {
  actions: RuleAction[]
  onChange: (actions: RuleAction[]) => void
}

export function ActionEditor(props: ActionEditorProps) {
  const t = useTranslation()
  const [deleteActionId, setDeleteActionId] = useState<string>()

  const updateAction = (id: string, patch: Partial<RuleAction>) => {
    props.onChange(props.actions.map(action => action.id === id ? { ...action, ...patch } : action))
  }

  const addAction = () => {
    props.onChange([...props.actions, { id: `action-${Date.now()}`, stage: 'request', target: 'header', operation: 'set', path: '', value: '' }])
  }

  return (
    <section className="grid gap-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="system-sm-medium text-text-primary">{t('rules.actions.title')}</h3>
          <p className="mt-1 system-xs-regular text-text-tertiary">{t('rules.actions.description')}</p>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-8 px-2.5 system-xs-medium" onClick={addAction}>
          <Plus /> {t('rules.actions.add')}
        </Button>
      </div>

      <div className="grid gap-2.5">
        {props.actions.length === 0 && (
          <div className="rounded-lg border border-dashed border-module-border px-4 py-8 text-center">
            <p className="system-xs-medium text-text-primary">{t('rules.actions.empty.title')}</p>
            <p className="mt-1 system-xs-regular text-text-tertiary">{t('rules.actions.empty.description')}</p>
          </div>
        )}
        {props.actions.map((action, index) => {
          const isHeader = action.target === 'header'
          const isRemove = action.operation === 'remove'
          const isReplace = action.operation === 'replace'
          const operations = isHeader ? (['set', 'append', 'remove'] as RuleActionOperation[]) : (['set', 'remove', 'replace'] as RuleActionOperation[])
          const labels = targetFieldLabels(t, action.target, action.operation)

          return (
            <div key={action.id} className="rounded-lg border border-module-border p-3">
              <div className="flex flex-wrap items-center gap-1.5 pb-3">
                <span className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-md bg-inset font-mono system-2xs-medium text-text-tertiary">{index + 1}</span>
                <Select value={action.stage} onValueChange={value => updateAction(action.id, { stage: value as 'request' | 'response' })}>
                  <SelectTrigger aria-label={t('rules.actions.stageAria', { index: index + 1 })}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="request">{t('rules.stage.request')}</SelectItem><SelectItem value="response">{t('rules.stage.response')}</SelectItem></SelectContent>
                </Select>
                <Select value={action.target} onValueChange={value => updateAction(action.id, { target: value as RuleActionTarget, operation: 'set', value: '' })}>
                  <SelectTrigger aria-label={t('rules.actions.targetAria', { index: index + 1 })}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="header">{t('rules.actions.target.header')}</SelectItem><SelectItem value="body">{t('rules.actions.target.body')}</SelectItem></SelectContent>
                </Select>
                <Select value={action.operation} onValueChange={value => updateAction(action.id, { operation: value as RuleActionOperation })}>
                  <SelectTrigger aria-label={t('rules.actions.operationAria', { index: index + 1 })}><SelectValue /></SelectTrigger>
                  <SelectContent>{operations.map(operation => <SelectItem key={operation} value={operation}>{t(OPERATION_LABEL_KEY[operation])}</SelectItem>)}</SelectContent>
                </Select>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t('rules.actions.deleteAria')} className="ml-auto text-text-tertiary hover:text-text-destructive" onClick={() => setDeleteActionId(action.id)}>
                  <Trash2 />
                </Button>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <FormField label={labels.path} htmlFor={`${action.id}-target`} className="sm:col-span-2">
                  <Input
                    id={`${action.id}-target`}
                    value={action.path}
                    onChange={event => updateAction(action.id, { path: event.target.value })}
                    placeholder={labels.pathPlaceholder}
                    className="font-mono placeholder:font-mono"
                  />
                </FormField>
                {!isRemove && (
                  <FormField
                    className={isReplace ? 'sm:col-span-2' : undefined}
                    label={labels.value}
                    htmlFor={`${action.id}-value`}
                    hint={isReplace && action.regex ? t('rules.actions.regexHint') : undefined}
                  >
                    <div className="flex items-center gap-2">
                      <Input
                        id={`${action.id}-value`}
                        value={action.value ?? ''}
                        onChange={event => updateAction(action.id, { value: event.target.value })}
                        placeholder={labels.valuePlaceholder}
                        className="min-w-0 flex-1 font-mono"
                      />
                      {isReplace && (
                        <label className="flex shrink-0 items-center gap-1.5 system-xs-regular text-text-tertiary">
                          <Switch checked={action.regex ?? false} onCheckedChange={regex => updateAction(action.id, { regex })} aria-label={t('rules.actions.regexAria')} />
                          {t('rules.actions.regex')}
                        </label>
                      )}
                    </div>
                  </FormField>
                )}
                {isReplace && (
                  <FormField label={t('rules.actions.replacementLabel')} htmlFor={`${action.id}-replacement`} className="sm:col-span-2">
                    <Input
                      id={`${action.id}-replacement`}
                      value={action.replacement ?? ''}
                      onChange={event => updateAction(action.id, { replacement: event.target.value })}
                      placeholder={t('rules.actions.replacementPlaceholder')}
                    />
                  </FormField>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <ConfirmDialog
        open={Boolean(deleteActionId)}
        title={t('rules.actions.delete.title')}
        description={t('rules.actions.delete.description')}
        confirmLabel={t('rules.actions.delete.confirm')}
        variant="destructive"
        onConfirm={() => {
          props.onChange(props.actions.filter(action => action.id !== deleteActionId))
          setDeleteActionId(undefined)
        }}
        onOpenChange={open => !open && setDeleteActionId(undefined)}
      />
    </section>
  )
}
