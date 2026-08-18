import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
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
        {service.loading || !service.settings ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="p-4">
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
              onExport={() => void service.exportConfig()}
              onImport={file => void service.importConfig(file)}
            />

            <div className="flex justify-end">
              <Button
                disabled={service.saving || service.saved}
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
