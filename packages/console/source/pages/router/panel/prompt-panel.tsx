import { useCallback, useMemo } from 'react'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { NodePanelProps } from '../node-data'
import { useTranslation } from '@/i18n/provider'
import { PROMPT_TIMEOUT_LIMIT, type PromptNode } from '@common/router/types'
import { readCandidates } from './field-candidates'
import { PanelCodeEditor } from './panel-code-editor'
import {
  NodePanelField,
  NodePanelHint,
  PANEL_POPUP_ITEM_CLASSNAME,
  PANEL_POPUP_SURFACE_CLASSNAME,
} from './panel-fields'

/**
 * LLM 节点面板。
 *
 * 这里只选「用哪个逻辑模型 + 说什么」，真正的调用由服务端走真实上游通路执行
 * （密钥、协议转换、故障转移全部沿用请求链路），所以面板不提供任何连接配置项。
 */
export function PromptPanel(props: NodePanelProps) {
  const { model, logicalModels, conditionFieldHints, update } = props
  const node = model.kind === 'prompt' ? model : undefined
  const logicalModelId = node?.logicalModelId ?? ''
  const systemPrompt = node?.systemPrompt ?? ''
  const promptTemplate = node?.promptTemplate ?? ''
  const resultPath = node?.resultPath ?? ''
  const temperature = node?.temperature ?? 0.7
  const maxTokens = node?.maxTokens ?? 1_024
  const timeoutMilliseconds = node?.timeoutMilliseconds ?? 60_000
  const t = useTranslation()

  const patch = useCallback((patchValue: Partial<PromptNode>) => {
    update(current => current.kind === 'prompt' ? { ...current, ...patchValue } : current)
  }, [update])

  /** 提示词模板变量候选：`${}` 对非标量做 JSON 序列化，所以整体字段（如 request.body）也能拼。 */
  const templateFields = useMemo(
    () => readCandidates('prompt', conditionFieldHints),
    [conditionFieldHints],
  )

  const selectedModel = useMemo(
    () => logicalModels.find(item => item.modelId === logicalModelId),
    [logicalModels, logicalModelId],
  )

  const handleSystemPromptChange = useCallback((next: string) => patch({ systemPrompt: next }), [patch])
  const handlePromptChange = useCallback((next: string) => patch({ promptTemplate: next }), [patch])

  if (!node) return null

  return (
    <div className="grid gap-2.5">
      <NodePanelHint>
        {t('router.panel.promptHintPrefix')}
        {' '}
        <span className="font-mono">{t('router.panel.promptHintVariableExample')}</span>
        {' '}
        {t('router.panel.promptHintMiddle')}
        {' '}
        <span className="font-mono">{'${'}</span>
        {' '}
        {t('router.panel.promptHintSuffix')}
      </NodePanelHint>

      <NodePanelField label={t('router.panel.logicalModel')}>
        <Select value={logicalModelId || undefined} onValueChange={value => patch({ logicalModelId: value })}>
          <SelectTrigger className="w-full"><SelectValue placeholder={t('router.panel.selectLogicalModel')} /></SelectTrigger>
          <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
            {logicalModels.map(item => (
              <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} key={item.modelId} value={item.modelId}>
                {item.modelId}{item.enabled ? '' : t('router.panel.disabledSuffix')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </NodePanelField>

      {!logicalModelId && <NodePanelHint tone="warning">{t('router.panel.warnNoLogicalModel')}</NodePanelHint>}
      {logicalModelId && !selectedModel && (
        <NodePanelHint tone="warning">{t('router.panel.warnModelMissing', { id: logicalModelId })}</NodePanelHint>
      )}
      {selectedModel && !selectedModel.enabled && (
        <NodePanelHint tone="warning">{t('router.panel.warnModelDisabled', { name: selectedModel.modelId })}</NodePanelHint>
      )}

      {/* 纯选型建议，不是本节点的必要配置，放在告警之后、具体配置项之前。 */}
      <NodePanelHint>{t('router.panel.promptModelAdvice')}</NodePanelHint>

      <NodePanelField label={t('router.panel.systemPrompt')}>
        <PanelCodeEditor
          language="template"
          fields={templateFields}
          value={systemPrompt}
          minHeight={64}
          maxHeight={200}
          placeholder={t('router.panel.systemPromptPlaceholder')}
          onChange={handleSystemPromptChange}
        />
      </NodePanelField>

      <NodePanelField label={t('router.panel.prompt')}>
        <PanelCodeEditor
          language="template"
          fields={templateFields}
          value={promptTemplate}
          minHeight={120}
          maxHeight={360}
          placeholder={t('router.panel.promptPlaceholder')}
          onChange={handlePromptChange}
        />
      </NodePanelField>

      {!promptTemplate.trim() && <NodePanelHint tone="warning">{t('router.panel.warnEmptyPrompt')}</NodePanelHint>}

      <NodePanelField label={t('router.panel.replyPath')}>
        <Select value={resultPath || undefined} onValueChange={value => patch({ resultPath: value })}>
          <SelectTrigger className="w-full"><SelectValue placeholder={t('router.panel.selectFromSchema')} /></SelectTrigger>
          <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
            {conditionFieldHints.map(field => (
              <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} key={field.path} value={field.path}>
                {field.path} · {field.valueType}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={resultPath}
          placeholder="route.promptResult"
          onChange={event => patch({ resultPath: event.target.value })}
        />
      </NodePanelField>

      {!resultPath.trim() && <NodePanelHint tone="warning">{t('router.panel.warnNoReplyPath')}</NodePanelHint>}

      <NodePanelField label={t('router.panel.temperature')}>
        <Input
          type="number"
          min={0}
          max={2}
          step={0.1}
          value={String(temperature)}
          onChange={(event) => {
            const next = Number.parseFloat(event.target.value)
            patch({ temperature: Number.isFinite(next) ? Math.min(Math.max(next, 0), 2) : 0 })
          }}
        />
      </NodePanelField>

      <NodePanelField label={t('router.panel.maxTokens')}>
        <Input
          type="number"
          min={1}
          value={String(maxTokens)}
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10)
            patch({ maxTokens: Number.isFinite(next) && next > 0 ? next : 1 })
          }}
        />
      </NodePanelField>

      <NodePanelField label={t('router.panel.timeoutMilliseconds')}>
        <Input
          type="number"
          min={1}
          max={PROMPT_TIMEOUT_LIMIT}
          value={String(timeoutMilliseconds)}
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10)
            patch({ timeoutMilliseconds: Number.isFinite(next) && next > 0 ? Math.min(next, PROMPT_TIMEOUT_LIMIT) : 1 })
          }}
        />
      </NodePanelField>
    </div>
  )
}
