import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { NodePanelProps } from '../node-data'
import { useTranslation } from '@/i18n/provider'
import type { OutputNode } from '@common/router/types'
import { NodePanelField, NodePanelSwitchRow, PANEL_POPUP_ITEM_CLASSNAME, PANEL_POPUP_SURFACE_CLASSNAME } from './panel-fields'

export function OutputPanel(props: NodePanelProps) {
  const { model, update } = props
  const node = model as OutputNode
  const t = useTranslation()

  return (
    <div className="grid gap-2.5">
      <NodePanelSwitchRow
        label={t('router.panel.includeTrace')}
        checked={node.includeTrace}
        onCheckedChange={checked => update(current => current.kind === 'output' ? { ...current, includeTrace: checked } : current)}
      />

      <NodePanelField label={t('router.panel.summaryLevel')}>
        <Select
          value={node.summaryLevel}
          onValueChange={value => update(current => current.kind === 'output'
            ? { ...current, summaryLevel: value as OutputNode['summaryLevel'] }
            : current)}
        >
          <SelectTrigger className="w-full"><SelectValue placeholder={t('router.panel.placeholder.summaryLevel')} /></SelectTrigger>
          <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
            <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} value="brief">{t('router.panel.summaryBrief')}</SelectItem>
            <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} value="detailed">{t('router.panel.summaryDetailed')}</SelectItem>
          </SelectContent>
        </Select>
      </NodePanelField>
    </div>
  )
}
