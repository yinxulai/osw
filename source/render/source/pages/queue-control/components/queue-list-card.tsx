import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useState } from 'react'
import { RefreshCw, Target } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SortableBinding } from './sortable-binding'
import { QueueModelRow } from './queue-model-row'
import {
  QueueTestControls,
  QueueTestSummary,
  type ProtocolTestResult,
} from './queue-test-report'
import { modelTestApi, type ModelTestResult } from '@/api'
import type { UpstreamModel, Provider, ProviderHealth, Protocol } from '@common/schemas'

export type ProviderMap = Record<string, Provider>
export type HealthMap = Record<string, ProviderHealth>

interface QueueListCardProps {
  models: UpstreamModel[]
  providers: ProviderMap
  health: HealthMap
  logicalModelId?: string
  logicalModelName?: string
  mode: 'auto' | 'manual'
  manualModelId: string
  isCooling: (providerId: string) => boolean
  onModeChange: (mode: 'auto' | 'manual') => void
  onSelectManualModel: (model: UpstreamModel) => void
  onToggleEnabled: (model: UpstreamModel, enabled: boolean) => void
  onDragEnd: (event: DragEndEvent) => void
}

export function QueueListCard(props: QueueListCardProps) {
  const {
    models,
    providers,
    health,
    logicalModelId,
    logicalModelName,
    mode,
    manualModelId,
    isCooling,
    onModeChange,
    onSelectManualModel,
    onToggleEnabled,
    onDragEnd,
  } = props

  const [testProtocol, setTestProtocol] = useState<Protocol | 'all'>('all')
  const [testRunning, setTestRunning] = useState(false)
  const [testResults, setTestResults] = useState<Partial<Record<Protocol, ModelTestResult[]>> | null>(null)

  const availableProtocols = Array.from(
    new Set(models.flatMap(m => m.endpoints.map(e => e.protocol))),
  ) as Protocol[]

  const handleRunTest = async () => {
    if (!logicalModelId || testRunning) return
    setTestRunning(true)
    setTestResults(null)
    try {
      const protocols = testProtocol === 'all' ? availableProtocols : [testProtocol]
      const responses = await Promise.all(protocols.map(protocol => modelTestApi.run(logicalModelId, protocol)))
      const nextResults: Partial<Record<Protocol, ModelTestResult[]>> = {}
      responses.forEach((response, index) => {
        if (response.success) nextResults[protocols[index]] = response.data.results
      })
      setTestResults(nextResults)
    } finally {
      setTestRunning(false)
    }
  }

  const allTestResults: ProtocolTestResult[] = testResults
    ? Object.entries(testResults).flatMap(([protocol, results]) =>
        (results ?? []).map(result => ({ ...result, protocol: protocol as Protocol })),
      )
    : []

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  return (
    <Card>
      <CardHeader className="gap-3 pb-2 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
        <div>
          <CardTitle>优先级队列</CardTitle>
          <CardDescription className="mt-1">
            队列 {logicalModelName ?? '尚未配置'}，拖拽后立即生效
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={mode} onValueChange={value => onModeChange(value as 'auto' | 'manual')}>
            <TabsList className="h-7">
              <TabsTrigger value="auto" className="h-6 px-2.5 text-[11px]">
                <RefreshCw size={12} /> 自动转移
              </TabsTrigger>
              <TabsTrigger value="manual" className="h-6 px-2.5 text-[11px]">
                <Target size={12} /> 手动指定
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <QueueTestControls
            protocols={availableProtocols}
            selectedProtocol={testProtocol}
            running={testRunning}
            disabled={!logicalModelId}
            onProtocolChange={setTestProtocol}
            onRun={() => void handleRunTest()}
          />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {testResults && (
          <QueueTestSummary
            protocolCount={Object.keys(testResults).length}
            results={allTestResults}
            onClose={() => setTestResults(null)}
          />
        )}

        {models.length ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={event => void onDragEnd(event)}
          >
            <SortableContext items={models.map(model => model.id)} strategy={verticalListSortingStrategy}>
              <div className="-mx-4 -mb-4 overflow-hidden rounded-b-lg divide-y border-t">
                {models.map(model => {
                  const cooling = isCooling(model.providerId)
                  const selected = mode === 'manual' && manualModelId === model.id
                  const modelTestResults = testResults
                    ? allTestResults.filter(result => result.modelId === model.id)
                    : null

                  return (
                    <SortableBinding key={model.id} id={model.id}>
                      {(handleProps, dragging) => (
                        <QueueModelRow
                          model={model}
                          provider={providers[model.providerId]}
                          providerHealth={health[model.providerId]}
                          mode={mode}
                          selected={selected}
                          cooling={cooling}
                          dragging={dragging}
                          dragHandleProps={handleProps}
                          testResults={modelTestResults}
                          onSelect={() => void onSelectManualModel(model)}
                          onToggleEnabled={enabled => void onToggleEnabled(model, enabled)}
                        />
                      )}
                    </SortableBinding>
                  )
                })}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="-mx-4 -mb-4 flex min-h-40 items-center justify-center border-t text-xs text-muted-foreground">
            请先在模型管理中添加上游模型。
          </div>
        )}
      </CardContent>
    </Card>
  )
}
