import { ROUTE_MODE_OPTIONS } from '@/components/route-mode/route-mode-options'
import { RouteModeOptionCard } from '@/components/route-mode/route-mode-option-card'
import { useRouteMode } from '@/components/route-mode/use-route-mode'
import { useTranslation } from '@/i18n/provider'
import { RoutePlanList } from './route-plan-list'

/**
 * 第一步：选路由策略 / 规则。
 *
 * 选中即生效（`switchMode` 内部已经处理「同模式短路」和「切换中防重」），不设「确定」按钮：
 * 这一步的产物就是一个模式值，没有别的字段要一起提交，多一次确认只是多一次点击。
 *
 * 两张卡片和模式弹窗里的是**同一个组件**（`RouteModeOptionCard`），所以对比文案、选中态、
 * 失败时留在原地这些行为，在引导页和弹窗里逐字一致。
 */
export function RouteModeStep() {
  const { mode, switching, switchMode } = useRouteMode()
  const t = useTranslation()

  return (
    <div className="space-y-6">
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
            onSelect={() => void switchMode(option.value)}
          />
        ))}
      </div>

      <section className="space-y-3">
        <div className="space-y-1">
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
