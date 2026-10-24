import type { ReactNode } from 'react'
import { Check, LoaderCircle, RotateCcw, Save } from 'lucide-react'
import type { LanguagePreference } from '@common/schemas'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { useRuntimeSettingsService } from './service'
import { ListenConfigCard } from './components/listen-config-card'
import { OutboundProxyCard } from './components/outbound-proxy-card'
import { CloudSyncCard } from './components/cloud-sync-card'
import { FailoverCard } from './components/failover-card'
import { CacheAffinityCard } from './components/cache-affinity-card'
import { ApiKeyAuthCard } from './components/api-key-auth-card'
import { DataDirectoryCard } from './components/data-directory-card'
import { LogRetentionCard } from './components/log-retention-card'
import { RouteModeCard } from './components/route-mode-card'
import { GeneralCard } from './components/general-card'
import { DevelopmentCard } from './components/development-card'
import { DeveloperCard } from './components/developer-card'
import { LiveMetricCard } from './components/live-metric-card'
import { UpdateCard } from './components/update-card'
import { useAppearance } from '@/hooks/use-appearance'
import { useTranslation } from '@/i18n/provider'
import type { ThemeMode } from '@/lib/theme-mode'

interface SettingsSectionProps {
  title: string
  children: ReactNode
}

function SettingsSection(props: SettingsSectionProps) {
  return (
    <section className="space-y-2.5">
      <h2 className="px-1 system-xs-medium text-text-tertiary">{props.title}</h2>
      <div className="space-y-3">{props.children}</div>
    </section>
  )
}

