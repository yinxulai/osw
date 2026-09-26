import { ROUTE_MODE_OPTIONS } from '@/components/route-mode/route-mode-options'
import { RouteModeOptionCard } from '@/components/route-mode/route-mode-option-card'
import { useRouteMode } from '@/components/route-mode/use-route-mode'
import { useTranslation } from '@/i18n/provider'
import { RoutePlanList } from './route-plan-list'
import { TraitsDisclosure } from '../components/traits-disclosure'

/**
 * 第一步：选路由策略 / 规则。
 *
 * 选中即生效（`switchMode` 内部已经处理「同模式短路」和「切换中防重」），不设「确定」按钮：
 * 这一步的产物就是一个模式值，没有别的字段要一起提交，多一次确认只是多一次点击。
 *
 * 两张卡片和模式弹窗里的是**同一个组件**（`RouteModeOptionCard`），但这里传 `compact`：
 * 弹窗那边是「看清楚再选」，两栏逐条对着读才有意义；这一步的读者连模型都还没有，
 * 先要的是「选一个、往下走」。差异点没有丢，收进下面的 `TraitsDisclosure`，想比的人展开就有。
 *
 * 首屏因此只剩下三样东西：一句「不选也行」、两张只有名字与一句话摘要的卡片、一份方案清单。
 * 那句结论是这一步**最要紧的一句话**：用户读到这里最容易得出的错误结论是
 * 「我得先设计一套路由架构」，而事实是内建默认已经在跑，换不换都只是选个起点。
 */
export function RouteModeStep() {
  const { mode, switching, switchMode } = useRouteMode()
  const t = useTranslation()

  return (
    <div className="space-y-6">
      {/* 结论先摆出来：它比两张卡片更需要被读到，所以占在它们上面。 */}
      <p className="system-xs-regular text-text-secondary">
        {t('onboarding.step.routeMode.defaultHint')}
      </p>

      <div className="space-y-3">
        <div
          role="radiogroup"
          aria-label={t('router.mode.dialog.title')}
          className="grid gap-3 sm:grid-cols-2"
        >
          {ROUTE_MODE_OPTIONS.map(option => (
            <RouteModeOptionCard
              key={option.value}
              option={option}
              active={option.value === mode}
              switching={switching}
              compact
              onSelect={() => void switchMode(option.value)}
            />
          ))}
        </div>
        <TraitsDisclosure />
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h3 className="system-sm-medium text-text-primary">{t('onboarding.step.routeMode.planTitle')}</h3>
          <p className="system-xs-regular text-text-tertiary">
            {t('onboarding.step.routeMode.planDescription')}
          </p>
        </div>
        <RoutePlanList />
      </section>
    </div>
  )
}
