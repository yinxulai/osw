// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useWindowFullScreen } from './use-window-full-screen'

/*
 * 窗口是不是全屏只有一个来源：主进程。渲染进程能做的只有两件事——订阅变化、拉一次初值。
 *
 * 初值这条通道是**可能失败的**（IPC 还没就绪、主进程忙），失败时不能把整个界面带崩，
 * 所以它只是打一行日志、保持 `false`。这里把这两条通道都钉住。
 */

const state = vi.hoisted(() => ({
  listen: null as ((callback: (fullScreen: boolean) => void) => () => void) | null,
  read: null as (() => Promise<boolean>) | null,
  /** 用例自己决定什么时候把初值交出来。 */
  resolve: null as ((value: boolean) => void) | null,
  reject: null as ((error: Error) => void) | null,
  unsubscribed: 0,
  listeners: [] as ((fullScreen: boolean) => void)[],
}))

vi.mock('@/platform/capabilities', () => ({
  getPlatformCapabilities: () => ({
    listen: state.listen,
    getFullScreenState: state.read,
    onFullScreenChanged: state.listen,
  }),
}))

function setup() {
  state.listeners = []
  state.unsubscribed = 0
  state.listen = callback => {
    state.listeners.push(callback)
    return () => {
      state.unsubscribed += 1
    }
  }
  state.read = () =>
    new Promise<boolean>((resolve, reject) => {
      state.resolve = resolve
      state.reject = reject
    })
}

describe('useWindowFullScreen', () => {
  it('还没有任何消息时按「不是全屏」处理', () => {
    setup()

    const { result } = renderHook(() => useWindowFullScreen())

    expect(result.current).toBe(false)
  })

  it('订阅窗口变化并拉一次初值', () => {
    setup()

    renderHook(() => useWindowFullScreen())

    expect(state.listeners).toHaveLength(1)
    expect(state.read).toBeTypeOf('function')
  })

  it('初值到达后立刻反映出来', async () => {
    setup()
    const { result } = renderHook(() => useWindowFullScreen())

    state.resolve?.(true)

    await waitFor(() => expect(result.current).toBe(true))
  })

  it('主进程推来的变化实时跟随', async () => {
    setup()
    const { result } = renderHook(() => useWindowFullScreen())

    state.listeners[0](true)
    await waitFor(() => expect(result.current).toBe(true))

    state.listeners[0](false)
    await waitFor(() => expect(result.current).toBe(false))
  })

  it('初值读取失败只留一行日志，不会把界面带崩', async () => {
    setup()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { result } = renderHook(() => useWindowFullScreen())

    state.reject?.(new Error('ipc not ready'))

    await waitFor(() => expect(error).toHaveBeenCalled())
    expect(String(error.mock.calls[0][0])).toContain('[window-full-screen] failed to read initial state')
    expect(result.current).toBe(false)
  })

  it('两条通道谁后到谁说了算：迟到的初值会盖掉先到的变化', async () => {
    setup()
    const { result } = renderHook(() => useWindowFullScreen())

    // 变化先到（比如用户更快地按了全屏），随后才拿到「初值」。
    state.listeners[0](true)
    await waitFor(() => expect(result.current).toBe(true))

    // 这里没有先后保证：两条通道都只是 setState，谁后落到 React 里谁生效。
    // 记下来是因为它就是当前的行为——主进程推来的状态是权威的，而至多只会有一条
    // 「晚到的初值」能把界面短暂带回旧值，下一次变化就会纠正。
    state.resolve?.(false)
    await waitFor(() => expect(result.current).toBe(false))
  })

  it('卸载后退订并忽略后来到达的消息', async () => {
    setup()
    const { result, unmount } = renderHook(() => useWindowFullScreen())

    unmount()
    expect(state.unsubscribed).toBe(1)

    // 卸载之后主进程才回话，此时不能再 setState。
    state.resolve?.(true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(result.current).toBe(false)
  })
})
