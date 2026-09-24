import { useQueryClient } from '@tanstack/react-query'

import { settingsApi } from '@/api/runtime'
import { unwrap } from '@/api/unwrap'
import { useToast } from '@/components/ui/toast'
import { AnimatedThemeToggler } from '@/components/ui/animated-theme-toggler'
import { cn } from '@/lib/utils'
import { settingsKeys } from '@/data/settings'
import { useTranslation, useLocale } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import type { Theme } from '@/components/app-sidebar'
import type { Locale } from '@common/i18n'
import type { Settings } from '@common/schemas'

interface OnboardingTopbarProps {
  theme: Theme
  onToggleTheme: () => void
}

/**
 * 语言名用**母语写法**（English / 简体中文），不随界面语言翻译 ——
 * 看不懂当前界面语言的人，正是最需要认出自己语言名的人（与设置页 `LANGUAGE_LABELS` 同一条规则）。
 */
const LANGUAGE_LABELS: Record<Locale, string> = {
  en: 'English',
  // eslint-disable-next-line i18n/no-hardcoded-cjk -- 语言名刻意用母语写法，不进目录
  'zh-CN': '简体中文',
}

/** 引导页只提供具体语言，不提供「跟随系统」：这里要的是立刻能读懂，而不是配一个偏好。 */
const ONBOARDING_LOCALES: Locale[] = ['en', 'zh-CN']

/**
 * 引导页右上角的常驻开关：语言 + 主题。
 *
 * 引导页不经过 `AppLayout`，侧边栏那套脚注不在这里，但语言恰好是这一步最该能改的东西
 * （第一步看不懂就没法往下走），主题同理（深色屏上看不清）。这两项在引导里不是装饰，是逃生门。
 *
 * 语言要**写回服务端设置**：`I18nProvider` 以 `settings.language` 为准，只改本地偏好会在下一次
 * 设置到达时被覆盖回旧值。写回的同时更新设置缓存，界面立刻换语言；失败只提示，不阻断引导 ——
 * 引导途中改不了语言，比语言没改成严重得多。
 *
 * 选中态标的是**当前生效的语言**（`locale`），不是偏好值：偏好为 `system` 时按系统解析出来的那个
 * 语言才是用户此刻正在读的东西，两个按钮都不亮会让人以为语言没设上。
 */
export function OnboardingTopbar(props: OnboardingTopbarProps) {
  const { theme, onToggleTheme } = props
  const t = useTranslation()
  const toast = useToast()
  const client = useQueryClient()
  const locale = useLocale()
  const preference = useLanguageStore(state => state.preference)
  const setPreference = useLanguageStore(state => state.setPreference)

  const changeLanguage = async (next: Locale) => {
    if (next === preference) return
    // 先写本地偏好让界面立刻切换，再持久化。
    setPreference(next)
    try {
      const updated = await unwrap(settingsApi.update({ language: next }))
      client.setQueryData<Settings>(settingsKeys.all, updated)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <div
        role="group"
        aria-label={t('onboarding.topbar.language')}
        className="flex items-center gap-0.5 rounded-lg border border-module-border bg-card p-0.5"
      >
        {ONBOARDING_LOCALES.map(option => (
          <button
            key={option}
            type="button"
            aria-pressed={locale === option}
            onClick={() => void changeLanguage(option)}
            className={cn(
              'rounded-md px-2 py-1 system-2xs-medium transition-colors',
              locale === option
                ? 'bg-secondary text-text-primary'
                : 'text-text-tertiary hover:text-text-secondary',
            )}
          >
            {LANGUAGE_LABELS[option]}
          </button>
        ))}
      </div>

      <AnimatedThemeToggler
        theme={theme}
        onThemeChange={() => onToggleTheme()}
        aria-label={theme === 'dark' ? t('nav.theme.toLight') : t('nav.theme.toDark')}
        title={theme === 'dark' ? t('nav.theme.toLight') : t('nav.theme.toDark')}
        className={cn(
          'flex size-8 items-center justify-center rounded-lg text-text-tertiary outline-none transition-colors',
          'hover:bg-state-base-hover-alt hover:text-text-secondary',
          'focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          '[&_svg]:size-4 [&_svg]:shrink-0',
        )}
      />
    </div>
  )
}
