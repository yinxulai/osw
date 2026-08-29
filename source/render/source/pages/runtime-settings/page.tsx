import type { ReactNode } from 'react'
import { Check, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { useRuntimeSettingsService } from './service'
import { ListenConfigCard } from './components/listen-config-card'
import { OutboundProxyCard } from './components/outbound-proxy-card'
import { FailoverCard } from './components/failover-card'
import { LogRetentionCard } from './components/log-retention-card'
import { GeneralCard } from './components/general-card'
import { DataManagementCard } from './components/data-management-card'
import { DevelopmentCard } from './components/development-card'
import { UpdateCard } from './components/update-card'
import type { ThemeMode } from '@/components/app-sidebar'

interface RuntimeSettingsPageProps {
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
}

interface SettingsSectionProps {
  title: string
  children: ReactNode
}

function SettingsSection(props: SettingsSectionProps) {
  return (
    <section className="space-y-2.5">
      <h2 className="px-1 text-xs font-medium text-muted-foreground">{props.title}</h2>
      <div className="space-y-3">{props.children}</div>
    </section>
  )
}

export function RuntimeSettingsPage(props: RuntimeSettingsPageProps) {
  const service = useRuntimeSettingsService()

  return (
    <PageLayout className="mx-auto max-w-4xl pb-20">
      <PageHeader title="设置" description="管理应用行为、网络连接、故障恢复与本地数据" />
      <PageContent className="space-y-6">
        {service.loading || !service.settings ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="min-h-36 p-4">
                <Skeleton className="mb-3 h-4 w-32" />
                <Skeleton className="mb-5 h-3 w-52" />
                <Skeleton className="h-9 w-full" />
              </Card>
            ))}
          </div>
        ) : (
          <>
            <SettingsSection title="应用">
              <GeneralCard
                autoLaunch={service.settings.autoLaunch}
                onAutoLaunchChange={value => service.updateField('autoLaunch', value)}
                themeMode={props.themeMode}
                onThemeModeChange={props.onThemeModeChange}
              />
              <UpdateCard />
            </SettingsSection>

            <SettingsSection title="网络">
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

            <SettingsSection title="可靠性">
              <FailoverCard settings={service.settings} onUpdate={service.updateField} />
            </SettingsSection>

            <SettingsSection title="数据">
              <LogRetentionCard
                retentionDays={service.settings.logRetentionDays}
                captureRequestContent={service.settings.captureRequestContent}
                onRetentionDaysChange={value => service.updateField('logRetentionDays', value)}
                onCaptureRequestContentChange={value => service.updateField('captureRequestContent', value)}
                onPrune={service.pruneLogs}
              />
              <DataManagementCard
                onExport={() => void service.exportConfig()}
                onImport={file => void service.importConfig(file)}
              />
              {import.meta.env.DEV && (
                <DevelopmentCard onSeedDevelopment={() => void service.seedDevelopmentData()} />
              )}
            </SettingsSection>
          </>
        )}
      </PageContent>

      {!service.loading && service.settings && (
        <div className="fixed inset-x-0 bottom-0 z-20 ml-12 bg-background/90 px-6 py-3 backdrop-blur-md">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              {service.saved ? '所有设置已保存' : service.isDirty ? '有尚未保存的更改' : '当前设置已同步'}
            </p>
            <Button
              size="sm"
              disabled={service.saving || !service.isDirty}
              onClick={() => void service.saveSettings()}
            >
              {service.saved ? <Check /> : <Save />}
              {service.saving ? '保存中...' : service.saved ? '已保存' : '保存更改'}
            </Button>
          </div>
        </div>
      )}
    </PageLayout>
  )
}
