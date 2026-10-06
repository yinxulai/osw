import { describe, expect, it, vi } from 'vitest'
import { delay, waitFor } from './async'

// `waitFor` 是 `stop` 等「另一个进程真的退出」的唯一依据，所以它必须**不撒谎**：
// 条件已成真时不该多等一个间隔，超时时必须报 false 而不是把「快好了」当成好了。

describe('delay', () => {
  it('resolves only after the requested time has passed', async () => {
    vi.useFakeTimers()
    try {
      let settled = false
      const pending = delay(500).then(() => {
        settled = true
      })

      await vi.advanceTimersByTimeAsync(499)
      expect(settled).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      await pending
      expect(settled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('waitFor', () => {
  it('does not wait an interval when the predicate already holds', async () => {
    // 先判断再等待：调用时条件可能已经成立，白等一个间隔就是白白拖慢退出。
    vi.useFakeTimers()
    try {
      const calls = vi.fn(() => true)

      expect(await waitFor(calls, 10_000, 200)).toBe(true)
      expect(calls).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps polling until the predicate turns true', async () => {
    vi.useFakeTimers()
    try {
      let ready = false
      const checks: number[] = []
      const pending = waitFor(() => {
        checks.push(Date.now())
        if (checks.length === 3) ready = true
        return ready
      }, 10_000, 200)

      await vi.advanceTimersByTimeAsync(10_000)
      expect(await pending).toBe(true)
      // 前两次为假、第三次为真：总共三次判断，说明它真的按间隔轮询而不是空转。
      expect(checks).toHaveLength(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a timeout as false instead of claiming success', async () => {
    vi.useFakeTimers()
    try {
      const pending = waitFor(() => false, 500, 200)

      await vi.advanceTimersByTimeAsync(1_000)
      expect(await pending).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-checks one last time before giving up', async () => {
    // 收尾那一次判断是循环之外单独写的一行（`return predicate()`）。用假时钟钉住「循环一次都不进」
    // 的情形：超时给 0，只剩收尾判断。这条用例就是在守那一行——把它删掉，`waitFor` 会返回 undefined。
    let calls = 0
    const becameTrueLate = (): boolean => {
      calls += 1
      return calls >= 1
    }

    expect(await waitFor(becameTrueLate, 0, 1)).toBe(true)
    expect(calls).toBe(1)

    // 条件本身不成立时，收尾判断给的是 false——不能把「没等到」说成成功。
    expect(await waitFor(() => false, 0, 1)).toBe(false)
  })
})
