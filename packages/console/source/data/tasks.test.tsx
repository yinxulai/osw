// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskRecord } from '@common/tasks'
import { expectRenderThrow } from '@/test-support'
import { TasksProvider, useTasks } from './tasks'

/*
 * 通用任务队列的客户端：**只订阅与转发**。
 *
 * 调度在服务端跑（`packages/core/source/management/tasks/`），这一层不持有任何队列状态，
 * 也没有「谁在跑、下一个是谁」这种问题。所以这里守着三件事：
 *
 * 1. 快照原样成为 `tasks`，不在客户端二次加工（与 `live-requests` / `live-metrics` 同一条）。
 * 2. 断线会自己重连，重连期间保留上一帧——否则一次后台重启就会让面板闪成空白。
 * 3. 命令（入队 / 取消 / 清空）原样转发，界面不自己记账。
 */

type Connection = {
  signal: AbortSignal
  emit: (message: unknown) => void
  finish: () => void
}

const streams = vi.hoisted(() => ({ tasks: [] as Connection[] }))

interface ConnectOptions { signal: AbortSignal; onMessage: (message: never) => void }

function connect(into: Connection[], options: ConnectOptions): Promise<void> {
  return new Promise<void>(resolve => {
    into.push({
      signal: options.signal,
      emit: message => options.onMessage(message as never),
      finish: resolve,
    })
  })
}

vi.mock('@/api/live-stream', () => ({
  readTaskStream: (options: never) => connect(streams.tasks, options),
}))

const api = vi.hoisted(() => ({
  enqueue: vi.fn(),
  cancel: vi.fn(),
  clear: vi.fn(),
}))

vi.mock('@/api/tasks', () => ({ taskApi: api }))

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task_1',
    kind: 'model-test',
    key: 'm1:openai-completions',
    status: 'queued',
    enqueuedAt: 1,
    ...overrides,
  }
}

const control = { enabled: true }

interface WrapperProps { children: ReactNode }

function wrapper(props: WrapperProps) {
  return <TasksProvider enabled={control.enabled}>{props.children}</TasksProvider>
}

function mount() {
  return renderHook(() => useTasks(), { wrapper })
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(0)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  streams.tasks = []
  control.enabled = true
  api.enqueue.mockReset().mockResolvedValue({ success: true, data: { accepted: 2, skipped: 1 } })
  api.cancel.mockReset().mockResolvedValue({ success: true, data: { cancelled: 2 } })
  api.clear.mockReset().mockResolvedValue({ success: true, data: { cleared: 3 } })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('TasksProvider', () => {
  it('在 Provider 外使用会立刻报错，并点名该用哪个 Provider', () => {
    expectRenderThrow(() => renderHook(() => useTasks()), 'useTasks must be used inside TasksProvider')
  })

  it('首帧快照原样成为 tasks：客户端不重排、不过滤、不补字段', () => {
    const { result } = mount()
    const tasks = [task({ id: 'b' }), task({ id: 'a', status: 'running' })]

    act(() => streams.tasks[0].emit({ protocolVersion: 1, type: 'snapshot', tasks }))

    // 顺序就是服务端的入队顺序；这是用户看「谁先跑」的唯一依据。
    expect(result.current.tasks.map(item => item.id)).toEqual(['b', 'a'])
  })

  it('心跳不改变 tasks', () => {
    const { result } = mount()

    act(() => streams.tasks[0].emit({ protocolVersion: 1, type: 'snapshot', tasks: [task()] }))
    act(() => streams.tasks[0].emit({ protocolVersion: 1, type: 'heartbeat' }))

    expect(result.current.tasks).toHaveLength(1)
  })

  it('新快照整份替换旧快照（清掉的终态项真的会消失）', () => {
    const { result } = mount()

    act(() => streams.tasks[0].emit({ protocolVersion: 1, type: 'snapshot', tasks: [task({ id: 'a' }), task({ id: 'b' })] }))
    act(() => streams.tasks[0].emit({ protocolVersion: 1, type: 'snapshot', tasks: [task({ id: 'b' })] }))

    expect(result.current.tasks.map(item => item.id)).toEqual(['b'])
  })

  it('enabled 关掉时断开连接并清空 tasks', () => {
    const { result, rerender } = mount()

    act(() => streams.tasks[0].emit({ protocolVersion: 1, type: 'snapshot', tasks: [task()] }))
    expect(result.current.tasks).toHaveLength(1)

    control.enabled = false
    rerender()

    expect(streams.tasks[0].signal.aborted).toBe(true)
    // 没接流却还挂着上一份台账，比空列表更误导。
    expect(result.current.tasks).toEqual([])
  })

  it('断开重连后保留上一帧，直到新快照到达', async () => {
    const { result } = mount()
    act(() => streams.tasks[0].emit({ protocolVersion: 1, type: 'snapshot', tasks: [task({ status: 'running' })] }))

    await act(async () => {
      streams.tasks[0].finish()
    })
    await flush()

    expect(streams.tasks).toHaveLength(2)
    expect(result.current.tasks).toHaveLength(1)

    act(() => streams.tasks[1].emit({ protocolVersion: 1, type: 'snapshot', tasks: [task({ status: 'success' })] }))
    expect(result.current.tasks[0].status).toBe('success')
  })

  it('卸载时断开连接', () => {
    const { unmount } = mount()

    unmount()

    expect(streams.tasks[0].signal.aborted).toBe(true)
  })
})

describe('命令转发', () => {
  it('入队原样带上 kind 与载荷，返回服务端的收下 / 跳过计数', async () => {
    const { result } = mount()
    const items = [{ modelId: 'm1', providerId: 'prov_1', protocol: 'openai-completions' }]

    let accepted: { accepted: number; skipped: number } | undefined
    await act(async () => {
      accepted = await result.current.enqueue('model-test', items)
    })

    expect(api.enqueue).toHaveBeenCalledWith('model-test', items)
    // `skipped` 是正常的调度结果（去重 / 队列满 / 载荷不被这个 kind 接受），不是失败。
    expect(accepted).toEqual({ accepted: 2, skipped: 1 })
  })

  it('取消两种粒度都转发，返回真的被取消的数量', async () => {
    const { result } = mount()

    let cancelled: number | undefined
    await act(async () => {
      cancelled = await result.current.cancel({ kind: 'model-test' })
    })

    expect(api.cancel).toHaveBeenCalledWith({ kind: 'model-test' })
    expect(cancelled).toBe(2)
  })

  it('清空返回服务端真的清掉的条数（有任务在跑时是 0，由服务端判定）', async () => {
    const { result } = mount()

    let cleared: number | undefined
    await act(async () => {
      cleared = await result.current.clear()
    })

    expect(api.clear).toHaveBeenCalled()
    expect(cleared).toBe(3)
  })

  it('命令抛错时原样冒出来，不吞成 0（界面要能看见「没成功」）', async () => {
    api.clear.mockResolvedValue({ success: false, errorCode: 'INTERNAL_ERROR', errorMessage: 'boom' })
    const { result } = mount()

    await expect(act(async () => {
      await result.current.clear()
    })).rejects.toThrow()
  })
})
