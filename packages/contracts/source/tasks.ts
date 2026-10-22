import { z } from 'zod'

/**
 * 通用任务队列的线上契约：**两端共用这一份**。
 *
 * ## 队列只懂生命周期
 *
 * 服务端有一个进程级队列（`packages/core/source/management/tasks/queue.ts`）。它认识的
 * 只有一件事：一个任务从 **排队 → 运行 → 成功 / 失败 / 取消** 的走法。业务语义
 *（「这一轮测的是谁」「算不算通过」）全部留在各自的 **kind** 里，通过 `progress` /
 * `result` 两个**不透明**字段原样携带。
 *
 * 因此这份契约里没有也不可能出现任何渠道诊断的字段名：它描述的是「怎么把一个任务的
 * 生命周期送到界面上」，不是「诊断结果长什么样」。kind 自己的形状住在各自的契约里
 *（诊断的在 `./diagnostics.ts`），客户端按 `kind` 收窄。
 *
 * ## 不落盘
 *
 * 队列是内存台账，进程退出即空。「此刻有什么在跑」没有恢复语义，假装它能恢复只会
 * 制造「重启后任务少了一半」这种无法归因的现象（与 `live-request-stream.ts` 同一条理由）。
 */

/** 一个任务在生命周期里的位置。`cancelled` 是**独立**结局，不是一种失败。 */
export const TaskStatusSchema = z.enum(['queued', 'running', 'success', 'failed', 'cancelled'])
export type TaskStatus = z.infer<typeof TaskStatusSchema>

/**
 * 队列里的一个任务。
 *
 * - `kind` 谁的任务；`progress` / `result` 由该 kind 自己定义，队列只负责携带与推送。
 * - `key` 是这个 kind 的**去重键**（`TaskKind.keyOf` 的输出）。它由 kind 决定、由队列
 *   记录，是队列自己的身份概念：同一个 kind 里 `key` 相同的任务在排队或运行中时不会
 *   重复入队。对客户端来说它也是**把一帧里的任务对回本地视图**的唯一凭据——一个
 *   排队中、还没有任何 `progress` 的任务，只有靠它才说得清「这是哪个目标」。
 * - `progress` 是**进行中的观测**，可以没有（排队时、以及从不汇报进度的 kind）；
 *   `result` 只在成功时有，失败时看 `errorMessage`。
 */
export const TaskRecordSchema = z.object({
  id: z.string(),
  kind: z.string(),
  key: z.string(),
  status: TaskStatusSchema,
  progress: z.unknown().optional(),
  result: z.unknown().optional(),
  errorMessage: z.string().optional(),
  enqueuedAt: z.number(),
  finishedAt: z.number().optional(),
})
export type TaskRecord = z.infer<typeof TaskRecordSchema>

/**
 * 实时推送协议版本。
 *
 * 版本写在每一条消息里而不是握手一次：NDJSON 没有协商阶段，单条消息要能独立判断。
 * 版本不兼容时客户端必须丢弃而不是猜测字段含义。
 */
export const TASKS_STREAM_PROTOCOL_VERSION = 1

const TasksStreamEnvelopeSchema = z.object({
  protocolVersion: z.literal(TASKS_STREAM_PROTOCOL_VERSION),
})

/**
 * 用一份完整状态替换客户端当前状态。连接建立后的第一条消息必定是这个类型。
 *
 * 与「进行中的请求」同一条理由：全量快照天然解决乱序、丢帧、慢客户端与重连对齐，
 * 而队列里的任务本来就有总量上界（见 `queue.ts` 的容量），重发完整状态的代价有界。
 */
export const TasksStreamSnapshotMessageSchema = TasksStreamEnvelopeSchema.extend({
  type: z.literal('snapshot'),
  tasks: z.array(TaskRecordSchema),
})

/**
 * 只证明连接仍然活着，不携带也不改变任何状态。
 *
 * 这条流**不结束**：它是进程级台账的读数，空闲时靠心跳证明连接还在。
 */
