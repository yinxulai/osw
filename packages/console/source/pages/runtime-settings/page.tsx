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
import { DataDirectoryCard } from './components/data-directory-card'
import { LogRetentionCard } from './components/log-retention-card'
import { RouteModeCard } from './components/route-mode-card'
import { GeneralCard } from './components/general-card'
import { DevelopmentCard } from './components/development-card'
import { UpdateCard } from './components/update-card'
import { useAppUiStore } from '@/store/app-ui-store'
import { useLanguageStore } from '@/i18n/store'
import { useTranslation } from '@/i18n/provider'

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
  const themeMode = useAppUiStore(state => state.themeMode)
  const setThemeMode = useAppUiStore(state => state.setThemeMode)
  const setLanguagePreference = useLanguageStore(state => state.setPreference)

  /**
   * 语言变更要立刻生效，不能等用户点保存：
   * 一是切完看不出变化会让人以为没生效，二是“保存”按钮本身也不知道该用什么语言写。
   * 所以同时写进本地偏好（立即重渲染）和表单草稿（等保存持久化）。
   */
  const handleLanguageChange = (language: LanguagePreference) => {
    service.updateField('language', language)
    setLanguagePreference(language)
  }

  return (
    <PageLayout className="flex min-h-full flex-col">
      <PageHeader title={t('settings.title')} description={t('settings.description')} />
      <PageContent>
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
                themeMode={themeMode}
                onThemeModeChange={setThemeMode}
                language={service.settings.language}
                onLanguageChange={handleLanguageChange}
              />
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
            </SettingsSection>

            <SettingsSection title={t('settings.section.routing')}>
              <RouteModeCard />
            </SettingsSection>

            <SettingsSection title={t('settings.section.reliability')}>
              <FailoverCard settings={service.settings} onUpdate={service.updateField} />
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
                <DevelopmentCard onSeedDevelopment={() => void service.seedDevelopmentData()} />
              )}
            </SettingsSection>

            <SettingsSection title={t('settings.section.sync')}>
              <CloudSyncCard />
            </SettingsSection>
          </>
        )}
      </PageContent>

      {!service.loading && service.settings && (
        <div className="sticky bottom-0 z-20 -mx-6 -mb-5 mt-auto border-t border-border/50 bg-card/90 px-6 py-3 backdrop-blur-md">
          <div className="flex items-center justify-between gap-4">
            <p className="system-xs-regular text-text-tertiary">
              {service.saved
                ? t('settings.footer.allSaved')
                : service.isDirty ? t('settings.footer.dirty') : t('settings.footer.synced')}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                disabled={service.saving || !service.isDirty}
                onClick={service.resetSettings}
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
          </div>
        </div>
      )}
    </PageLayout>
  )
}
