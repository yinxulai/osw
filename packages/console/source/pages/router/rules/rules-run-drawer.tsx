import { ArrowRight, CirclePlay } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import type { RouteRuleRunResult } from '@common/router/route-rule-engine'
import type { RouteRuleSet } from '@common/router/route-rules'
import { builtinRouteRuleName } from './builtin-rule-name'
import { describeConditionField, describeConditions, type Translate } from './rule-summary'

interface RulesRunDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ruleSet: RouteRuleSet
  /**
   * 列表与正在生效的那一版是否已有差别。
   *
   * 差别存在时抽屉必须先声明一句「跑的是列表上这一版」：试运行本来就是为了在保存之前试，
   * 但结论卡片看上去就是在说线上会发生什么 —— 不声明，用户拿着一个还没保存的结果
   * 去查线上行为，只会以为规则没生效。
   */
  unsaved: boolean
  payloadText: string
  onPayloadTextChange: (value: string) => void
  payloadRows: number
  payloadError: string
  result: RouteRuleRunResult | null
  onRun: () => void
}

/** 把运行时读到的值收成一行：字符串直出，对象走 JSON，读不到就明说读不到。 */
function formatActual(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return value.length === 0 ? '""' : value
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * 规则表的试运行抽屉。
 *
 * 它与画布的试运行抽屉长得不一样，因为两者要回答的问题不一样：画布要回答「这一趟经过了哪些节点」，
 * 规则表要回答「为什么是这一条、为什么不是上面那一条」。所以结论在顶上（谁胜出、落到哪），
 * 逐条判定在下面按顺序排开；没命中那条把运行时读到的值直接摆出来 ——
 * 从上往下读一遍，用户自己就知道该把哪一条往上挪。
 */
export function RulesRunDrawer(props: RulesRunDrawerProps) {
  const { open, onOpenChange, ruleSet, unsaved, payloadText, onPayloadTextChange, payloadRows, payloadError, result, onRun } = props
  const t = useTranslation()
  const matchedRule = result?.matchedRuleId
    ? ruleSet.rules.find(rule => rule.id === result.matchedRuleId)
    : undefined

  const stepViews = (result?.steps ?? []).map((step, index) => {
    const rule = ruleSet.rules.find(item => item.id === step.ruleId)

    return {
      key: `${step.ruleId}-${index}`,
      index,
      step,
      winner: result?.matchedRuleId === step.ruleId,
      ruleName: (rule ? builtinRouteRuleName(rule, t) : step.ruleName) || t('router.rules.unnamed'),
      sentence: rule ? describeConditions(rule, t) : '',
      // 顺序是引擎给的，条件数组的顺序也是引擎给的，按下标配回规则原文才能说出「哪个字段」。
      unmatched: (rule?.conditions ?? []).length === step.conditions.length
        ? step.conditions
          .map((condition, position) => ({ condition, field: rule!.conditions[position] }))
          .filter(item => !item.condition.matched)
          .map(item => ({ label: describeConditionField(item.field!, t), actual: formatActual(item.condition.actual) }))
        : [],
    }
  })

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
    <DrawerContent className="workflow-test-drawer workflow-ui-surface h-full w-160! max-w-[90vw]! border-l-[0.5px] border-components-panel-border bg-background">
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-2">
            <ArrowRight className="size-4" aria-hidden /> {t('router.rules.run.title')}
          </DrawerTitle>
          {/* 抽屉的说明不重复页面标题下那句话：那里说的是「规则怎么排」，这里要说的是「跑一趟看到什么」。 */}
          <DrawerDescription>{t('router.rules.run.description')}</DrawerDescription>
        </DrawerHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
          <div className="flex flex-col gap-2">
            <div className="system-sm-medium text-text-secondary">{t('router.rules.run.inputTitle')}</div>
            <Textarea
              value={payloadText}
              onChange={event => onPayloadTextChange(event.target.value)}
              rows={payloadRows}
              className="min-h-24 resize-none font-mono text-[12px] leading-5"
            />
            {payloadError && <div className="system-xs-regular text-text-destructive">{payloadError}</div>}
          </div>

          <div className="flex flex-col gap-3">
            <div className="system-sm-medium text-text-secondary">{t('router.rules.run.resultTitle')}</div>

            {/* 摆在结论之前而不是之后：它是读结论的前提，不是结论的附注。 */}
            {unsaved && <div className="system-2xs-regular text-text-tertiary">{t('router.rules.run.unsavedNotice')}</div>}

            {!result && (
              <div className="rounded-lg border border-module-border bg-workflow-block-parma-bg p-3 system-xs-regular text-text-tertiary">
                {t('router.rules.run.emptyResult')}
              </div>
            )}

            {result && (
              <>
                <div className="grid gap-2 rounded-lg border border-module-border bg-workflow-block-parma-bg p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={result.fallback ? 'warning' : 'success'}>
                      {result.fallback ? t('router.rules.run.fallback') : t('router.rules.run.winner')}
                    </Badge>
                    {result.matchedRuleId && (
                      <span className="min-w-0 truncate system-xs-medium text-text-primary">
                        {(matchedRule ? builtinRouteRuleName(matchedRule, t) : '') || t('router.rules.unnamed')}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="system-2xs-medium-uppercase text-text-quaternary">{t('router.rules.run.landing')}</span>
                    {result.logicalModelIds.length === 0
                      ? <span className="system-xs-regular text-text-warning">{t('router.rules.landingEmpty')}</span>
                      : result.logicalModelIds.map(modelId => (
                        <code
                          key={modelId}
                          className="inline-flex h-6 items-center rounded-md border border-module-border bg-components-panel-bg px-1.5 font-mono system-2xs-regular text-text-secondary"
                        >
                          {modelId}
                        </code>
                      ))}
                  </div>
                </div>

                <div className="grid gap-1.5">
                  <div className="system-2xs-medium-uppercase text-text-quaternary">{t('router.rules.run.steps')}</div>
                  {stepViews.length === 0 && (
                    <div className="system-xs-regular text-text-tertiary">{t('router.rules.run.noRules')}</div>
                  )}
                  {stepViews.map(view => (
                    <StepRow
                      key={view.key}
                      index={view.index}
                      step={view.step}
                      winner={view.winner}
                      ruleName={view.ruleName}
                      sentence={view.sentence}
                      unmatched={view.unmatched}
                      t={t}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <DrawerFooter className="flex-row justify-end">
          <Button type="button" onClick={() => onOpenChange(false)}>{t('common.action.close')}</Button>
          <Button type="button" onClick={onRun}>
            <CirclePlay className="size-3.5" aria-hidden /> {t('router.rules.run.submit')}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

interface StepRowProps {
  index: number
  step: RouteRuleRunResult['steps'][number]
  winner: boolean
  ruleName: string
  sentence: string
  unmatched: { label: string; actual: string }[]
  t: Translate
}

/** 逐条判定里的一行：结论 + 这条规则读起来是什么 + （没命中时）运行时实际读到的值。 */
function StepRow(props: StepRowProps) {
  const { index, step, winner, ruleName, sentence, unmatched, t } = props

  return (
    <div
      className={cn(
        'grid gap-1 rounded-md border border-module-border p-2',
        winner ? 'bg-state-success-solid/10' : 'bg-workflow-block-bg',
        !step.enabled && 'opacity-55',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-mono system-2xs-regular text-text-quaternary">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate system-xs-medium text-text-primary">{ruleName}</span>
        <Badge variant={!step.enabled ? 'muted' : step.matched ? 'success' : 'warning'}>
          {!step.enabled
            ? t('router.rules.run.disabled')
            : step.matched ? t('router.rules.run.hit') : t('router.rules.run.miss')}
        </Badge>
      </div>

      {sentence && <span className="break-words system-2xs-regular text-text-tertiary">{sentence}</span>}

      {unmatched.map(item => (
        <span key={item.label} className="break-words font-mono system-2xs-regular text-text-quaternary">
          {item.label} {t('router.rules.run.actualIs')} {item.actual}
        </span>
      ))}

      {step.matched && step.logicalModelIds.length === 0 && (
        <span className="system-2xs-regular text-text-warning">{t('router.rules.run.landingNotResolved')}</span>
      )}
    </div>
  )
}
