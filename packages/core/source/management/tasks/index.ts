import { modelTestTaskKind } from './kinds/model-test'
import { TaskQueue } from './queue'

/**
 * 进程级通用任务队列的**唯一实例**。
 *
 * 一个进程就一套调度，没有「同一个任务属于哪个队列」的问题（与 `liveRequestStore`
 * 同一条理由）。kind 在这里注册：登记是**加载即完成**的，不存在「先入队再注册」的竞态——
 * 路由与推送通道都 import 这个模块，谁先加载都一样。
 *
 * 目前只有一个 kind（渠道诊断），但这不是它的定义：任何「一批要真跑、有进度、能取消、
 * 结果要能边跑边看」的任务都往这里注册一个 kind（见 `apps/docs/specs/task-queue.md`）。
 */
export const taskQueue = new TaskQueue()
taskQueue.register(modelTestTaskKind)

export { TaskQueue, MAX_QUEUE_TASKS } from './queue'
export type { EnqueueResult, TaskKind, TaskRunContext } from './queue'
export { MODEL_TEST_TASK_KIND } from './kinds/model-test'
