import { useState } from 'react'
import { Plus, Sparkles, Trash2 } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { FormField } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { PanelCodeEditor } from '@/pages/router/panel/panel-code-editor'
import { useTranslation, type AppTranslator } from '@/i18n/provider'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { REWRITE_SCRIPT_TIMEOUT_DEFAULT, REWRITE_SCRIPT_TIMEOUT_LIMIT } from '@common/schemas'
import type { SchemaFieldDescriptor } from '@common/router/types'
import { defaultRewriteScript, rewriteScriptSamplesForStage, shouldReseedScript } from '../rewrite-script-samples'
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

/**
 * 脚本编辑器里的路径候选。
 *
 * 修改器脚本能读的是「当前阶段报文的任意字段」，不对应任何上游 schema，因此这里给的是一份
 * 面向三个协议共同根字段的静态清单，而不是拼上给智能路由用的动态 `SchemaFieldDescriptor`。
 * 目的是让 `get('` 与 `body.` 后弹出的候选能覆盖到最常见的几个字段，而不是提供穷举。
 */
const SCRIPT_FIELDS: SchemaFieldDescriptor[] = [
  { path: 'model', valueType: 'string', sourceNodeId: '', sourcePort: '', note: 'Model identifier' },
  { path: 'messages', valueType: 'array', sourceNodeId: '', sourcePort: '', note: 'Chat messages' },
  { path: 'messages[*]', valueType: 'object', sourceNodeId: '', sourcePort: '' },
  { path: 'messages[*].role', valueType: 'enum', sourceNodeId: '', sourcePort: '', enumOptions: ['system', 'user', 'assistant', 'tool'] },
  { path: 'messages[*].content', valueType: 'unknown', sourceNodeId: '', sourcePort: '' },
  { path: 'input', valueType: 'unknown', sourceNodeId: '', sourcePort: '', note: 'Responses API input' },
  { path: 'instructions', valueType: 'string', sourceNodeId: '', sourcePort: '', note: 'Responses API system instructions' },
  { path: 'system', valueType: 'unknown', sourceNodeId: '', sourcePort: '', note: 'Anthropic system prompt' },
  { path: 'max_tokens', valueType: 'number', sourceNodeId: '', sourcePort: '' },
  { path: 'max_output_tokens', valueType: 'number', sourceNodeId: '', sourcePort: '' },
  { path: 'temperature', valueType: 'number', sourceNodeId: '', sourcePort: '' },
  { path: 'top_p', valueType: 'number', sourceNodeId: '', sourcePort: '' },
  { path: 'stream', valueType: 'boolean', sourceNodeId: '', sourcePort: '', note: 'Delivery mode; protected against modification' },
  { path: 'metadata', valueType: 'object', sourceNodeId: '', sourcePort: '' },
  { path: 'tools', valueType: 'array', sourceNodeId: '', sourcePort: '' },
  { path: 'tool_choice', valueType: 'unknown', sourceNodeId: '', sourcePort: '' },
]

interface ActionEditorProps {
  actions: RuleAction[]
  onChange: (actions: RuleAction[]) => void
}

interface ScriptTimeoutInputProps {
  action: RuleAction
  onChange: (patch: Partial<RuleAction>) => void
  t: AppTranslator
}

/**
 * 脚本超时输入框。
 *
 * 输入过程中允许出现非数字／超范围的中间态，失去焦点时才归一：直接边输入边钳制，
 * 用户删光重敲（`""` → 想输 `1500`）会被立刻回填成默认值，反而没法编辑。
 */
