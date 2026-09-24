import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import { useRouteMode } from '@/components/route-mode/use-route-mode'
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
 */
export function RoutePlanList() {
  const { mode } = useRouteMode()
  const t = useTranslation()
  const { options, builtInDefaultKey, currentKey, activeId, applyingId, loading, apply } = useRoutePlans(mode)

  const busy = applyingId !== null || loading

  return (
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
              'flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors',
              busy ? 'cursor-not-allowed' : 'hover:bg-state-base-hover-alt',
            )}
          >
            <span className="flex items-center gap-2">
              <span className="system-xs-medium text-text-primary">{t(option.nameKey)}</span>
              {option.isDefault && (
                <span className="rounded-md bg-secondary px-1 py-0.5 system-2xs-regular text-text-tertiary">
                  {t(builtInDefaultKey)}
                </span>
              )}
              {active && (
                <span className="ml-auto system-2xs-regular text-text-accent">{t(currentKey)}</span>
              )}
            </span>
            <span className="system-2xs-regular text-text-tertiary">{t(option.descriptionKey)}</span>
          </button>
        )
      })}
    </div>
  )
}
