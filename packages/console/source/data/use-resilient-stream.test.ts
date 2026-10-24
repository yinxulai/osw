// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useResilientStream } from './use-resilient-stream'

/*
 * 退避策略是这里唯一的行为，也是唯一容易写错的地方：
 *
 * - **第一次重连不等**：首次连接失败通常只是应用还没把服务拉起来；
 * - **连够 10 秒才算成功**：否则一个「连上就断」的服务会永远停在首次退避那一档；
 * - **封顶 5 秒**：这是本机服务，不是远端接口，一直失败也不必退得更远。
 *
 * 用假定时器把时间轴握在手里（`vi.useFakeTimers()` 默认连 `Date` 一起假）。断定的是
 * **「上一条断开」到「下一条建立」之间等了多久**，也就是用户能观察到的「断了多久才连回来」；
 * 一条连接自己活了多久是另一件事，两者不能混进同一个差值里。
 *
 * 时钟推进的量级由用例给（`wait`），比实现该等的更长；实现真正等多久由它自己决定，
 * 由此测出来的才是它的退避，而不是把期望值当输入喂回去。
 */

const state = vi.hoisted(() => ({
  /** 每条连接收到的中止信号，用来验证清理真的断了连接。 */
  signals: [] as AbortSignal[],
  /** 每条连接建立时的当前时间。 */
  startedAt: [] as number[],
  /** 每条连接结束时的当前时间。 */
  endedAt: [] as number[],
  /** 正常结束第 index 条连接。 */
  finishes: [] as (() => void)[],
  /** 让第 index 条连接以异常结束。 */
  rejections: [] as ((error: Error) => void)[],
  /** hook 交给第 index 条连接的消息入口。 */
  sinks: [] as ((message: string) => void)[],
}))

beforeEach(() => {
  vi.useFakeTimers()
  state.signals = []
  state.startedAt = []
  state.endedAt = []
  state.finishes = []
  state.rejections = []
  state.sinks = []
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

interface ReadOptions { signal: AbortSignal; onMessage: (message: string) => void }

interface EnabledProps { enabled: boolean }

interface HandlerProps { handler: (message: string) => void }

interface TagProps { tag: string }

/** 建立一次连接：记录信号与起始时间，把「什么时候结束」的控制权交给用例。 */
function read(options: ReadOptions) {
  state.signals.push(options.signal)
  state.sinks.push(options.onMessage)
  state.startedAt.push(Date.now())
  const index = state.startedAt.length - 1
  return new Promise<void>((resolve, reject) => {
    state.finishes[index] = resolve
    state.rejections[index] = reject
  })
}

/** 排干挂起的微任务，并把 0 延时的重连定时器跑起来。 */
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(0)
  })
}

/** 推进时间，让到期的重连定时器与随之而来的回调都跑完。 */
async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds)
  })
}

/** 记下断开时刻并结束第 index 条连接；`wait` 是推进给重连用的时间窗。 */
async function finish(index: number, wait = 0) {
  state.endedAt[index] = Date.now()
  await act(async () => {
    state.finishes[index]()
  })
  await flush()
  if (wait > 0) await advance(wait)
}

/** 记下断开时刻并让第 index 条连接以异常结束。 */
async function fail(index: number, wait = 0) {
  state.endedAt[index] = Date.now()
  await act(async () => {
    state.rejections[index](new Error('connection reset'))
  })
  await flush()
  if (wait > 0) await advance(wait)
}

/** 每一条断开之后实际等了多久才连下一条。 */
function delays(): number[] {
  return state.startedAt.slice(1).map((startedAt, index) => startedAt - state.endedAt[index])
}

