import { useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import { routePaths } from '@/routes'
import { useAppUiStore } from '@/store/app-ui-store'
import { telemetryApi } from '@/api/runtime'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { RouteModeStep } from './steps/route-mode-step'
import { AddModelStep } from './steps/add-model-step'
import { ConfigureStep } from './steps/configure-step'

interface OnboardingStep {
  labelKey: UiCatalogKey
  titleKey: UiCatalogKey
  descriptionKey: UiCatalogKey
  render: () => ReactNode
}

/**
 * 三步只回答三个问题：**怎么选路 → 拿什么跑 → 填到哪里**。
 *
 * 顺序不可换：没有模型时「填到哪里」没有意义，没选模式时「拿什么跑」也说不清会怎么被选中。
 * 每一步的产物都是下一步的前提，所以这里是一条直线，不是可自由勾选的清单。
 *
 * 每一步的内容都**复用正式页面的组件**（模式卡片、模型管理链路、接入配置卡片），
 * 引导页只负责串场和收尾。这样引导里做的每个动作，在正式页面里都已经是生效的结果 ——
 * 用户走完引导不会落到一个「还需要再做一遍」的界面。
 */
const STEPS: OnboardingStep[] = [
  {
    labelKey: 'onboarding.step.routeMode.label',
    titleKey: 'onboarding.step.routeMode.title',
    descriptionKey: 'onboarding.step.routeMode.description',
    render: () => <RouteModeStep />,
  },
  {
    labelKey: 'onboarding.step.models.label',
    titleKey: 'onboarding.step.models.title',
    descriptionKey: 'onboarding.step.models.description',
    render: () => <AddModelStep />,
  },
  {
    labelKey: 'onboarding.step.configure.label',
    titleKey: 'onboarding.step.configure.title',
    descriptionKey: 'onboarding.step.configure.description',
    render: () => <ConfigureStep />,
  },
]

/**
 * 引导页底部操作条要占掉的高度，供浮在右下角的 toast 避让（见 `App` 传给 `ToastProvider` 的值）。
 *
 * 组成：操作条 `py-4`（16 × 2）+ `size="sm"` 按钮 28px + 1px 上边框 = 61px，再加 15px 呼吸。
 * 这个数与操作条的类名是一体的：改那条 `footer` 的内边距或按钮尺寸时，这里要跟着改。
 */
export const ONBOARDING_ACTION_BAR_CLEARANCE = 76

/**
 * 新用户引导（全屏）。
 *
 * 全程**可跳过**：第三步里每个值旁边都有复制入口，说明这一步只是「告诉你填什么」，
 * 不完成也不会让程序不可用。把不能跳过的东西做成引导，只会让人以为程序坏了。
 * 因此「跳过」和「完成」写的是同一个标记，区别只是走没走完 —— 结果都是不再自动弹出来。
 *
 * 完成标记存本地（见 `app-ui-store`），不进服务端设置：它回答的是「这台机器上这个人见没见过」，
 * 换台机器、换个用户，该重新讲一遍。
 */
export function OnboardingPage() {
  const [index, setIndex] = useState(0)
  const navigate = useNavigate()
  const setOnboardingComplete = useAppUiStore(state => state.setOnboardingComplete)
  const t = useTranslation()

  const step = STEPS[index]
  const isLast = index === STEPS.length - 1

  /**
   * 收尾。「跳过」与「完成」走同一条路，区别只在 `skipped`：把不能跳过的东西做成引导，
   * 只会让人以为程序坏了。
   */
  const finish = (skipped: boolean) => {
    telemetryApi.report({ name: 'onboarding_finished', skipped })
    setOnboardingComplete(true)
    void navigate({ to: routePaths.router, replace: true })
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 px-6 pt-16">
      <header className="space-y-1.5">
        <p className="system-2xs-medium text-text-accent">{t('onboarding.eyebrow')}</p>
        <h1 className="system-xl-semibold text-text-primary">{t('onboarding.title')}</h1>
      </header>

      {/* 进度条本身就是可点的回头路：走过头了要能回到第一步改模式，而不是退出重来。 */}
      <ol aria-label={t('onboarding.progressLabel')} className="flex items-center gap-2">
        {STEPS.map((item, itemIndex) => {
          const done = itemIndex < index
          const current = itemIndex === index
          return (
            <li key={item.labelKey} className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                aria-current={current ? 'step' : undefined}
                // 只挡还没走到的步骤：已走过的可以点回去，当前这一步点了是空操作，但不该被说成不可用。
                disabled={itemIndex > index}
                onClick={() => setIndex(itemIndex)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1 system-xs-medium transition-colors',
                  done && 'text-text-secondary hover:bg-state-base-hover-alt hover:text-text-primary',
                  current && 'bg-secondary text-text-primary',
                  !done && !current && 'text-text-quaternary',
                )}
              >
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-full system-2xs-medium',
                    current ? 'bg-state-accent-solid text-primary-foreground' : 'bg-secondary text-text-tertiary',
                  )}
                >
                  {itemIndex + 1}
                </span>
                <span className="truncate">{t(item.labelKey)}</span>
              </button>
              {itemIndex < STEPS.length - 1 && (
                <span aria-hidden className="h-px w-4 shrink-0 bg-border" />
              )}
            </li>
          )
        })}
      </ol>

      <div className="space-y-4">
        <div className="space-y-1">
          <h2 className="system-md-semibold text-text-primary">{t(step.titleKey)}</h2>
          <p className="system-xs-regular text-text-tertiary">{t(step.descriptionKey)}</p>
        </div>
        {step.render()}
      </div>

      {/*
       * 操作条吸附在底部：第三步的内容比一屏高，而「完成」是这一屏唯一的出口 ——
       * 让它随内容滚到屏幕外，用户读完最后一张表还得先找回按钮在哪。
       */}
      <footer className="sticky bottom-0 -mx-6 mt-auto flex items-center gap-2 border-t border-module-border bg-background px-6 py-4">
        <Button
          variant="ghost"
          size="sm"
          disabled={index === 0}
          onClick={() => setIndex(current => Math.max(0, current - 1))}
        >
          <ArrowLeft />
          {t('onboarding.action.previous')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => finish(true)}>
          {t('onboarding.action.skip')}
        </Button>
        <div className="ml-auto">
          {isLast ? (
            <Button size="sm" onClick={() => finish(false)}>
              {t('onboarding.action.finish')}
            </Button>
          ) : (
            <Button size="sm" onClick={() => setIndex(current => current + 1)}>
              {t('onboarding.action.next')}
              <ArrowRight />
            </Button>
          )}
        </div>
      </footer>
    </div>
  )
}
