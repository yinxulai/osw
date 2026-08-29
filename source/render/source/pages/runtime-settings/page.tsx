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

export function RuntimeSettingsPage(props: RuntimeSettingsPageProps) {
  const service = useRuntimeSettingsService()

  return (
    <PageLayout>
      <PageHeader title="设置" description="配置代理监听地址、故障转移和本地日志容量" />
      <PageContent>
        <UpdateCard />

        {service.loading || !service.settings ? (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Card key={i} className="border-border p-4">
                <Skeleton className="mb-3 h-4 w-32" />
                <Skeleton className="mb-2 h-3 w-48" />
                <Skeleton className="h-8 w-40" />
              </Card>
            ))}
          </div>
        ) : (
          <>
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

            <FailoverCard
              settings={service.settings}
              onUpdate={service.updateField}
            />

            <LogRetentionCard
              retentionDays={service.settings.logRetentionDays}
              captureRequestContent={service.settings.captureRequestContent}
              onRetentionDaysChange={value => service.updateField('logRetentionDays', value)}
              onCaptureRequestContentChange={value => service.updateField('captureRequestContent', value)}
              onPrune={service.pruneLogs}
            />

            <GeneralCard
              autoLaunch={service.settings.autoLaunch}
              onAutoLaunchChange={value => service.updateField('autoLaunch', value)}
              themeMode={props.themeMode}
              onThemeModeChange={props.onThemeModeChange}
            />

            <DataManagementCard
              onExport={() => void service.exportConfig()}
              onImport={file => void service.importConfig(file)}
            />

            {import.meta.env.DEV && (
              <DevelopmentCard onSeedDevelopment={() => void service.seedDevelopmentData()} />
            )}

            <div className="flex justify-end">
              <Button
                disabled={service.saving || service.saved}
                onClick={() => void service.saveSettings()}
              >
                {service.saving ? '保存中...' : service.saved ? '已保存' : '保存设置'}
              </Button>
            </div>
          </>
        )}
      </PageContent>
    </PageLayout>
  )
}
