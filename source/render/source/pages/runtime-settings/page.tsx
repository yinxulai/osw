import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { useRuntimeSettingsService } from './service'
import { ListenConfigCard } from './components/listen-config-card'
import { FailoverCard } from './components/failover-card'
import { LogRetentionCard } from './components/log-retention-card'
import { GeneralCard } from './components/general-card'
import { DataManagementCard } from './components/data-management-card'

export function RuntimeSettingsPage() {
  const service = useRuntimeSettingsService()

  return (
    <PageLayout>
      <PageHeader title="设置" description="配置代理监听地址、故障转移和本地日志容量" />
      <PageContent>
        {service.errorMessage && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {service.errorMessage}
          </div>
        )}
        {service.loading || !service.settings ? (
          <Card className="flex min-h-48 items-center justify-center text-xs text-muted-foreground">
            正在加载设置...
          </Card>
        ) : (
          <>
            <ListenConfigCard
              listenHost={service.settings.listenHost}
              listenPort={service.settings.listenPort}
              proxyRunning={service.proxyStatus?.running ?? false}
              onHostChange={value => service.updateField('listenHost', value)}
              onPortChange={value => service.updateField('listenPort', value)}
            />

            <FailoverCard
              settings={service.settings}
              onUpdate={service.updateField}
            />

            <LogRetentionCard
              retentionCount={service.settings.logRetentionCount}
              onChange={value => service.updateField('logRetentionCount', value)}
            />

            <GeneralCard
              autoLaunch={service.settings.autoLaunch}
              onAutoLaunchChange={value => service.updateField('autoLaunch', value)}
            />

            <DataManagementCard
              importMessage={service.importMessage}
              importSuccess={service.importSuccess}
              onExport={() => void service.exportConfig()}
              onImport={file => void service.importConfig(file)}
            />

            <div className="flex justify-end">
              <Button
                className="h-8 px-3 text-xs"
                disabled={service.saving}
                onClick={() => void service.saveSettings()}
              >
                {service.saving ? '保存并重启中...' : service.saved ? '已保存' : '保存并重启代理'}
              </Button>
            </div>
          </>
        )}
      </PageContent>
    </PageLayout>
  )
}
