import { useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight, LayoutGrid, Plug, type LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/provider'
import { routePaths } from '@/routing/routes'
import { useAppUiStore } from '@/store/app-ui-store'
import { telemetryApi } from '@/api/runtime'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { AddModelStep } from './steps/add-model-step'
import { ConfigureStep } from './steps/configure-step'

interface OnboardingStep {
  /** 这一步的名字，也是唯一的一处措辞：它同时是这一屏的标题与「下一步」按钮上的去向。 */
  labelKey: UiCatalogKey
  icon: LucideIcon
  render: () => ReactNode
}

/**
 * 两步只回答两个问题：**拿什么跑 → 填到哪里**。
 *
 * 顺序不可换：没有模型时「填到哪里」没有意义。每一步的产物都是下一步的前提，
 * 所以这里是一条直线，不是可自由勾选的清单。
 *
 * 选路不再单独成步：内建默认已经在下，它的产物（模型池、落点）在「路由」页随时能改，
 * 引导把它故意跳过 —— 新手在第二步之前做的每一个决定，都该是为了「先跑起来」。
 *
 * 每一步的内容都**尽量复用正式页面的组件**（模型管理链路、地址卡、客户端配置编辑器），
 * 引导页只负责串场和收尾。这样引导里做的每个动作，在正式页面里都已经是生效的结果 ——
 * 用户走完引导不会落到一个「还需要再做一遍」的界面。
 */
const STEPS: OnboardingStep[] = [
  {
    labelKey: 'onboarding.step.models.label',
    icon: LayoutGrid,
    render: () => <AddModelStep />,
  },
  {
    labelKey: 'onboarding.step.configure.label',
    icon: Plug,
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
 * 全程**可跳过**：第二步里每个值旁边都有复制入口，另外还有一条「交给客户端配置页代抄」的路，
 * 说明这一步只是「告诉你填什么」，不完成也不会让程序不可用。把不能跳过的东西做成引导，只会让人以为程序坏了。
 * 因此「跳过」和「完成」写的是同一个标记，区别只是走没走完 —— 结果都是不再自动弹出来。
 *
 * 完成标记存本地（见 `app-ui-store`），不进服务端设置：它回答的是「这台机器上这个人见没见过」，
 * 换台机器、换个用户，该重新讲一遍。
 *
 * 版面不做 step 展示：只有两步的一条直线不需要步进器，也不需要「第 N 步 / 共 2 步」这种
 * 与内容无关的元信息。现在在哪（这一屏的标题就是这一步的名字）、将去哪、能不能回头，
 * 全部写在标题与底部按钮上，用户不必先读懂一套骨架才能开始干活。
 */
export function OnboardingPage() {
  const [index, setIndex] = useState(0)
  const navigate = useNavigate()
  const setOnboardingComplete = useAppUiStore(state => state.setOnboardingComplete)
  const t = useTranslation()

  const step = STEPS[index]
  const nextStep = STEPS[index + 1]
  const isLast = index === STEPS.length - 1
  const StepIcon = step.icon

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
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 pt-16">
      <header className="space-y-1.5">
        <p className="system-2xs-medium text-text-accent">{t('onboarding.eyebrow')}</p>
        <h1 className="system-xl-semibold text-text-primary">{t('onboarding.title')}</h1>
      </header>

      {/* 这一屏的标题就是这一步的名字：内容自己会说话，不必再挂一句「第几步」的注脚。 */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <StepIcon aria-hidden className="size-4 text-text-tertiary" />
          <h2 className="system-md-semibold text-text-primary">{t(step.labelKey)}</h2>
        </div>
        {step.render()}
      </section>

      {/*
       * 操作条吸附在底部：第二步的内容比一屏高，而「完成」是这一屏唯一的出口 ——
       * 让它随内容滚到屏幕外，用户读完最后一张表还得先找回按钮在哪。
       *
       * 状态与步骤名都写在按钮上：「下一步」直接写着下一步是谁，回头路上也有「上一步」，
       * 于是不必再摆一条步进器来表达「现在在哪、将去哪」——那是同一件事说两遍。
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
        {/*
          最右边这颗按钮同时承担「状态」与「步骤名」：没走完时写「下一步：<下一步的名字>」，
          走完时写「完成」。于是这一屏不需要步进器，也不需要「第 N 步 / 共 2 步」的注脚 ——
          现在在哪、再往前是什么、走完会怎样，都在这一颗按钮上。
        */}
        <div className="ml-auto">
          {isLast ? (
            <Button size="sm" onClick={() => finish(false)}>
              {t('onboarding.action.finish')}
            </Button>
          ) : (
            <Button size="sm" onClick={() => setIndex(current => current + 1)}>
              {t('onboarding.action.next', { step: t(nextStep.labelKey) })}
              <ArrowRight />
            </Button>
          )}
        </div>
      </footer>
    </div>
  )
}
