import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { WorkflowGraphSchema } from '@common/router/schemas'
import { listRouterGraphVersions, readRouterGraphVersion, resolveRouterGraph, saveRouterGraphVersion } from '@server/database/router-graph-store'
import { HttpRouter } from '@server/http-router'
import type { ManagementHandler } from '../../core/response'
import { sendSuccess } from '../../core/response'

/**
 * 路由图的读写接口。
 *
 * 前端不缓存图：它读到的就是当前生效的那一份，保存也是存成服务端的一个新版本。
 * 因此「画布上看到的图」与「代理运行时执行的图」之间没有第三份副本可以漂移。
 */

const SaveRouterGraphSchema = z.object({
  graph: WorkflowGraphSchema,
  /** 版本名；留空即空串（版本的身份是记录 id，不用名字占位）。 */
  name: z.string().max(60).optional(),
  /** 版本说明；留空表示不写。 */
  description: z.string().max(200).optional(),
})

const RouterGraphVersionSchema = z.object({
  /** 要读哪一版：传它的**记录 id**，不是版本号。 */
  id: z.string().min(1),
})

export const routerGraphRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/router/graph', handleGetRouterGraph)
  .post('/api/router/graph/versions', handleListRouterGraphVersions)
  .post('/api/router/graph/version', handleGetRouterGraphVersion)
  .post('/api/router/graph/save', handleSaveRouterGraph)

/**
 * 当前生效的路由图；一版都没保存过时是内建默认策略（版本号为 `UNSAVED_ROUTER_GRAPH_VERSION`）。
 *
 * 返回的永远是「代理此刻会执行的那张图」，而不是「最近保存过的那张」：
 * 否则画布打开时只会拿到 `null`，得自己造一张空图充数，而那张图从来没被执行过。
 */
async function handleGetRouterGraph(_req: IncomingMessage, res: ServerResponse, _body: unknown): Promise<void> {
  sendSuccess(res, await resolveRouterGraph())
}

async function handleListRouterGraphVersions(_req: IncomingMessage, res: ServerResponse, _body: unknown): Promise<void> {
  sendSuccess(res, await listRouterGraphVersions())
}

/** 按记录 id 读图；那一版不存在时 `data` 为 `null`。 */
async function handleGetRouterGraphVersion(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = RouterGraphVersionSchema.parse(body)
  sendSuccess(res, await readRouterGraphVersion(input.id))
}

async function handleSaveRouterGraph(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = SaveRouterGraphSchema.parse(body)
  sendSuccess(res, await saveRouterGraphVersion(input.graph, input.name, input.description))
}
