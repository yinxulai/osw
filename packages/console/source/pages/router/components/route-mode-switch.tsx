import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { routeModeOption } from '@/components/route-mode/route-mode-options'
import { openRouteModeDialog, useRouteMode } from '@/components/route-mode/use-route-mode'
import { useTranslation } from '@/i18n/provider'

/**
 * 路由模式入口 —— 紧跟在页面标题后面的那一个图标按钮。
 *
 * 它回答的问题是「这个标题指的是哪一种路由定义」，所以它长在标题旁边，而不是混在右侧的动作按钮里：
 * 动作按钮回答「能做什么」，而这里回答的是「现在看的是什么」，两件事不该抢同一排位置。
 *
 * 它只负责「显示当前模式 + 打开那个全局弹窗」，不再自己直接切：两个模式的差异大到不是同一个操作的两个取值，
 * 顺手点一下就能把代理的全部行为换掉，代价和操作量完全不匹配 ——
 * 一排两个值的分段按钮因此收成一个图标，把「到底选哪一个」留给弹窗去讲清楚（见 `RouteModeDialog`）。
 *
 * 图标本身就是当前模式：不写文字也能一眼看出现在跑的是哪一份定义，剩下的文字留在提示里说全。
 *
 * 尺寸写死 24px（`size-6`，含边框）：它长在标题行里，而标题那一行的高度是 `h1` 的行盒
 * （`system-xl-*` → 24px）。控件比行盒高一点点，整个页头就比别的页面高出那一点点 ——
 * 高度由内边距和字号推出来时，「多一点」随时会悄悄回来，所以这里不让它自己算。
 */
export function RouteModeSwitch() {
  const { mode, switching } = useRouteMode()
  const option = routeModeOption(mode)
  const t = useTranslation()
  const Icon = option.icon

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={t('router.mode.switchAria')}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-module-border bg-workflow-block-parma-bg text-text-secondary transition-colors hover:bg-state-base-hover-alt hover:text-text-primary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          onClick={openRouteModeDialog}
        >
          {switching ? <Spinner className="size-3.5" /> : <Icon className="size-3.5" aria-hidden />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{t('router.mode.currentHint', { mode: t(option.labelKey) })}</TooltipContent>
    </Tooltip>
  )
}
