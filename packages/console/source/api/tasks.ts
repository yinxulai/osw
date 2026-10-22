import type {
  TaskCancelRequest,
  TaskCancelResponse,
  TaskClearResponse,
  TaskEnqueueResponse,
  TaskSnapshotResponse,
  TaskStatus,
  TaskRecord,
} from '@common/tasks'
import { request } from './client'

/**
 * 通用任务队列的管理接口。
 *
 * 形状**不在这一层定义**：它们住在契约层（`@common/tasks`），服务端按同一份声明产出、
 * 界面按同一份声明消费（见 `api/tools.ts` 的同一条说明）。
 *
 * `items` 的类型是 `unknown[]` 是刻意的：每个 kind 的载荷形状由它自己声明
 *（诊断的在 `@common/diagnostics` 的 `ModelTestTaskItem`），这一层只负责把
 * 「哪个 kind、哪些项」原样送出去。
 */
export const taskApi = {
  enqueue: (kind: string, items: readonly unknown[]) => request<TaskEnqueueResponse>('/tasks/enqueue', { kind, items }),
  snapshot: () => request<TaskSnapshotResponse>('/tasks/snapshot'),
  cancel: (input: TaskCancelRequest) => request<TaskCancelResponse>('/tasks/cancel', input),
  clear: () => request<TaskClearResponse>('/tasks/clear'),
}

export type { TaskRecord, TaskStatus }