export const TasksStreamHeartbeatMessageSchema = TasksStreamEnvelopeSchema.extend({
  type: z.literal('heartbeat'),
})

/** 推送流里一行的完整类型集合；`type` 是唯一的消息判别字段。 */
export const TasksStreamMessageSchema = z.discriminatedUnion('type', [
  TasksStreamSnapshotMessageSchema,
  TasksStreamHeartbeatMessageSchema,
])
export type TasksStreamMessage = z.infer<typeof TasksStreamMessageSchema>

/**
 * `POST /api/tasks/enqueue` 的请求体。
 *
 * `items` 是 kind 自己的载荷，队列不解释它——因此这里只能声明它是数组，逐项校验交给
 * 该 kind 注册时的 `parse`。同一个请求里只有一个 `kind`：一批任务的形状由发起它们的
 * 那一件事决定，混着两种 kind 的批次没有意义。
 */
export const TaskEnqueueRequestSchema = z.object({
  kind: z.string().trim().min(1),
  items: z.array(z.unknown()),
})

/**
 * 入队结果。
 *
 * 刻意只给两个计数，不给逐项账：界面把「用户选了什么」和「服务端收下了多少」分开看，
 * 而对上号这件事不靠这个响应——一帧快照里的每个任务都带着自己的 `key`（见
 * {@link TaskRecord}）。
 *
 * `skipped` 包含五种「没收下」，全部是**正常的调度结果**，不是请求失败：
 *
 * 1. 这个 `kind` 没有注册（进程里根本没有能跑它的实现）；
 * 2. 这一项不能被该 kind 解析（`parse` 抛了）；
 * 3. 这一项算不出键（`keyOf` 抛了）；
 * 4. 同 kind 同 `key` 已经在排队 / 运行中（去重）；
 * 5. 队列已满（`MAX_QUEUE_TASKS`）。
 *
 * 一次「全选 → 开始」里本来就可能有一半已经在跑，所以界面要如实报出这两个数，
 * 而不是静默吞掉。
 */
export interface TaskEnqueueResponse {
  accepted: number
  skipped: number
}

/** `POST /api/tasks/cancel` 的请求体。`taskIds` 与 `kind` 至少给一个。 */
export const TaskCancelRequestSchema = z
  .object({
    taskIds: z.array(z.string()).optional(),
    kind: z.string().optional(),
  })
  .refine(request => request.taskIds !== undefined || request.kind !== undefined, {
    message: 'Provide taskIds or kind.',
  })
export type TaskCancelRequest = z.infer<typeof TaskCancelRequestSchema>

/**
 * 取消的结果：**本次调用新发出的取消信号数**。
 *
 * 包含两类：未开跑的（被直接标成 `cancelled`）与在跑的（发信号，由那次运行自己在步边界
 * 收尾）。后一类此刻还停在 `running` 上——它已经被发了信号，只是还没 settle。
 * 已经结束的、以及已经在取消中的都不算，所以这个数不会大于本次 `taskIds` 里真实存在的任务数。
 *
 * 为什么改的是这句描述而不是口径：这个数在返回的那一刻**只能**是「发出了几个信号」。
 * 想数「真的落在 `cancelled` 上的任务」，就得等那些在跑的任务自己收尾——那是异步的，
 * 一次同步返回的响应给不出这个数（要给就只能变成「轮询到全部 settle 为止」，取消按钮会
 * 挂在那里等上游超时）。今天界面丢弃这个返回值，改口径看不出任何差别，但契约里留着
 * 一句自相矛盾的描述，下一个用它的人会按它写出错的断言。
 */
export interface TaskCancelResponse {
  cancelled: number
}

/** 清掉终态项的结果。有任务在跑时是空操作，`cleared` 为 `0`。 */
export interface TaskClearResponse {
  cleared: number
}

/** `POST /api/tasks/snapshot` 的响应体。 */
export interface TaskSnapshotResponse {
  tasks: TaskRecord[]
}
