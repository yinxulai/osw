import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Circle, Plug, Play } from 'lucide-react'
import { useQueueControlService } from './service'
import { QueueListCard } from './components/queue-list-card'
import { QueueSummary } from './components/queue-summary'

interface QueueControlPageProps {
  onNavigateToModels?: () => void
  onNavigateToAccess?: () => void
}

export function QueueControlPage(props: QueueControlPageProps) {
  const { onNavigateToModels, onNavigateToAccess } = props
  const service = useQueueControlService()
  const proxyRunning = service.proxyStatus?.running ?? false

  return (
    <PageLayout>
      <PageHeader
        title="模型队列"
        description="管理请求优先级、切换模式和模型启停"
        actions={(
          <div className="flex items-center gap-2">
            {onNavigateToAccess && (
              <Button variant="outline" onClick={onNavigateToAccess}>
                <Plug size={13} /> 接入配置
              </Button>
            )}
            <Button
              variant={proxyRunning ? 'secondary' : 'default'}
              aria-label={proxyRunning ? '暂停服务' : '启动服务'}
              onClick={() => void service.toggleProxy()}
            >
              {proxyRunning ? (
                <Circle size={8} className="fill-success text-success motion-safe:animate-pulse motion-reduce:animate-none" />
              ) : (
                <Play size={13} />
              )}
              {proxyRunning ? '运行中' : '启动服务'}
            </Button>
          </div>
        )}
      />
      <PageContent>
        {service.loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="p-3">
                  <Skeleton className="mb-2 h-3 w-20" />
                  <Skeleton className="mb-2 h-6 w-10" />
                  <Skeleton className="h-2.5 w-28" />
                </Card>
              ))}
            </div>
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
            <QueueSummary models={service.models} isCooling={service.isCooling} />

            <QueueListCard
              models={service.models}
              providers={service.providers}
              health={service.health}
              providerModelHealth={service.providerModelHealth}
              modelMetrics={service.modelMetrics}
              mode={service.mode}
              manualModelId={service.manualModelId ?? ''}
              switchingMode={service.switchingMode}
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
