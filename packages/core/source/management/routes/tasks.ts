import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  TaskCancelRequestSchema,
  TaskEnqueueRequestSchema,
  type TaskCancelResponse,
  type TaskClearResponse,
  type TaskEnqueueResponse,
  type TaskSnapshotResponse,
} from '@common/tasks'
import { HttpRouter } from '@server/http-router'
import type { ManagementHandler } from '../core/response'
import { sendSuccess } from '../core/response'
import { attachTaskStream } from '../infrastructure/task-stream'
import { taskQueue } from '../tasks'

/**
 * 通用任务队列的管理接口。五条 `POST`，全部挂在 `/api/tasks/*` 下。
 *
 * 它是一个普通的管理 API：`POST`、`/api/` 前缀、同样过守卫与 CORS——「只接 `POST`」
 * 这条既有姿态一条都没破（见 `core/request-guards.ts`）。
 *
 * 路由层只做 HTTP 适配：校验入参、把载荷原样交给队列、把结果写回响应。任务怎么排、
 * 并发多少、取消怎么收，都在引擎里；一个任务是什么、算不算成功，都在 kind 里。
 */

export const taskRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/tasks/enqueue', handleEnqueue)
  .post('/api/tasks/snapshot', handleSnapshot)
  .post('/api/tasks/stream', handleStream)
  .post('/api/tasks/cancel', handleCancel)
  .post('/api/tasks/clear', handleClear)

/**
 * 入队：`{ kind, items, concurrency? }` → `{ accepted, skipped }`。载荷逐项由该 kind 校验。
 *
 * `concurrency` 原样透传给引擎，路由层不解释它——它是调度参数（这次入队同时在飞几个），
 * 校验归契约、归一化归引擎（见 `@common/tasks` 的 `TaskEnqueueRequestSchema`）。
 */
function handleEnqueue(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const request = TaskEnqueueRequestSchema.parse(body)
  const result = taskQueue.enqueue(request.kind, request.items, { concurrency: request.concurrency })
  sendSuccess(res, { accepted: result.accepted, skipped: result.skipped } satisfies TaskEnqueueResponse)
}

/** 当前队列。界面打开面板时先拿一份，随后由推送流接管。 */
function handleSnapshot(_req: IncomingMessage, res: ServerResponse): void {
  sendSuccess(res, { tasks: taskQueue.snapshot() } satisfies TaskSnapshotResponse)
}

/**
 * 取消：按 `taskIds` 或按 `kind`。
 *
 * 两种粒度都留着：`taskIds` 是「这一行不测了」，`kind` 是「这个面板整个停掉」。
 * 未开跑的直接出队（零上游请求），在跑的在下一次步边界收。
 */
function handleCancel(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const request = TaskCancelRequestSchema.parse(body)
  const byIds = request.taskIds ? taskQueue.cancel(request.taskIds) : 0
  const byKind = request.kind ? taskQueue.cancelKind(request.kind) : 0
  sendSuccess(res, { cancelled: byIds + byKind } satisfies TaskCancelResponse)
}

/** 清终态项；有任务在跑时是空操作（那条在跑的行不该凭空消失）。 */
function handleClear(_req: IncomingMessage, res: ServerResponse): void {
  sendSuccess(res, { cleared: taskQueue.clear() } satisfies TaskClearResponse)
}

/**
 * 队列——持续推送。
 *
 * 一条长响应，每帧一行版本化的 `TasksStreamMessage`（NDJSON）。它在契约上仍是一个普通
 * 管理 API：`POST`、`/api/` 前缀、同样过守卫与 CORS；它**不结束**——队列是进程级台账，
 * 没有「推完」这个时刻，界面也只通过这一条通道读取它。
 *
 * 处理函数要一直等到连接关掉才返回：管理服务的访问日志以「处理函数返回」为一条请求的
 * 完成，提前返回会让一条活了三分钟的连接在日志里被记成几毫秒就结束了。
 */
async function handleStream(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.statusCode = 200
  // NDJSON 而不是 SSE：推的就是 JSON 对象本身，不需要再包一层 `data: `。
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  // 这份数据只在「此刻」有意义：任何一层的缓存或转换缓冲都会把它变成一份过期快照。
  res.setHeader('Cache-Control', 'no-store, no-transform')
  const detach = attachTaskStream(res)
  await new Promise<void>(resolve => {
    res.once('close', resolve)
  })
  detach()
}
