import { useTranslation } from '@/i18n/provider'
import { Badge } from '@/components/ui/badge'
import type { WorkflowRunResult } from '@common/router/types'
import { formatNodeOutputValue, type NodeOutputGroup } from '../node-output'

interface WorkflowRunResultsProps {
  result: WorkflowRunResult
  /** 输出按节点分好组、名字也翻好了；这里只负责画。 */
  groups: NodeOutputGroup[]
}

/**
 * 一次试运行的结论：先给一段总账（路由状态 / 协议 / 步数），再给逐节点输出与轨迹。
 *
 * 输入与结果在抽屉里共用一个滚动容器，所以这里只画内容，不自己滚。
 * 三块的分工是固定的：**节点输出**回答「这一步产出了什么」（按节点分组，因为同一节点
 * 可能产出多条），**输出载荷**回答「最终回给了什么」，**轨迹**回答「按什么顺序走到了这里」。
 */
export function WorkflowRunResults(props: WorkflowRunResultsProps) {
  const t = useTranslation()
  const { result, groups } = props

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={result.stopReason === 'output' ? 'success' : 'warning'}>
          {t('router.runPanel.routeStatus')}{result.stopReason === 'output' ? t('router.runPanel.reachedOutput') : result.stopReason}
        </Badge>
        <Badge variant="info">{t('router.runPanel.protocol')}{result.protocol}</Badge>
        <Badge variant="muted">{t('router.runPanel.nodeCount')}{result.trace.length}</Badge>
      </div>

      <div className="space-y-1.5 rounded-lg border border-module-border bg-workflow-block-parma-bg p-2">
        <div className="system-2xs-medium-uppercase text-text-tertiary">{t('router.runPanel.nodeOutputs')}</div>
        {groups.length === 0
          ? <div className="system-xs-regular text-text-tertiary">{t('router.runPanel.noNodeOutputs')}</div>
          : (
            <div className="space-y-1.5">
              {groups.map(group => (
                <div key={group.nodeId} className="rounded-md border border-module-border bg-workflow-block-bg p-2">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="system-xs-medium text-text-primary">{group.nodeName}</span>
                    <span className="font-mono system-2xs-regular text-text-tertiary">{group.nodeId}</span>
                  </div>
                  <div className="space-y-0.5">
                    {group.outputs.map((output, index) => (
                      <div key={`${output.name}-${index}`} className="flex items-start gap-2">
                        <span className="shrink-0 system-xs-regular text-text-tertiary">{output.name}</span>
                        <span className="min-w-0 flex-1 break-all font-mono system-2xs-regular text-text-secondary">
                          {formatNodeOutputValue(output.value)}
                        </span>
                        {output.note && <Badge variant="muted">{output.note}</Badge>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>

      <div className="rounded-lg border border-module-border bg-workflow-block-parma-bg p-2 font-mono system-2xs-regular">
        <div className="mb-1 system-2xs-medium-uppercase text-text-tertiary">{t('router.runPanel.output')}</div>
        <pre className="whitespace-pre-wrap break-all">{JSON.stringify(result.outputPayload, null, 2)}</pre>
      </div>

      <div className="space-y-1.5 rounded-lg border border-module-border bg-workflow-block-parma-bg p-2">
        <div className="system-2xs-medium-uppercase text-text-tertiary">{t('router.runPanel.trace')}</div>
        <div className="space-y-1.5">
          {result.trace.map(item => (
            <div key={`${item.nodeId}-${item.message}`} className="rounded-md border border-module-border bg-workflow-block-bg p-2 system-xs-regular">
              <div className="mb-0.5 flex items-center gap-2">
                <span className="system-xs-medium text-text-primary">{item.nodeName}</span>
                <Badge variant={item.success ? 'success' : 'warning'}>{item.kind}</Badge>
              </div>
              <div className="text-text-tertiary">{item.message}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
