import { ListOrdered, Waypoints } from 'lucide-react'

import type { UiCatalogKey } from '@common/i18n/catalogs'
import type { RouteMode } from '@common/schemas'

export interface RouteModeOption {
  value: RouteMode
  /** 模式的名字。页头、设置行、弹窗卡片用的是同一个词，不做三套说法。 */
  labelKey: UiCatalogKey
  /** 一句话说清「这个模式是什么」。 */
  summaryKey: UiCatalogKey
  /**
   * 三条并列的差异点。
   *
   * 两个模式**逐条对齐**（能表达什么 / 怎么改 / 适合什么场景），
   * 因为用户真正要判断的就是「这三点上我选哪一个」；
   * 各自罗列各自的优点，读起来只是两段广告，比不出差别。加一条时两边一起加。
   *
   * 版本能力不在其中：两个模式都是「保存后生效、可回滚到任一版」，
   * 它现在是一句话说得清的共同点，摆在模式弹窗的说明里，不用占一行对比。
   */
  traitKeys: readonly UiCatalogKey[]
  icon: typeof Waypoints
}

/** 两个模式并列摆出来：它们是同一个位置上的两个候选，不是两个可以各自开关的开关。顺序即展示顺序。 */
export const ROUTE_MODE_OPTIONS: readonly RouteModeOption[] = [
  {
    value: 'workflow',
    labelKey: 'router.mode.workflow',
    summaryKey: 'router.mode.workflowSummary',
    traitKeys: [
      'router.mode.workflow.expressiveness',
      'router.mode.workflow.editing',
      'router.mode.workflow.effective',
    ],
    icon: Waypoints,
  },
  {
    value: 'rules',
    labelKey: 'router.mode.rules',
    summaryKey: 'router.mode.rulesSummary',
    traitKeys: ['router.mode.rules.expressiveness', 'router.mode.rules.editing', 'router.mode.rules.effective'],
    icon: ListOrdered,
  },
]

/** 按当前模式取回它的元数据。schema 兜底之后 `mode` 一定是这两个之一，找不到只可能是有人漏加了选项。 */
export function routeModeOption(mode: RouteMode): RouteModeOption {
  return ROUTE_MODE_OPTIONS.find(option => option.value === mode) ?? ROUTE_MODE_OPTIONS[0]
}
