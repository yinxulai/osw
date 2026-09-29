import { Plus } from 'lucide-react'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useTranslation } from '@/i18n/provider'
import { createControlItem } from '@common/router/presets'
import { WorkflowButton } from '../components/workflow-button'
import type { NodePanelProps } from '../node-data'
import { localizeNewControlItem } from '../node-meta'
import type { ControlInputNode } from '@common/router/types'
import {
  NodePanelCard,
  NodePanelField,
  NodePanelGroupHeader,
  PANEL_POPUP_ITEM_CLASSNAME,
  PANEL_POPUP_SURFACE_CLASSNAME,
} from './panel-fields'

export function ControlInputPanel(props: NodePanelProps) {
  const { model, update } = props
  const node = model as ControlInputNode
  const t = useTranslation()

  const patchControl = (controlId: string, patch: Record<string, unknown>) => {
    update(current => current.kind === 'control-input'
      ? {
        ...current,
        controls: current.controls.map(item => item.id === controlId ? { ...item, ...patch } : item),
      }
      : current)
  }

  // 「这个节点是什么」由外壳那条提示条统一讲，面板里从控制项清单开始。
  return (
    <div className="grid gap-2.5">
      {node.controls.map((control, index) => (
        <NodePanelCard key={control.id}>
          <NodePanelGroupHeader
            title={t('router.panel.controlIndex', { index: index + 1 })}
            action={(
              <WorkflowButton
                variant="ghost-destructive"
                onClick={() => update(current => current.kind === 'control-input'
                  ? { ...current, controls: current.controls.filter(item => item.id !== control.id) }
                  : current)}
              >
                {t('router.panel.delete')}
              </WorkflowButton>
            )}
          />

          <NodePanelField label={t('router.panel.controlKey')}>
            <Input value={control.key} onChange={event => patchControl(control.id, { key: event.target.value })} />
          </NodePanelField>

          <NodePanelField label={t('router.panel.controlLabel')}>
            <Input value={control.label} onChange={event => patchControl(control.id, { label: event.target.value })} />
          </NodePanelField>

          <div className="grid grid-cols-2 gap-2">
            <NodePanelField label={t('router.panel.controlKind')}>
              <Select
                value={control.kind}
                onValueChange={value => update(current => current.kind === 'control-input'
                  ? {
                    ...current,
                    controls: current.controls.map(item => {
                      if (item.id !== control.id) return item
                      if (value === 'switch') {
                        return {
                          ...item,
                          kind: 'switch' as const,
                          defaultValue: typeof item.defaultValue === 'boolean' ? item.defaultValue : true,
                          options: undefined,
                        }
                      }
                      return {
                        ...item,
                        kind: 'select' as const,
                        defaultValue: typeof item.defaultValue === 'string'
                          ? item.defaultValue
                          : (item.options?.[0]?.value ?? 'balanced'),
                        options: item.options?.length
                          ? item.options
                          : [
                            { label: t('router.panel.defaultOptionBalanced'), value: 'balanced' },
                            { label: t('router.panel.defaultOptionFast'), value: 'fast' },
                          ],
                      }
                    }),
                  }
                  : current)}
              >
                <SelectTrigger className="w-full"><SelectValue placeholder={t('router.panel.placeholder.controlKind')} /></SelectTrigger>
                <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
                  <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} value="switch">{t('router.panel.controlKindSwitch')}</SelectItem>
                  <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} value="select">{t('router.panel.controlKindSelect')}</SelectItem>
                </SelectContent>
              </Select>
            </NodePanelField>

            <div className="flex items-end justify-between gap-2 rounded-lg border border-module-border bg-workflow-block-parma-bg px-2.5 py-2">
              <span className="system-xs-regular text-text-secondary">{t('router.panel.controlEnabled')}</span>
              <Switch
                checked={control.enabled}
                onCheckedChange={checked => patchControl(control.id, { enabled: checked })}
              />
            </div>
          </div>

          {control.kind === 'switch' && (
            <div className="flex items-center justify-between rounded-lg border border-module-border bg-workflow-block-parma-bg px-2.5 py-2">
              <span className="system-xs-regular text-text-secondary">{t('router.panel.controlDefaultOn')}</span>
              <Switch
                checked={Boolean(control.defaultValue)}
                onCheckedChange={checked => patchControl(control.id, { defaultValue: checked })}
              />
            </div>
          )}

          {control.kind === 'select' && (
            <div className="grid gap-2.5">
              <NodePanelField label={t('router.panel.controlDefaultValue')}>
                <Select
                  value={typeof control.defaultValue === 'string'
                    ? control.defaultValue
                    : (control.options?.[0]?.value ?? '')}
                  onValueChange={value => patchControl(control.id, { defaultValue: value })}
                >
                  <SelectTrigger className="w-full"><SelectValue placeholder={t('router.panel.placeholder.defaultValue')} /></SelectTrigger>
                  <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
                    {(control.options ?? []).map(option => (
                      <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </NodePanelField>

              <NodePanelField label={t('router.panel.controlOptions')}>
                <Textarea
                  value={(control.options ?? []).map(option => option.value).join('\n')}
                  onChange={(event) => {
                    const options = event.target.value
                      .split('\n')
                      .map(option => option.trim())
                      .filter(Boolean)
                      .map(option => ({ label: option, value: option }))
                    patchControl(control.id, { options, defaultValue: options[0]?.value ?? '' })
                  }}
                  className="min-h-24"
                />
              </NodePanelField>
            </div>
          )}
        </NodePanelCard>
      ))}

      <WorkflowButton
        onClick={() => update(current => current.kind === 'control-input'
          ? { ...current, controls: [...current.controls, localizeNewControlItem(t, createControlItem('switch'))] }
          : current)}
      >
        <Plus className="size-3.5" aria-hidden /> {t('router.panel.addControl')}
      </WorkflowButton>
    </div>
  )
}
