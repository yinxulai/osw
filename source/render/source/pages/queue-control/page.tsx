import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Pause, Play } from 'lucide-react'
import { useQueueControlService } from './service'
import { ProxyConfigCard } from './components/proxy-config-card'
import { QueueListCard } from './components/queue-list-card'

interface QueueControlPageProps {
  onNavigateToModels?: () => void
}

export function QueueControlPage(props: QueueControlPageProps) {
  const { onNavigateToModels } = props
  const service = useQueueControlService()
  const proxyRunning = service.proxyStatus?.running ?? false

  return (
    <PageLayout>
      <PageHeader
        title="模型队列"
        description="管理请求优先级、切换模式和模型启停"
        actions={
          <Button
            variant={proxyRunning ? 'secondary' : 'default'}
            onClick={() => void service.toggleProxy()}
          >
            {proxyRunning ? <Pause size={13} /> : <Play size={13} />}
            {proxyRunning ? '暂停服务' : '启动服务'}
          </Button>
        }
      />
      <PageContent>
        {service.loading ? (
          <div className="space-y-4">
            <Card className="p-4">
              <Skeleton className="mb-3 h-5 w-32" />
              <Skeleton className="mb-2 h-4 w-48" />
              <Skeleton className="h-8 w-40" />
            </Card>
            <Card className="p-4">
              <Skeleton className="mb-4 h-5 w-24" />
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-5 w-5 rounded-sm" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3.5 w-1/3" />
                      <Skeleton className="h-3 w-1/4" />
                    </div>
                    <Skeleton className="h-6 w-16" />
                  </div>
                ))}
              </div>
            </Card>
          </div>
        ) : (
          <>
            <ProxyConfigCard
              proxyBaseUrl={service.proxyBaseUrl}
              proxyPort={service.proxyStatus?.port ?? 0}
              proxyRunning={service.proxyStatus?.running ?? false}
              copied={service.copied}
              onCopyEndpoint={url => void service.copyEndpoint(url)}
            />

            <QueueListCard
              models={service.models}
              providers={service.providers}
              health={service.health}
              modelMetrics={service.modelMetrics}
              mode={service.mode}
              manualModelId={service.manualModelId ?? ''}
              isCooling={service.isCooling}
              onModeChange={mode => void service.changeMode(mode)}
              onSelectManualModel={service.selectManualModel}
              onToggleEnabled={service.updateEnabled}
              onDragEnd={service.handleDragEnd}
              onNavigateToModels={onNavigateToModels}
            />
          </>
        )}
      </PageContent>
    </PageLayout>
  )
}
