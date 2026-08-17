import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Card } from '@/components/ui/card'
import { useQueueControlService } from './service'
import { ProxyConfigCard } from './components/proxy-config-card'
import { QueueListCard } from './components/queue-list-card'
import { PolicySettingsCard } from './components/policy-settings-card'

export function QueueControlPage() {
  const service = useQueueControlService()

  return (
    <PageLayout>
      <PageHeader title="模型队列" description="管理请求优先级和故障转移策略" />
      <PageContent>
        {service.errorMessage && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {service.errorMessage}
          </div>
        )}
        {service.loading ? (
          <Card className="flex min-h-48 items-center justify-center text-xs text-muted-foreground">
            正在加载队列配置...
          </Card>
        ) : (
          <>
            <ProxyConfigCard
              proxyBaseUrl={service.proxyBaseUrl}
              proxyPort={service.proxyStatus?.port ?? 0}
              proxyRunning={service.proxyStatus?.running ?? false}
              copied={service.copied}
              models={service.models}
              onToggleProxy={() => void service.toggleProxy()}
              onCopyEndpoint={url => void service.copyEndpoint(url)}
            />

            <QueueListCard
              models={service.models}
              providers={service.providers}
              health={service.health}
              logicalModelName={service.logicalModel?.name}
              mode={service.mode}
              manualModelId={service.manualModelId ?? ''}
              isCooling={service.isCooling}
              onModeChange={mode => void service.changeMode(mode)}
              onSelectManualModel={service.selectManualModel}
              onToggleEnabled={service.updateEnabled}
              onDragEnd={service.handleDragEnd}
            />

            {service.settings && (
              <PolicySettingsCard
                settings={service.settings}
                saving={service.saving}
                onUpdateSetting={service.updateSetting}
                onSave={() => void service.savePolicy()}
              />
            )}
          </>
        )}
      </PageContent>
    </PageLayout>
  )
}
