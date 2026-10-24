import { describe, expect, it, vi } from 'vitest'
import { mockResponse } from './test-support'
import { taskRoutes } from './routes/tasks'
import { taskQueue } from './tasks'

/**
 * 路由层的边界：**入参校验**与**它没做多余的事**。
 *
 * 调度在引擎里（`tasks/queue.test.ts`），帧协议在推送通道里
 *（`tasks/task-stream.test.ts`），真连接在 `tasks-http.test.ts`。这里只守一件事：
 * 请求体不合契约时请求被拒，且没有一半写出去。
 */

function responsePayload(response: ReturnType<typeof mockResponse>): Record<string, unknown> {
  return JSON.parse(String(vi.mocked(response.end).mock.calls[0][0])) as Record<string, unknown>
}

describe('任务队列路由', () => {
  it('enqueue 缺 kind 时在查询前就拒掉，一个字节都不写', async () => {
    const response = mockResponse()

    await expect(taskRoutes.invoke('/api/tasks/enqueue', response, { items: [] })).rejects.toThrow()
    expect(response.end).not.toHaveBeenCalled()
  })

  it('enqueue 的 items 必须是数组', async () => {
    const response = mockResponse()

    await expect(taskRoutes.invoke('/api/tasks/enqueue', response, { kind: 'model-test', items: 'nope' })).rejects.toThrow()
    expect(response.end).not.toHaveBeenCalled()
  })

  it('enqueue 的 concurrency 必须是 ≥1 的整数，0 / 小数 / 负数在契约层就拒掉', async () => {
    for (const concurrency of [0, -1, 1.5]) {
      const response = mockResponse()
      await expect(
        taskRoutes.invoke('/api/tasks/enqueue', response, { kind: 'model-test', items: [], concurrency }),
      ).rejects.toThrow()
      expect(response.end).not.toHaveBeenCalled()
    }
  })

  /**
   * `concurrency` 是**这一次入队的调度上限**，路由原样透传给引擎。这里从 HTTP 这一头验
   * 到底：给 3，同一个 kind 就真的同时跑起 3 条（kind 本身声明的是串行）。
   *
   * 顺带钉住「它不是载荷」：`items` 里的每一项都不该因此多出一个字段。
   */
  it('enqueue 的 concurrency 透传给队列，那一刻同时在飞的条数就是它', async () => {
    const kind = 'enqueue-concurrency'
    const seen: unknown[] = []
    taskQueue.register({
      kind,
      concurrency: 1,
      parse: input => input as { id: string },
      keyOf: payload => payload.id,
      run: (payload, context) => new Promise<string>(resolve => {
        seen.push(payload)
        context.signal.addEventListener('abort', () => resolve('stopped'))
      }),
    })

    const response = mockResponse()
    await taskRoutes.invoke('/api/tasks/enqueue', response, {
      kind,
      items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      concurrency: 3,
    })

    expect(responsePayload(response)).toEqual({ success: true, data: { accepted: 4, skipped: 0 } })
    expect(seen).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    expect(taskQueue.snapshot().filter(record => record.kind === kind && record.status === 'running')).toHaveLength(3)

    taskQueue.cancelKind(kind)
    await new Promise(resolve => setTimeout(resolve, 0))
    taskQueue.clear()
  })

  it('cancel 的 taskIds 必须是字符串数组', async () => {
    const response = mockResponse()

    await expect(taskRoutes.invoke('/api/tasks/cancel', response, { taskIds: [1, 2] })).rejects.toThrow()
    expect(response.end).not.toHaveBeenCalled()
  })

  it('snapshot 原样返回当前台账（路由不做过滤与排序）', async () => {
    const response = mockResponse()

    await taskRoutes.invoke('/api/tasks/snapshot', response, {})

    expect(responsePayload(response)).toEqual({ success: true, data: { tasks: [] } })
  })

  it('入队一个未注册的 kind 是「跳过」而不是「失败」', async () => {
    const response = mockResponse()

    await taskRoutes.invoke('/api/tasks/enqueue', response, { kind: 'nope', items: [{ id: 'a' }] })

    expect(responsePayload(response)).toEqual({ success: true, data: { accepted: 0, skipped: 1 } })
  })

  it('clear 在没有在跑的任务时返回清掉的条数', async () => {
    const response = mockResponse()

    await taskRoutes.invoke('/api/tasks/clear', response, {})

    expect(responsePayload(response)).toEqual({ success: true, data: { cleared: taskQueue.snapshot().length } })
  })

  it('cancel 两个字段都没给时在契约层就拒掉，一个字节都不写', async () => {
    const response = mockResponse()

    await expect(taskRoutes.invoke('/api/tasks/cancel', response, {})).rejects.toThrow()
    expect(response.end).not.toHaveBeenCalled()
  })

  it('cancel 同时给 taskIds 与 kind 时，一个在跑的任务只算一次', async () => {
    const kind = 'cancel-dedup'
    taskQueue.register({
      kind,
      parse: input => input as { id: string },
      keyOf: payload => payload.id,
      // 收尾交给取消信号：验收「在跑」这一格，而不是一条马上结束的任务。
      run: (_payload, context) => new Promise<string>(resolve => {
        context.signal.addEventListener('abort', () => resolve('stopped'))
      }),
    })
    taskQueue.enqueue(kind, [{ id: 'x' }])
    const [record] = taskQueue.snapshot()
    expect(record).toMatchObject({ kind, status: 'running' })

    const response = mockResponse()
    await taskRoutes.invoke('/api/tasks/cancel', response, { taskIds: [record.id], kind })

    // 两条路径指向同一条在跑的任务：`abort()` 不立即改状态，不特别处理会返回 2。
    expect(responsePayload(response)).toEqual({ success: true, data: { cancelled: 1 } })

    await new Promise(resolve => setTimeout(resolve, 0))
    taskQueue.clear()
  })
})
