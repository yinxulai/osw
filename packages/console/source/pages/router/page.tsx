import { Background, Controls, ReactFlow, ReactFlowProvider, SelectionMode } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { PageContent, PageLayout } from '@/components/layout'
import { Card } from '@/components/ui/card'
import { useRouteMode } from '@/hooks/use-route-mode'

import { SaveVersionDialog } from './components/save-version-dialog'
import { WorkflowCanvasDock } from './components/workflow-canvas-dock'
import { WorkflowConnectionLine } from './components/workflow-connection-line'
import { WorkflowNodePanel } from './components/workflow-node-panel'
import { WorkflowRunDrawer } from './components/workflow-run-drawer'
import { WorkflowStudioHeader } from './components/workflow-studio-header'
import { edgeTypes, nodeTypes } from './node-registry'
import { RouteRulesStudio } from './rules/rules-studio'
import { useWorkflowStudio } from './use-workflow-studio'

/**
 * 工作台画布。
 *
 * 这一层只做组合：图、选中态、抽屉与保存弹窗的状态全在 `useWorkflowStudio` 里，
 * 拿到的每一件事在这里只是被摆到它该在的位置。它用的是 `useReactFlow`，
 * 所以必须挂在 `ReactFlowProvider` 之下（见文件末尾的 `RouterPage`）。
 */
function WorkflowStudioCanvas() {
  const studio = useWorkflowStudio()

  return (
    <PageLayout className="flex h-full min-h-0 flex-col">
      <WorkflowStudioHeader
        activePolicyId={studio.activePolicyId}
        canSave={studio.canSave}
        versions={studio.versions}
        onApplyPolicy={studio.onApplyPolicy}
        onRestoreVersion={studio.onRestoreVersion}
        onOpenRun={studio.onOpenRun}
        onOpenSave={studio.onOpenSave}
      />

      <PageContent className="flex min-h-0 flex-1 flex-col">
        {/* 画布上不放图例行：节点名与配色在节点本身与节点选择器里已经出现一次，
            再列一行只是把同样的话说第二遍，白占画布上方的纵向空间。 */}
        {/*
          画布不再套 `CardContent`：`Card` 自带的内边距会给「铺满整格」的画布平白镶一圈留白，
          而这里没有任何内容需要那圈内边距。容器本身仍用 `Card` 组件承载，
          描边 / 圆角 / 底色都跟着卡片走，样式升级时会一起更新，不会漏掉这一处。
        */}
        <Card className="relative min-h-0 w-full flex-1 overflow-hidden p-0 ring-0">
          <div
            ref={studio.canvasRef}
            className="relative h-full w-full overflow-hidden rounded-xl bg-workflow-canvas-workflow-bg"
          >
            <ReactFlow
              nodes={studio.flowNodes}
              edges={studio.flowEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              connectionLineComponent={WorkflowConnectionLine}
              defaultEdgeOptions={{ type: 'workflow' }}
              proOptions={{ hideAttribution: true }}
              onlyRenderVisibleElements
              snapToGrid
              snapGrid={[16, 16]}
              nodeDragThreshold={1}
              nodesDraggable={studio.draggable}
              panOnDrag={studio.dockMode === 'pan'}
              selectionOnDrag={studio.dockMode === 'select'}
              selectionMode={SelectionMode.Partial}
              deleteKeyCode={null}
              multiSelectionKeyCode={null}
              selectionKeyCode={null}
              minZoom={0.25}
              onConnect={studio.onConnect}
              onEdgesDelete={studio.onEdgesDelete}
              onNodesDelete={studio.onNodesDelete}
              onNodeDrag={studio.onNodeDrag}
              onNodeDragStop={studio.onNodeDragStop}
              onNodeMouseEnter={studio.onNodeMouseEnter}
              onNodeMouseLeave={studio.onNodeMouseLeave}
              onNodeClick={studio.onNodeClick}
              onPaneClick={studio.onPaneClick}
              className="workflow-reactflow workflow-ui-surface"
            >
              {/* 点阵参数与底色逐字复制自上游 `workflow/index.tsx` 的 <Background>。 */}
              <Background
                gap={[14, 14]}
                size={2}
                className="bg-workflow-canvas-workflow-bg"
                color="var(--color-workflow-canvas-workflow-dot-color)"
              />
              <Controls className="router-controls" showInteractive={false} />
            </ReactFlow>

            <WorkflowCanvasDock
              mode={studio.dockMode}
              dragEnabled={studio.dragEnabled}
              onModeChange={studio.onModeChange}
              onToggleDrag={studio.onToggleDrag}
              onFitView={studio.onFitView}
              onAppendNode={studio.onAppendNode}
            />

            {studio.selectedNode && (
              <WorkflowNodePanel
                model={studio.selectedNode}
                canvasWidth={studio.canvasWidth}
                width={studio.panelWidth}
                onWidthChange={studio.onPanelWidthChange}
                nodeModels={studio.nodeModels}
                logicalModels={studio.logicalModels}
                conditionFieldHints={studio.conditionFieldHints}
                updateNode={studio.updateNode}
                onDelete={studio.onDeleteNode}
                onClose={studio.onCloseNodePanel}
              />
            )}
          </div>
        </Card>
      </PageContent>

      <WorkflowRunDrawer
        open={studio.runOpen}
        onOpenChange={studio.onRunOpenChange}
        payloadText={studio.payloadText}
        onPayloadTextChange={studio.onPayloadTextChange}
        payloadError={studio.payloadError}
        payloadRows={studio.payloadRows}
        result={studio.runResult}
        groups={studio.nodeOutputGroups}
        onRun={studio.onRun}
      />

      {/* 弹窗挂在画布之外：它只负责收集名字与说明，图数据仍由 `useWorkflowStudio` 持有。 */}
      <SaveVersionDialog
        open={studio.saveOpen}
        nextVersion={studio.nextVersion}
        description={studio.saveDescription}
        initialName={studio.saveInitialName}
        initialDescription={studio.saveInitialDescription}
        saving={studio.saving}
        onOpenChange={studio.onSaveOpenChange}
        onConfirm={studio.onSaveConfirm}
      />
    </PageLayout>
  )
}

export function RouterPage() {
  const { mode } = useRouteMode()

  /**
   * 两个工作台按当前生效的模式二选一挂载，而不是同时挂着再藏一个。
   *
   * 未生效的那份定义因此连拉取都不会发生 —— 「同一时刻只有一种生效」在界面上就是这条规则。
   * 模式本身由页头的 `RouteModeSwitch` 自己读、自己开弹窗，不再经由这一层往下传。
   */
  if (mode === 'rules') {
    return <RouteRulesStudio />
  }

  return (
    <ReactFlowProvider>
      <WorkflowStudioCanvas />
    </ReactFlowProvider>
  )
}