function ScriptTimeoutInput(props: ScriptTimeoutInputProps) {
  const { action, onChange, t } = props
  const [draft, setDraft] = useState<string | undefined>(undefined)
  const value = draft ?? String(action.timeoutMilliseconds ?? REWRITE_SCRIPT_TIMEOUT_DEFAULT)
  const commit = () => {
    const parsed = Number(draft)
    onChange({ timeoutMilliseconds: Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.round(parsed), REWRITE_SCRIPT_TIMEOUT_LIMIT) : REWRITE_SCRIPT_TIMEOUT_DEFAULT })
    setDraft(undefined)
  }
  return (
    <FormField label={t('rules.actions.scriptTimeoutLabel')} htmlFor={`${action.id}-timeout`} hint={t('rules.actions.scriptTimeoutHint', { limit: REWRITE_SCRIPT_TIMEOUT_LIMIT })}>
      <Input
        id={`${action.id}-timeout`}
        type="number"
        inputMode="numeric"
        min={1}
        max={REWRITE_SCRIPT_TIMEOUT_LIMIT}
        value={value}
        className="font-mono"
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
      />
    </FormField>
  )
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
          const isScript = action.target === 'script'
          const isHeader = action.target === 'header'
          const isRemove = action.operation === 'remove'
          const isReplace = action.operation === 'replace'
          const operations = isHeader ? (['set', 'append', 'remove'] as RuleActionOperation[]) : (['set', 'remove', 'replace'] as RuleActionOperation[])
          const labels = targetFieldLabels(t, action.target, action.operation)

          return (
            <div key={action.id} className="rounded-lg border border-module-border p-3">
              <div className="flex flex-wrap items-center gap-1.5 pb-3">
                <span className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-md bg-inset font-mono system-2xs-medium text-text-tertiary">{index + 1}</span>
                <Select value={action.stage} onValueChange={value => {
                  const stage = value as 'request' | 'response'
                  // 阶段改了，起始脚本也该跟着换：请求基线和响应基线读的是两个不一样的报文，
                  // 把请求脚本留在响应阶段等于给用户一个跑不通的起点。是否替换由 `shouldReseedScript`
                  // 判定——只有编辑器里还是「原阶段的默认基线」（用户没动过）时才换。
                  updateAction(action.id, shouldReseedScript(action.code, action.stage, stage)
                    ? { stage, code: defaultRewriteScript(stage) }
                    : { stage })
                }}>
                  <SelectTrigger aria-label={t('rules.actions.stageAria', { index: index + 1 })}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="request">{t('rules.stage.request')}</SelectItem><SelectItem value="response">{t('rules.stage.response')}</SelectItem></SelectContent>
                </Select>
                <Select value={action.target} onValueChange={value => {
                  const target = value as RuleActionTarget
                  // 切到脚本时填入起始脚本：空白编辑器对第一次用的人无从下手，示例就是那份「能直接跑通」的起点。
                  if (target === 'script') updateAction(action.id, { target, operation: 'set', value: '', code: action.code || defaultRewriteScript(action.stage), timeoutMilliseconds: action.timeoutMilliseconds ?? REWRITE_SCRIPT_TIMEOUT_DEFAULT })
                  else updateAction(action.id, { target, operation: 'set', value: '' })
                }}>
                  <SelectTrigger aria-label={t('rules.actions.targetAria', { index: index + 1 })}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="header">{t('rules.actions.target.header')}</SelectItem><SelectItem value="body">{t('rules.actions.target.body')}</SelectItem><SelectItem value="script">{t('rules.actions.target.script')}</SelectItem></SelectContent>
                </Select>
                {/*
                 * 脚本动作没有「操作」（设置/追加/删除/替换），那一格正好是放「插入示例」的地方：
                 * 对脚本来说，「从哪段代码起手」就是它与其它动作对应的那个第一层选择。把它并进这一行，
                 * 与删除、替换、设置这些并列，而不是单独占一行压住代码编辑器。
                 */}
                {isScript ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-8 px-2.5 system-xs-medium')}>
                      <Sparkles aria-hidden />
                      {t('rules.actions.scriptSampleLabel')}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" sideOffset={6} className="w-80 min-w-80">
                      {rewriteScriptSamplesForStage(action.stage).map(sample => (
                        <DropdownMenuItem
                          key={sample.id}
                          onSelect={() => updateAction(action.id, { code: sample.code })}
                          className="flex h-auto flex-col items-stretch gap-0.5 rounded-lg px-2 py-1.5 focus:bg-state-base-hover"
                        >
                          <span className="system-xs-medium text-text-primary">{t(sample.nameKey)}</span>
                          <span className="system-2xs-regular text-text-tertiary">{t(sample.descriptionKey)}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Select value={action.operation} onValueChange={value => updateAction(action.id, { operation: value as RuleActionOperation })}>
                    <SelectTrigger aria-label={t('rules.actions.operationAria', { index: index + 1 })}><SelectValue /></SelectTrigger>
                    <SelectContent>{operations.map(operation => <SelectItem key={operation} value={operation}>{t(OPERATION_LABEL_KEY[operation])}</SelectItem>)}</SelectContent>
                  </Select>
                )}
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t('rules.actions.deleteAria')} className="ml-auto text-text-tertiary hover:text-text-destructive" onClick={() => setDeleteActionId(action.id)}>
                  <Trash2 />
                </Button>
              </div>

              {isScript ? (
                <div className="mt-3 grid gap-3">
                  <FormField label={t('rules.actions.scriptCodeLabel')} htmlFor={`${action.id}-code`} hint={t('rules.actions.scriptCodeHint')}>
                    <PanelCodeEditor
                      language="rewrite-script"
                      fields={SCRIPT_FIELDS}
                      value={action.code ?? ''}
                      minHeight={140}
                      maxHeight={280}
                      placeholder={action.stage === 'response' ? t('rules.actions.scriptPlaceholder.response') : t('rules.actions.scriptPlaceholder.request')}
                      onChange={code => updateAction(action.id, { code })}
                    />
                  </FormField>
                  <ScriptTimeoutInput action={action} t={t} onChange={patch => updateAction(action.id, patch)} />
                </div>
              ) : (
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
              )}
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
