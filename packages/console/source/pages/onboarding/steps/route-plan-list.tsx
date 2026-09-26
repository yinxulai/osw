import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import { useRouteMode } from '@/components/route-mode/use-route-mode'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useRoutePlans } from '../hooks/use-route-plans'

/**
 * 内置方案清单：点一项就把整份定义换成那个方案，并立刻保存生效。
 *
 * 之所以是**清单**而不是下拉：下拉要先点开才知道有几个候选，而这里的候选是「你要拿哪一套骨架」
 * ——是这一步真正要做的判断，四项一字排开才比得出来（下拉那条路子在两个工作台的页头，
 * 那里是「改一下当前这套」，前提是先看见正文）。
 *
 * 不设确认弹窗：套方案不改任何用户已填的东西（这份定义本来就还没填过），
 * 而没套错这一说 —— 再点另一项就换过去了，每套一次都留一个可回滚的版本。
 *
 * 每行**只留名字**（外加「内置默认」角标与「当前」标记），四段说明收进下面那个折叠区。
 * 理由与模式差异点相同：清单要回答的是「现在跑的是哪一套、要不要换」，名字与标记就答完了；
 * 四段一屏并列的段落会先被读成「这四个都得弄明白」，而实际上挑名字最顺眼那个就行，
 * 编辑器就在「路由」页，随时能改。说明没有删，收起来是为了让它别挡在决定前面。
 */
export function RoutePlanList() {
  const [showDescriptions, setShowDescriptions] = useState(false)
  const { mode } = useRouteMode()
  const t = useTranslation()
  const { options, builtInDefaultKey, currentKey, activeId, applyingId, loading, apply } = useRoutePlans(mode)

  const busy = applyingId !== null || loading

  return (
    <div className="space-y-2">
      <div className="divide-y divide-border/50 overflow-hidden rounded-xl border border-module-border">
        {options.map(option => {
          const active = option.id === activeId
          return (
            <button
              key={option.id}
              type="button"
              disabled={busy}
              aria-pressed={active}
              onClick={() => apply(option.id)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors',
                busy ? 'cursor-not-allowed' : 'hover:bg-state-base-hover-alt',
              )}
            >
              <span className="system-xs-medium text-text-primary">{t(option.nameKey)}</span>
              {option.isDefault && (
                <span className="rounded-md bg-secondary px-1 py-0.5 system-2xs-regular text-text-tertiary">
                  {t(builtInDefaultKey)}
                </span>
              )}
              {active && (
                <span className="ml-auto system-2xs-regular text-text-accent">{t(currentKey)}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* 说明是**参考**，不是决定的一部分：想比较的人点开，读完就收起。 */}
      <Collapsible open={showDescriptions} onOpenChange={setShowDescriptions}>
        <CollapsibleTrigger
          className={cn(
            'inline-flex items-center gap-1 rounded-md system-2xs-regular text-text-tertiary outline-none transition-colors',
            'hover:text-text-primary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          )}
        >
          <ChevronDown
            size={12}
            aria-hidden
            className={cn('transition-transform', !showDescriptions && '-rotate-90')}
          />
          {showDescriptions
            ? t('onboarding.step.routeMode.plans.collapse')
            : t('onboarding.step.routeMode.plans.expand')}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <dl className="grid gap-2 pt-2">
            {options.map(option => (
              <div key={option.id} className="flex gap-2">
                <dt className="shrink-0 system-2xs-medium text-text-secondary">{t(option.nameKey)}</dt>
                <dd className="min-w-0 system-2xs-regular text-text-tertiary">
                  {t(option.descriptionKey)}
                </dd>
              </div>
            ))}
          </dl>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