describe('useResilientStream', () => {
  it('enabled 为假时一条连接都不建，不空转一条流', () => {
    renderHook(() => useResilientStream({ enabled: false, read, onMessage: () => undefined }))

    expect(state.signals).toEqual([])
  })

  it('enabled 为真时立刻连上', () => {
    renderHook(() => useResilientStream({ enabled: true, read, onMessage: () => undefined }))

    expect(state.signals).toHaveLength(1)
  })

  it('每条消息原样交给 onMessage', () => {
    const received: string[] = []
    renderHook(() => useResilientStream({ enabled: true, read, onMessage: message => received.push(message) }))

    act(() => state.sinks[0]('snapshot'))

    expect(received).toEqual(['snapshot'])
  })

  it('短命连接：第一次重连不等，此后 500ms 起指数退避', async () => {
    renderHook(() => useResilientStream({ enabled: true, read, onMessage: () => undefined }))

    // 第 1 条结束（活的时长为 0，不算「连得成」）→ 第一次重连不等。
    await finish(0)
    expect(state.signals).toHaveLength(2)
    expect(delays()).toEqual([0])

    // 第 2 条又断 → 等 500ms。
    await finish(1, 500)
    expect(state.signals).toHaveLength(3)
    expect(delays()).toEqual([0, 500])

    // 第 3 条再断 → 等 1000ms。
    await finish(2, 1_000)
    expect(state.signals).toHaveLength(4)
    expect(delays()).toEqual([0, 500, 1_000])
  })

  it('退避封顶 5 秒：本机服务不必退得更远', async () => {
    renderHook(() => useResilientStream({ enabled: true, read, onMessage: () => undefined }))

    // 反复「连上就断」，每次给一个比任何一档退避都长的窗口；真正连回来的时刻由实现决定。
    // 0 → 500 → 1000 → 2000 → 4000 → 此后 8000/16000… 都被截到 5000。
    for (let index = 0; index < 10; index += 1) await finish(index, 6_000)

    expect(delays()).toEqual([0, 500, 1_000, 2_000, 4_000, 5_000, 5_000, 5_000, 5_000, 5_000])
  })

  it('活得超过 10 秒的连接算成功，失败计数清零', async () => {
    renderHook(() => useResilientStream({ enabled: true, read, onMessage: () => undefined }))

    await finish(0)
    expect(delays()).toEqual([0])

    // 第 2 条连了 10 秒零 1 毫秒才断 → 算成功，下一轮重新从 0 开始。
    await advance(10_001)
    await finish(1)
    await finish(2, 500)

    expect(delays()).toEqual([0, 0, 500])
  })

  it('刚满 10 秒还不算成功：判据是大于，不是大于等于', async () => {
    renderHook(() => useResilientStream({ enabled: true, read, onMessage: () => undefined }))

    await finish(0)
    await advance(10_000)
    await finish(1, 500)

    // 计数没清零，所以下一条仍然等 500ms，而不是立刻建。
    expect(delays()).toEqual([0, 500])
  })

  it('连接以异常结束也照样重连，并打一行 warn 把原因留在控制台里', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    renderHook(() => useResilientStream({ enabled: true, read, onMessage: () => undefined }))

    await fail(0)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('connection reset')
    expect(state.signals).toHaveLength(2)
  })

  it('我们自己掐断的连接不打印 warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { unmount } = renderHook(() => useResilientStream({ enabled: true, read, onMessage: () => undefined }))

    unmount()
    await act(async () => {
      state.rejections[0](new Error('aborted'))
    })
    await flush()

    expect(warn).not.toHaveBeenCalled()
    expect(state.signals).toHaveLength(1)
  })

  it('卸载时中止正在跑的连接并停住重连', async () => {
    const { unmount } = renderHook(() => useResilientStream({ enabled: true, read, onMessage: () => undefined }))

    // 第 1 条断掉后立刻重连出第 2 条，它一直在跑——卸载必须把它掐掉。
    await finish(0)
    expect(state.signals).toHaveLength(2)
    expect(state.signals[1].aborted).toBe(false)

    unmount()
    expect(state.signals[1].aborted).toBe(true)

    await advance(30_000)
    expect(state.signals).toHaveLength(2)
  })

  it('卸载时正在等的重连不会在定时器到期后偷偷连上', async () => {
    const { unmount } = renderHook(() => useResilientStream({ enabled: true, read, onMessage: () => undefined }))

    await finish(0)
    // 第 2 条仍等着 500ms 重连，此刻还是 2 条。
    state.endedAt[1] = Date.now()
    await act(async () => {
      state.finishes[1]()
    })
    await flush()
    expect(state.signals).toHaveLength(2)

    unmount()
    await advance(30_000)
    expect(state.signals).toHaveLength(2)
  })

  it('enabled 关掉时立刻断开，重新打开时另起一条', () => {
    const { rerender } = renderHook(
      ({ enabled }: EnabledProps) => useResilientStream({ enabled, read, onMessage: () => undefined }),
      { initialProps: { enabled: true } },
    )
    expect(state.signals).toHaveLength(1)

    rerender({ enabled: false })
    expect(state.signals[0].aborted).toBe(true)

    rerender({ enabled: true })
    expect(state.signals).toHaveLength(2)
  })

  it('onMessage 每次渲染都是新函数也不重连：effect 只随 enabled 起落', () => {
    const { rerender } = renderHook(
      ({ handler }: HandlerProps) => useResilientStream({ enabled: true, read, onMessage: handler }),
      { initialProps: { handler: (_message: string) => undefined } },
    )
    expect(state.signals).toHaveLength(1)

    rerender({ handler: (_message: string) => undefined })
    rerender({ handler: (_message: string) => undefined })

    // 内联箭头函数每次都是新引用；写进依赖数组的话这条流会被反复掐断重开。
    expect(state.signals).toHaveLength(1)
  })

  it('onMessage 走 ref 取最新那一个，不靠重连去换回调', () => {
    const calls: string[] = []
    const { rerender } = renderHook(
      ({ tag }: TagProps) => useResilientStream({ enabled: true, read, onMessage: message => calls.push(`${tag}:${message}`) }),
      { initialProps: { tag: 'first' } },
    )

    rerender({ tag: 'second' })
    act(() => state.sinks[0]('snapshot'))

    // 连接还是第一条，但消息已经交给重渲染之后那个回调。
    expect(calls).toEqual(['second:snapshot'])
    expect(state.signals).toHaveLength(1)
  })
})
