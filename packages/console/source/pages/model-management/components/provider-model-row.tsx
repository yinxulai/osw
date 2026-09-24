import { useEffect, useState } from 'react'
import { GripVertical, Pencil, Trash2 } from 'lucide-react'
import { requestRewriteRuleApi, providerModelApi } from '@/api/models'
import { useHealth } from '@/data/health'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { ProtocolIcons } from '@/components/protocol-icons'
import { useTranslation } from '@/i18n/provider'
import { SortableProviderModel } from './sortable-provider-model'
import type { ProviderModelRoute } from '@common/schemas'

interface ProviderModelRowProps {

  model: ProviderModelRoute
  selected: boolean
  onSelectedChange: (checked: boolean) => void
  onEditModel: (model: ProviderModelRoute) => void
  onToggleModelEnabled: (model: ProviderModelRoute, enabled: boolean) => void
  onRemoveModel: (model: ProviderModelRoute) => void
}

export function ProviderModelRow(props: ProviderModelRowProps) {
  const { model, selected, onSelectedChange, onEditModel, onToggleModelEnabled, onRemoveModel } = props
  const t = useTranslation()
  const [ruleNames, setRuleNames] = useState<string[]>([])
  const { providerModels } = useHealth()
  const modelHealth = providerModels[model.id]

  useEffect(() => {
    let cancelled = false
    void Promise.all([requestRewriteRuleApi.list(), providerModelApi.requestRewriteRules(model.id)])
      .then(([allResponse, bindingsResponse]) => {
        if (cancelled || !allResponse.success || !bindingsResponse.success) return
        const allRules = allResponse.data
        const names = bindingsResponse.data
          .map(binding => allRules.find(rule => rule.id === binding.ruleId)?.name)
          .filter((name): name is string => Boolean(name))
        setRuleNames(names)
      })
    return () => { cancelled = true }
  }, [model.id])

  return (
    <SortableProviderModel id={model.id}>
      {(handleProps, dragging) => (
        <div className={'px-3 py-2.5 ' + (dragging ? 'bg-state-base-hover' : '')}>
          <div className="flex items-center gap-2">
          <button
            aria-label={t('models.row.dragAria', { name: model.modelName })}
            className="cursor-grab touch-none text-text-quaternary transition-colors hover:text-text-primary"
            {...handleProps}
          >
            <GripVertical size={14} />
          </button>
          <Checkbox
            checked={selected}
            onCheckedChange={value => onSelectedChange(value === true)}
            aria-label={t('models.picker.selectAria', { name: model.modelName })}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate system-xs-medium text-text-primary">{model.modelName}</span>
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 system-2xs-regular text-text-tertiary">
              <ProtocolIcons endpoints={model.endpoints} />
              {modelHealth?.consecutiveFailures ? (
                <Badge variant="destructive" className="px-1.5 py-0 system-2xs-medium">{t('models.row.consecutiveFailures', { count: modelHealth.consecutiveFailures })}</Badge>
              ) : modelHealth?.lastSuccessTime ? (
                <span className="inline-flex items-center gap-1 text-text-success">
                  <span className="size-1.5 rounded-full bg-success" />
                  {t('models.row.lastSuccess')}
                </span>
              ) : (
                <span className="text-text-quaternary">{t('models.row.noRequests')}</span>
              )}
              {ruleNames.length > 0 && <>
                <span className="text-text-quaternary">·</span>
                {ruleNames.map(name => <Badge key={name} variant="muted" className="max-w-40 truncate px-1.5 py-0 system-2xs-medium">{name}</Badge>)}
              </>}
            </div>
          </div>
          <Switch
            checked={model.enabled}
            onCheckedChange={enabled => onToggleModelEnabled(model, enabled)}
            aria-label={t('models.row.enabledState', { name: model.modelName })}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            title={t('models.row.edit')}
            onClick={() => onEditModel(model)}
          >
            <Pencil size={13} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-text-tertiary hover:text-text-destructive"
            title={t('models.row.delete')}
            onClick={() => onRemoveModel(model)}
          >
            <Trash2 size={13} />
          </Button>
          </div>
        </div>
      )}
    </SortableProviderModel>
  )
}
