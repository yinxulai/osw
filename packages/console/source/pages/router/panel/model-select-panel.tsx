import { useCallback, useMemo } from 'react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { NodePanelProps, PanelLogicalModel } from '../node-data'
import { useTranslation } from '@/i18n/provider'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import type { ModelSelectSource } from '@common/router/types'
import { MODEL_SELECT_OUTPUT_FIELDS } from '../model-select-shape'
import { readCandidates } from './field-candidates'
import {
  NodePanelField,
  NodePanelGroupHeader,
  NodePanelHint,
  NodePanelShapeCard,
  PANEL_POPUP_ITEM_CLASSNAME,
  PANEL_POPUP_SURFACE_CLASSNAME,
} from './panel-fields'

type ModelField = 'modelIds' | 'fallbackModelIds'

interface SourceOption {
  value: ModelSelectSource
  labelKey: UiCatalogKey
  descriptionKey: UiCatalogKey
}

const SOURCE_OPTIONS: SourceOption[] = [
  {
    value: 'fixed',
    labelKey: 'router.panel.sourceFixed.label',
    descriptionKey: 'router.panel.sourceFixed.description',
  },
  {
    value: 'variable',
    labelKey: 'router.panel.sourceVariable.label',
    descriptionKey: 'router.panel.sourceVariable.description',
  },
]

export function ModelSelectPanel(props: NodePanelProps) {
  const { model, nodeModels, logicalModels, conditionFieldHints, update } = props
  const node = model.kind === 'model-select' ? model : undefined
  const source = node?.source ?? 'fixed'
  const variablePath = node?.variablePath ?? ''
  const modelIds = node?.modelIds ?? []
  const fallbackModelIds = node?.fallbackModelIds ?? []
  const t = useTranslation()

  const activeDescription = useMemo(
    () => {
      const option = SOURCE_OPTIONS.find(item => item.value === source)
      return option ? t(option.descriptionKey) : ''
    },
    [source, t],
  )

  /** 变量取值只能来自字符串 / 字符串数组字段：逻辑模型 id 的形态。 */
  const variableFields = useMemo(
    () => readCandidates('model-select', conditionFieldHints),
    [conditionFieldHints],
  )

  const sourceNameOf = useMemo(
    () => new Map(nodeModels.map(item => [item.id, item.name])),
    [nodeModels],
  )

  const toggleModel = useCallback((field: ModelField, modelId: string, checked: boolean) => {
    update(current => {
      if (current.kind !== 'model-select') return current
      const selected = current[field]
      return {
        ...current,
        [field]: checked
          ? [...new Set([...selected, modelId])]
          : selected.filter(id => id !== modelId),
      }
    })
  }, [update])

  if (!node) return null

  return (
    <div className="grid gap-2.5">
      <NodePanelField label={t('router.panel.source')}>
        <Select
          value={source}
          onValueChange={value => update(current => current.kind === 'model-select'
            ? { ...current, source: value as ModelSelectSource }
            : current)}
        >
          <SelectTrigger className="w-full"><SelectValue placeholder={t('router.panel.placeholder.source')} /></SelectTrigger>
          <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
            {SOURCE_OPTIONS.map(option => (
              <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} key={option.value} value={option.value}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </NodePanelField>

      <NodePanelHint>{activeDescription}</NodePanelHint>

      {source === 'variable' && (
        <NodePanelField label={t('router.panel.variablePath')}>
          <Select
            value={variablePath || undefined}
            onValueChange={value => update(current => current.kind === 'model-select'
              ? { ...current, variablePath: value }
              : current)}
          >
            <SelectTrigger className="w-full"><SelectValue placeholder={t('router.panel.placeholder.fieldPath')} /></SelectTrigger>
            <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
              {variableFields.map(field => (
                <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} key={field.path} value={field.path}>
                  {/* 名称前置：先看「来自哪个节点」，再看具体字段路径与类型。 */}
                  {sourceNameOf.get(field.sourceNodeId) ?? field.sourceNodeId} · {field.path} · {field.valueType}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </NodePanelField>
      )}

      {source === 'variable' && variableFields.length === 0 && (
        <NodePanelHint tone="warning">
          {t('router.panel.variableNoFields')}
        </NodePanelHint>
      )}

      {source === 'fixed'
        ? (
          <ModelPicker
            emptyHint={t('router.panel.noLogicalModels')}
            logicalModels={logicalModels}
            onToggle={toggleModel}
            selectedIds={modelIds}
            target="modelIds"
            title={t('router.panel.targetModels')}
          />
        )
        : (
          <ModelPicker
            emptyHint={t('router.panel.fallbackEmpty')}
            logicalModels={logicalModels}
            onToggle={toggleModel}
            selectedIds={fallbackModelIds}
            target="fallbackModelIds"
            title={t('router.panel.fallbackModels')}
          />
        )}

      {/* 输出声明与字段候选表同源（`../model-select-shape.ts`）：下游在条件下拉、
          `get()` 补全里能选到的落点路径，这里都列着。 */}
      <NodePanelShapeCard
        title={t('router.panel.modelSelectShapeTitle')}
        groups={[{
          fields: MODEL_SELECT_OUTPUT_FIELDS.map(field => ({
            path: field.path,
            valueType: field.valueType,
            note: t(field.noteKey),
          })),
        }]}
      />
    </div>
  )
}

interface ModelPickerProps {
  title: string
  emptyHint: string
  logicalModels: PanelLogicalModel[]
  selectedIds: string[]
  target: ModelField
  onToggle: (target: ModelField, modelId: string, checked: boolean) => void
}

function ModelPicker(props: ModelPickerProps) {
  const { title, emptyHint, logicalModels, selectedIds, target, onToggle } = props
  const t = useTranslation()

  return (
    <div className="grid gap-2">
      <NodePanelGroupHeader title={title} />
      {logicalModels.length === 0 && <NodePanelHint tone="warning">{emptyHint}</NodePanelHint>}
      <div className="grid gap-1.5">
        {logicalModels.map(logicalModel => (
          <label key={logicalModel.id} className="flex items-start gap-2 rounded-lg border border-module-border bg-workflow-block-parma-bg px-2.5 py-2">
            <input
              type="checkbox"
              className="mt-0.5 shrink-0"
              checked={selectedIds.includes(logicalModel.id)}
              onChange={event => onToggle(target, logicalModel.id, event.target.checked)}
            />
            {/* 名称与 id 占一行、说明另起一行：说明通常比名称长得多，挤在同一行会把两者都截断。 */}
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate system-xs-medium text-text-secondary">{logicalModel.name}</span>
                <span className="shrink-0 font-mono system-2xs-regular text-text-tertiary">{logicalModel.id}</span>
              </span>
              <span className="line-clamp-2 system-xs-regular text-text-tertiary">
                {logicalModel.description?.trim() || t('router.panel.modelNoDescription')}
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}
