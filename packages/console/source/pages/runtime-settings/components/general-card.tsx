import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { MonitorCog, RotateCcw } from 'lucide-react'
import type { LanguagePreference } from '@common/schemas'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { FormRow, FormSelect, type FormOption } from '@/components/form-kit'
import { Switch } from '@/components/ui/switch'
import type { ThemeMode } from '@/components/app-sidebar'
import { useTranslation } from '@/i18n/provider'
import { routePaths } from '@/routing/routes'
import { useAppUiStore } from '@/store/app-ui-store'

interface GeneralCardProps {
  autoLaunch: boolean
  onAutoLaunchChange: (enabled: boolean) => void
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
  language: LanguagePreference
  onLanguageChange: (language: LanguagePreference) => void
}

/**
 * 语言名称用**母语写法**（English / 简体中文），不随界面语言翻译。
 * 看不懂当前界面语言的人，正是最需要认出自己语言名的人。
 */
const LANGUAGE_LABELS = {
  en: 'English',
  // eslint-disable-next-line i18n/no-hardcoded-cjk -- 语言名刻意用母语写法，不进目录
  'zh-CN': '简体中文',
} as const

export function GeneralCard(props: GeneralCardProps) {
  const { autoLaunch, onAutoLaunchChange, themeMode, onThemeModeChange, language, onLanguageChange } = props
  const t = useTranslation()
  const navigate = useNavigate()
  const setOnboardingComplete = useAppUiStore(state => state.setOnboardingComplete)

  /**
   * 重走引导：先清掉完成标记再跳过去。
   *
   * 顺序不能反：`/onboarding` 是能直接打开的普通路由，标记只决定「启动时去哪」，
   * 所以先清标记只是为了下次启动还会落到引导，而不是跳转的前置条件 ——
   * 但反过来先跳再清，万一跳转未被处理，标记就已经被改了，下次启动会莫名其妙地又进引导。
   */
  const restartOnboarding = () => {
    setOnboardingComplete(false)
    void navigate({ to: routePaths.onboarding })
  }

  const themeOptions = useMemo<FormOption[]>(() => [
    { value: 'system', label: t('settings.appearance.theme.system') },
    { value: 'light', label: t('settings.appearance.theme.light') },
    { value: 'dark', label: t('settings.appearance.theme.dark') },
  ], [t])

  const languageOptions = useMemo<FormOption[]>(() => [
    { value: 'system', label: t('settings.appearance.language.system') },
    { value: 'en', label: LANGUAGE_LABELS.en },
    { value: 'zh-CN', label: LANGUAGE_LABELS['zh-CN'] },
  ], [t])

  return (
    <Card>
      <SettingsCardHeader
        icon={<MonitorCog />}
        title={t('settings.appearance.title')}
        description={t('settings.appearance.description')}
      />
      <CardContent className="divide-y divide-border/50 px-4">
        <FormRow
          title={t('settings.appearance.theme')}
          description={t('settings.appearance.themeDescription')}
          control={(
            <FormSelect
              ariaLabel={t('settings.appearance.themeAria')}
              className="w-32"
              options={themeOptions}
              value={themeMode}
              onValueChange={value => onThemeModeChange(value as ThemeMode)}
            />
          )}
        />
        <FormRow
          title={t('settings.appearance.language')}
          description={t('settings.appearance.languageDescription')}
          control={(
            <FormSelect
              ariaLabel={t('settings.appearance.languageAria')}
              className="w-32"
              options={languageOptions}
              value={language}
              onValueChange={value => onLanguageChange(value as LanguagePreference)}
            />
          )}
        />
        <FormRow
          title={t('settings.appearance.autoLaunch')}
          description={t('settings.appearance.autoLaunchDescription')}
          control={<Switch checked={autoLaunch} onCheckedChange={onAutoLaunchChange} />}
        />
        <FormRow
          title={t('onboarding.settings.restart')}
          description={t('onboarding.settings.restartDescription')}
          control={(
            <Button variant="outline" size="sm" onClick={restartOnboarding}>
              <RotateCcw />
              {t('onboarding.settings.restartAction')}
            </Button>
          )}
        />
      </CardContent>
    </Card>
  )
}
