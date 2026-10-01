import type { RouterGraphSaveResult, RouterGraphSnapshot, RouterGraphVersionSummary, WorkflowGraph, WorkflowRunResult } from '@common/router/types'
import { request } from './client'

/**
 * 路由图的读写接口。
 *
 * 图只有服务端一份：界面不缓存它，读到的就是代理正在执行的那一张。
 * 试跑也交给服务端，因为脚本与提示词节点需要主进程的沙箱与网络能力。
 */
export const routerApi = {
  run: (graph: WorkflowGraph, inputPayload: unknown, signal?: AbortSignal) => request<WorkflowRunResult>('/router/run', { graph, inputPayload }, { signal }),
  /**
   * 当前生效的图；一版都没保存过时是内建默认策略（版本号为 `UNSAVED_ROUTER_GRAPH_VERSION`）。
   */
  getGraph: () => request<RouterGraphSnapshot>('/router/graph'),
  getGraphVersions: () => request<RouterGraphVersionSummary[]>('/router/graph/versions'),
  getGraphVersion: (id: string) => request<RouterGraphSnapshot | null>('/router/graph/version', { id }),
  saveGraph: (graph: WorkflowGraph, name?: string, description?: string) => request<RouterGraphSaveResult>('/router/graph/save', { graph, name, description }),
}
