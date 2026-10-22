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
export type TasksStreamSnapshotMessage = z.infer<typeof TasksStreamSnapshotMessageSchema>

/**
 * 只证明连接仍然活着，不携带也不改变任何状态。
 *
 * 这条流**不结束**：它是进程级台账的读数，空闲时靠心跳证明连接还在。
 */
export const TasksStreamHeartbeatMessageSchema = TasksStreamEnvelopeSchema.extend({
  type: z.literal('heartbeat'),
})
export type TasksStreamHeartbeatMessage = z.infer<typeof TasksStreamHeartbeatMessageSchema>

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
export type TaskEnqueueRequest = z.infer<typeof TaskEnqueueRequestSchema>

/**
 * 入队结果。
 *
 * 刻意只给两个计数，不给逐项账：界面把「用户选了什么」和「服务端收下了多少」分开看，
 * 而对上号这件事不靠这个响应——一帧快照里的每个任务都带着自己的 `key`（见
 * {@link TaskRecord}）。
 *
 * `skipped` 包含三种「没收下」：已经在排队 / 运行中的同键任务（去重）、队列已满、
 * 以及这一项不能被该 kind 解析。三者都是**正常的调度结果**，不是请求失败。
 */
export interface TaskEnqueueResponse {
  accepted: number
  skipped: number
}

/** `POST /api/tasks/cancel` 的请求体。`taskIds` 与 `kind` 至少给一个。 */
export const TaskCancelRequestSchema = z.object({
  taskIds: z.array(z.string()).optional(),
  kind: z.string().optional(),
})
export type TaskCancelRequest = z.infer<typeof TaskCancelRequestSchema>

/** 取消的结果：真的落到「取消」上的任务数（已经结束的不算）。 */
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
