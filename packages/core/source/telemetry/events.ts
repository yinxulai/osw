import type { WorkflowTrace } from '@common/router/types'
import { reportTelemetryEvent } from './index'

/**
 * 把一次工作流执行的轨迹翻译成事件：**每执行过一个节点发一条**。
 *
 * 放在这里而不是各自的事件点位里，是因为工作流有两条执行路径——代理里的路由求解
 * （`proxy/routing/route-resolver.ts`）与画布上的试跑（`management/routes/router/run.ts`）
 * ——它们必须同一口径。引擎本身不能发：它在 `contracts` 里，那一层不认识遥测
 * （见 `packages/toolkit/scripts/check-package-boundaries.mjs`），所以只能由拿到 `trace`
 * 的调用方代发。
 *
 * 这是事件目录里量最大的一条：一次请求可能连跑好几个节点，批量队列就是为它存在的
 * （`telemetry.md` §5.3）。`node_kind` 复用引擎自己的节点类型闭集，不在这里再抄一份。
 *
 * 轨迹里的步骤不是全都执行过：被禁用而跳过的节点、以及「图里没有输入节点」时那条占位也留在
 * 轨迹里（界面要讲清「为什么走到这里」）。它们带 `executed: false`，这里先滤掉——
 * 把没跑过的节点报成「用过了」，只会让这张表里混进没发生的事。
 */
export function reportWorkflowTrace(trace: readonly WorkflowTrace[]): void {
  for (const step of trace) {
    if (step.executed === false) continue
    reportTelemetryEvent({ name: 'workflow_node_executed', node_kind: step.kind })
  }
}
