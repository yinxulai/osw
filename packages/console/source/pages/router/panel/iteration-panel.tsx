import { useCallback, useMemo } from 'react'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ITERATION_COLLECT_MODE_HINTS, ITERATION_COLLECT_MODE_LABELS } from '../node-meta'
import { useTranslation } from '@/i18n/provider'
import type { NodePanelProps } from '../node-data'
import type { IterationCollectMode, IterationNode } from '@common/router/types'
import { readCandidates } from './field-candidates'
import {
  NodePanelField,
  NodePanelHint,
  PANEL_POPUP_ITEM_CLASSNAME,
  PANEL_POPUP_SURFACE_CLASSNAME,
} from './panel-fields'

const COLLECT_MODES: IterationCollectMode[] = ['first', 'last', 'list', 'count']

/**
 * 遍历迭代节点面板。
 *
 * 面板只描述「遍历什么、怎么收」，不描述「循环体长什么样」——
 * 循环体就是 body 端口接出去的那条链路，回边连回本节点即代表一轮结束。
 */
export function IterationPanel(props: NodePanelProps) {
  const { model, conditionFieldHints, update } = props
  const node = model.kind === 'iteration' ? model : undefined
  const sourcePath = node?.sourcePath ?? ''
  const collectPath = node?.collectPath ?? ''
  const resultPath = node?.resultPath ?? ''
  const collectMode = node?.collectMode ?? 'first'
  const maxIterations = node?.maxIterations ?? 10
  const t = useTranslation()

  const patch = useCallback((patchValue: Partial<IterationNode>) => {
    update(current => current.kind === 'iteration' ? { ...current, ...patchValue } : current)
  }, [update])

  /** 可遍历的候选来源：只有数组和对象能被遍历。 */
  const iterableFields = useMemo(
    () => readCandidates('iteration', conditionFieldHints),
    [conditionFieldHints],
  )

  /** 结果路径的候选：能承载「值 / 列表 / 轮数」的字段都算。 */
  const resultFields = useMemo(
    () => conditionFieldHints.filter(field => !field.path.startsWith('route.iteration.')),
    [conditionFieldHints],
  )

  if (!node) return null

  return (
    <div className="grid gap-2.5">
      <NodePanelHint>
        {t('router.panel.iterationHintPrefix')}
        <span className="font-mono">logicalModels[*].modelId</span>
        {t('router.panel.iterationHintSuffix')}
      </NodePanelHint>

      <NodePanelField label={t('router.panel.iterationSourcePath')}>
        <Input
          value={sourcePath}
          placeholder={t('router.panel.iterationSourcePlaceholder')}
          onChange={event => patch({ sourcePath: event.target.value })}
        />
        {iterableFields.length > 0 && (
          <Select value={sourcePath || undefined} onValueChange={value => patch({ sourcePath: value })}>
            <SelectTrigger className="w-full"><SelectValue placeholder={t('router.panel.selectFromSchema')} /></SelectTrigger>
            <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
              {iterableFields.map(field => (
                <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} key={field.path} value={field.path}>
                  {field.path} · {field.valueType}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </NodePanelField>

      {iterableFields.length === 0 && (
        <NodePanelHint tone="warning">
          {t('router.panel.iterationNoFields')}
        </NodePanelHint>
      )}

      <NodePanelField label={t('router.panel.collectPath')}>
        <Input
          value={collectPath}
          placeholder="route.modelIds"
          onChange={event => patch({ collectPath: event.target.value })}
        />
      </NodePanelField>

      <NodePanelField label={t('router.panel.collectMode')}>
        <Select
          value={collectMode}
          onValueChange={value => patch({ collectMode: value as IterationCollectMode })}
        >
          <SelectTrigger className="w-full"><SelectValue placeholder={t('router.panel.placeholder.collectMode')} /></SelectTrigger>
          <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
            {COLLECT_MODES.map(mode => (
              <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} key={mode} value={mode}>
                {t(ITERATION_COLLECT_MODE_LABELS[mode])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </NodePanelField>

      <NodePanelHint>{t(ITERATION_COLLECT_MODE_HINTS[collectMode])}</NodePanelHint>

      <NodePanelField label={t('router.panel.summaryPath')}>
        <Input
          value={resultPath}
          placeholder="route.modelIds"
          onChange={event => patch({ resultPath: event.target.value })}
        />
        {resultFields.length > 0 && (
          <Select value={resultPath || undefined} onValueChange={value => patch({ resultPath: value })}>
            <SelectTrigger className="w-full"><SelectValue placeholder={t('router.panel.selectFromSchema')} /></SelectTrigger>
            <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
              {resultFields.map(field => (
                <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} key={field.path} value={field.path}>
                  {field.path} · {field.valueType}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </NodePanelField>

      <NodePanelField label={t('router.panel.maxIterations')}>
        <Input
          type="number"
          min={1}
          value={String(maxIterations)}
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10)
            patch({ maxIterations: Number.isFinite(next) && next > 0 ? next : 1 })
          }}
        />
      </NodePanelField>

      <NodePanelHint tone="warning">
        {t('router.panel.iterationLoopPrefix')}
        {' '}
        <span className="font-mono">route.iteration.item</span>
        {' / '}
        <span className="font-mono">key</span>
        {' / '}
        <span className="font-mono">index</span>
        {' / '}
        <span className="font-mono">total</span>
        {' '}
        {t('router.panel.iterationLoopSuffix')}
      </NodePanelHint>
    </div>
  )
}
