import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { readTaskStream } from '@/api/live-stream'
import { taskApi, type EnqueueTaskOptions } from '@/api/tasks'
import { unwrap } from '@/api/unwrap'
import { useResilientStream } from '@/data/use-resilient-stream'
import type { TaskCancelRequest, TaskRecord } from '@common/tasks'

/** 订阅通用任务队列的返回值。与实时流同构：只有 `tasks`，没有失败态也没有重取。 */
export interface TasksResult {
  tasks: TaskRecord[]
  /**
   * 入队一批 kind 自己的载荷；返回服务端收下 / 跳过的数量。
   *
   * `options` 是这次入队的调度参数（并发上限），与载荷分开——载荷说的是「测什么」，
   * 它说的是「这一批发多快」。
   */
  enqueue: (kind: string, items: readonly unknown[], options?: EnqueueTaskOptions) => Promise<{ accepted: number; skipped: number }>
  /** 按 id 或按 kind 取消；两者可以一起给。 */
  cancel: (input: TaskCancelRequest) => Promise<number>
  /** 清掉终态项（有任务在跑时服务端空操作）。 */
  clear: () => Promise<number>
}

interface TasksProviderProps {
  children: ReactNode
  /** 只有需要任务队列的界面才挂载连接；关掉时立刻断开，不空转一条流。 */
  enabled: boolean
}

const TasksContext = createContext<TasksResult | null>(null)

/**
 * 通用任务队列。
 *
 * 走推送，与「进行中的请求」「实时指标」同构（见 `data/live-requests.tsx`）：服务端在
 * 队列变化时推 `snapshot`，空闲时推不携带状态的 `heartbeat`。区别在数据源与寿命——
 * 这条读的是 `/api/tasks/stream`，而且它**不结束**：队列是进程级台账。
 *
 * **为什么这一层重要**：队列在服务端跑。界面（面板、页面、窗口）关掉、切页、卸载，
 * 都不会中断一个已经在跑的任务——这正是把队列从客户端搬到服务端要换来的东西。
 * 界面这一层只负责订阅与转发命令，不持有任何调度状态。
 *
 * 断线重连交给 {@link useResilientStream}（三条流共用同一份退避逻辑）。
 */
export function TasksProvider(props: TasksProviderProps) {
  const { children, enabled } = props
  const [tasks, setTasks] = useState<TaskRecord[]>([])

  useResilientStream({
    enabled,
    read: readTaskStream,
    onMessage: message => {
      if (message.type === 'snapshot') setTasks(message.tasks)
    },
  })

  // 关掉时清空：没接流却还挂着上一份台账，比空列表更误导（与实时流同一条）。
  useEffect(() => {
    if (!enabled) setTasks([])
  }, [enabled])

  const enqueue = useCallback(
    async (kind: string, items: readonly unknown[], options?: EnqueueTaskOptions) => unwrap(taskApi.enqueue(kind, items, options)),
    [],
  )
  const cancel = useCallback(async (input: TaskCancelRequest) => (await unwrap(taskApi.cancel(input))).cancelled, [])
  const clear = useCallback(async () => (await unwrap(taskApi.clear())).cleared, [])

  const value = useMemo<TasksResult>(() => ({ tasks, enqueue, cancel, clear }), [tasks, enqueue, cancel, clear])
  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>
}

export function useTasks(): TasksResult {
  const value = useContext(TasksContext)
  if (!value) throw new Error('useTasks must be used inside TasksProvider')
  return value
}
