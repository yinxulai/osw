import { ChevronDown, Route } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { FormRow } from '@/components/form-kit'
import { routeModeOption } from '@/components/route-mode/route-mode-options'
import { openRouteModeDialog, useRouteMode } from '@/components/route-mode/use-route-mode'
import { useTranslation } from '@/i18n/provider'

/**
 * 设置页里的「生效模式」。
 *
 * 这里**不写 `updateField`、也不进草稿**：模式是一按即写的服务端事实（代理紧接着就按它路由），
 * 混进「改完再一起保存」的草稿里，就会出现「界面上已经是新模式、代理还在跑旧的」这段谁都不想要的时间。
 * 所以这一行给的只是一个入口 —— 点开的是页头那个**同一个**弹窗，两个入口不各写一套选择界面。
 *
 * 行内是朴素的一横排（左标题 + 说明、右控件），和控制同一个控件 ——
 * 排成第二行、或者再套一层灰盒子，都会让「这是设置里的一个设置项」这件事变得不清楚。
 */
export function RouteModeCard() {
  const { mode } = useRouteMode()
  const option = routeModeOption(mode)
  const t = useTranslation()
  const Icon = option.icon

  return (
    <Card>
      <SettingsCardHeader
        icon={<Route />}
        title={t('settings.routeMode.title')}
        description={t('settings.routeMode.description')}
      />
      <CardContent className="divide-y divide-border/50 px-4">
        <FormRow
          title={t('settings.routeMode.current')}
          description={t('settings.routeMode.currentDescription')}
          control={(
            <Button
              variant="outline"
              aria-haspopup="dialog"
              aria-label={t('router.mode.switchAria')}
              onClick={openRouteModeDialog}
            >
              <Icon aria-hidden />
              {t(option.labelKey)}
              <ChevronDown className="size-3.5 text-text-tertiary" aria-hidden />
            </Button>
          )}
        />
      </CardContent>
    </Card>
  )
}