export function RuntimeSettingsPage() {
  const service = useRuntimeSettingsService()
  const t = useTranslation()
  const { themeMode: effectiveThemeMode, setLanguage, setThemeMode } = useAppearance()

  /**
   * 语言变更要立刻生效，不能等用户点保存：
   * 一是切完看不出变化会让人以为没生效，二是“保存”按钮本身也不知道该用什么语言写。
   * 所以同时写进本地偏好（立即重渲染）和表单草稿（等保存持久化）。
   *
   * `setLanguage` 一并把地址栏里的语言段改成新值：否则地址栏里残留的旧语言会把新偏好盖住，
   * 表现成「选了没反应」。
   */
  const handleLanguageChange = (language: LanguagePreference) => {
    service.updateField('language', language)
    setLanguage(language)
  }

  /** 主题同理：写偏好（记住），并让地址栏里的 `?theme=` 跟上。 */
  const handleThemeModeChange = (mode: ThemeMode) => {
    setThemeMode(mode)
  }

  /**
   * 重置不只要把草稿退回基线。语言预览是立刻写进地址栏的，`?lang=` 又优先于已保存的偏好；
   * 只退草稿的话界面会停在预览语言，而保存按钮因为已经不脏而点不了。
   * `setLanguage` 把偏好和地址栏一起收回已保存的值（`system` 仍写成解析后的具体语种，地址栏表达不了「跟随系统」）。
   */
  const handleReset = () => {
    const language = service.resetSettings()
    if (language) setLanguage(language)
  }

  return (
    <PageLayout>
      <PageHeader
        title={t('settings.title')}
        description={t('settings.description')}
        actions={!service.loading && service.settings ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="system-xs-regular text-text-tertiary">
              {service.saved
                ? t('settings.footer.allSaved')
                : service.isDirty ? t('settings.footer.dirty') : t('settings.footer.synced')}
            </span>
            <Button
              variant="ghost"
              disabled={service.saving || !service.isDirty}
              onClick={handleReset}
            >
              <RotateCcw />
              {t('settings.action.reset')}
            </Button>
            <Button
              disabled={service.saving || !service.isDirty}
              onClick={() => void service.saveSettings()}
            >
              {service.saving ? <LoaderCircle className="animate-spin" /> : service.saved ? <Check /> : <Save />}
              {service.saving ? t('settings.action.saving') : service.saved ? t('settings.action.saved') : t('settings.action.save')}
            </Button>
          </div>
        ) : undefined}
      />
      {/*
        这里**不要**再补 `pb-5`（历史上曾经加过）。
        页面底部的留白由 `AppLayout` 滚动容器内层统一的 `py-5` 负责；页面自己再加一层，
        滚到底时就变成 20 + 20 = 40px，这一页的尾巴比别的页厚一倍。
      */}
      <PageContent dataScreenshot="settings-content">
        {service.loading || !service.settings ? (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i} className="min-h-36 p-4">
                <Skeleton className="mb-3 h-4 w-32" />
                <Skeleton className="mb-5 h-3 w-52" />
                <Skeleton className="h-9 w-full" />
              </Card>
            ))}
          </div>
        ) : (
          <>
            <SettingsSection title={t('settings.section.application')}>
              <GeneralCard
                autoLaunch={service.settings.autoLaunch}
                onAutoLaunchChange={value => service.updateField('autoLaunch', value)}
                themeMode={effectiveThemeMode}
                onThemeModeChange={handleThemeModeChange}
                // 回显偏好本身（含「跟随系统」），不回显解析后的 `locale`。
                // `locale` 只有具体语种且永远有值；地址栏同样写不下 `system`。
                // 主题可以绑生效值，因为 `?theme=system` 是合法值。
                language={service.settings.language}
                onLanguageChange={handleLanguageChange}
              />
              <LiveMetricCard settings={service.settings} onUpdate={service.updateField} />
              <UpdateCard />
            </SettingsSection>

            <SettingsSection title={t('settings.section.network')}>
              <ListenConfigCard
                listenHost={service.settings.listenHost}
                listenPort={service.settings.listenPort}
                proxyRunning={service.proxyStatus?.running ?? false}
                onHostChange={value => service.updateField('listenHost', value)}
                onPortChange={value => service.updateField('listenPort', value)}
              />
              <OutboundProxyCard
                mode={service.settings.outboundProxyMode}
                proxyUrl={service.settings.outboundProxyUrl}
                bypass={service.settings.outboundProxyBypass}
                onModeChange={value => service.updateField('outboundProxyMode', value)}
                onProxyUrlChange={value => service.updateField('outboundProxyUrl', value)}
                onBypassChange={value => service.updateField('outboundProxyBypass', value)}
              />
              <ApiKeyAuthCard settings={service.settings} onUpdate={service.updateField} />
            </SettingsSection>

            <SettingsSection title={t('settings.section.routing')}>
              <RouteModeCard />
            </SettingsSection>

            <SettingsSection title={t('settings.section.reliability')}>
              <FailoverCard settings={service.settings} onUpdate={service.updateField} />
              <CacheAffinityCard settings={service.settings} onUpdate={service.updateField} />
            </SettingsSection>

            <SettingsSection title={t('settings.section.data')}>
              <LogRetentionCard
                captureRequestLogs={service.settings.captureRequestLogs}
                requestLogRetentionDays={service.settings.requestLogRetentionDays}
                captureRequestContent={service.settings.captureRequestContent}
                contentRetentionDays={service.settings.contentRetentionDays}
                onCaptureRequestLogsChange={value => service.updateField('captureRequestLogs', value)}
                onRequestLogRetentionDaysChange={value => service.updateField('requestLogRetentionDays', value)}
                onCaptureRequestContentChange={value => service.updateField('captureRequestContent', value)}
                onContentRetentionDaysChange={value => service.updateField('contentRetentionDays', value)}
                onPrune={service.pruneLogs}
              />
              <DataDirectoryCard storageBytes={service.storageBytes} />
              {import.meta.env.DEV && (
                <DevelopmentCard
                  exportingScreenshots={service.exportingScreenshots}
                  screenshotProgress={service.screenshotExportProgress}
                  onExportScreenshots={() => void service.exportScreenshots()}
                  onSeedDevelopment={() => void service.seedDevelopmentData()}
                />
              )}
            </SettingsSection>

            <SettingsSection title={t('settings.section.sync')}>
              <CloudSyncCard />
            </SettingsSection>

            <SettingsSection title={t('settings.section.developer')}>
              <DeveloperCard />
            </SettingsSection>
          </>
        )}
      </PageContent>
    </PageLayout>
  )
}
