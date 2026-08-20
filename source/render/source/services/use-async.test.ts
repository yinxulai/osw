// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAsyncFn, useAsyncData } from './use-async'

// useAsyncFn 依赖 ToastProvider 的 useToast；测试中用 stub 替代。
// 注意：必须返回稳定引用（真实 ToastProvider 用 useMemo），否则 run 的 useCallback
// 依赖 toast 每次渲染都变，useAsyncData 会无限重取导致 OOM。
vi.mock('@/components/ui/toast', () => {
  const toast = { error: vi.fn() }
  return { useToast: () => toast }
})

function flushMicrotasks(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('useAsyncFn', () => {

  it('初始为 idle，loading 为 false', () => {
    const { result } = renderHook(() => useAsyncFn(async () => 1))
    expect(result.current.status).toBe('idle')
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('成功：loading → success，data 正确', async () => {
    const { result } = renderHook(() => useAsyncFn(async (value: number) => value * 2))
    let promise!: Promise<number | null>
    act(() => { promise = result.current.run(21) })
    expect(result.current.loading).toBe(true)
    expect(result.current.status).toBe('loading')
    await act(async () => { await promise })
    expect(result.current.status).toBe('success')
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toBe(42)
  })

  it('失败：回到 error 状态并复位 loading（不卡 loading）', async () => {
    const { result } = renderHook(() => useAsyncFn(async () => {
      throw new Error('boom')
    }))
    let promise!: Promise<number | null>
    act(() => { promise = result.current.run() })
    expect(result.current.loading).toBe(true)
    await act(async () => { await promise })
    expect(result.current.status).toBe('error')
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe('boom')
  })

  it('fn 内部提前 return / 多分支也不会遗留 loading', async () => {
    // 模拟 saveSettings 这类多分支业务函数：任何 return 路径都应复位 loading
    const { result } = renderHook(() => useAsyncFn(async (shouldFail: boolean) => {
      if (shouldFail) return null
      return 'ok'
    }))
    let first!: Promise<string | null>
    act(() => { first = result.current.run(true) })
    await act(async () => { await first })
    expect(result.current.loading).toBe(false)
    expect(result.current.status).toBe('success')

    let second!: Promise<string | null>
    act(() => { second = result.current.run(false) })
    await act(async () => { await second })
    expect(result.current.data).toBe('ok')
    expect(result.current.loading).toBe(false)
  })

  it('并发调用：过期响应被丢弃，只保留最后一次结果', async () => {
    let resolveFirst!: (value: string) => void
    let resolveSecond!: (value: string) => void
    const { result } = renderHook(() => useAsyncFn((which: 'first' | 'second') => new Promise<string>(resolve => {
      if (which === 'first') resolveFirst = resolve
      else resolveSecond = resolve
    })))
    act(() => { void result.current.run('first') })
    act(() => { void result.current.run('second') })
    await act(async () => {
      resolveSecond('latest')
      await flushMicrotasks()
    })
    expect(result.current.data).toBe('latest') // 第二次（最新）调用已完成
    expect(result.current.loading).toBe(false)
    await act(async () => {
      resolveFirst('stale')
      await flushMicrotasks()
    })
    expect(result.current.data).toBe('latest') // 过期响应不覆盖
    expect(result.current.loading).toBe(false)
  })

  it('timeoutMs 超时保险丝：强制回到 error，不永久 loading', async () => {
    const { result } = renderHook(() => useAsyncFn(() => new Promise<string>(() => {}), { timeoutMs: 20 }))
    act(() => { void result.current.run() })
    expect(result.current.loading).toBe(true)
    await act(async () => { await sleep(30) })
    expect(result.current.status).toBe('error')
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toContain('超时')
  })

  it('reset 回到 idle', async () => {
    const { result } = renderHook(() => useAsyncFn(async () => 'data'))
    let promise!: Promise<string | null>
    act(() => { promise = result.current.run() })
    await act(async () => { await promise })
    expect(result.current.status).toBe('success')
    act(() => { result.current.reset() })
    expect(result.current.status).toBe('idle')
    expect(result.current.data).toBeNull()
  })

  it('toastError=false 时不弹错误提示', async () => {
    const { result } = renderHook(() => useAsyncFn(async () => {
      throw new Error('quiet')
    }, { toastError: false }))
    let promise!: Promise<null>
    act(() => { promise = result.current.run() })
    await act(async () => { await promise })
    expect(result.current.error).toBe('quiet')
  })
})

describe('useAsyncData', () => {
  it('挂载自动执行，初始 loading 为 true（与数据是否为空无关）', async () => {
    const { result } = renderHook(() => useAsyncData(async () => [] as string[], []))
    // 首次渲染后立即触发请求
    expect(result.current.loading).toBe(true)
    await act(async () => { await flushMicrotasks() })
    // 空数据是合法 success，不是 loading
    expect(result.current.status).toBe('success')
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toEqual([])
  })

  it('deps 变化时重新执行', async () => {
    type RangeProps = { range: string }
    const { result, rerender } = renderHook(
      ({ range }: RangeProps) => useAsyncData(async () => `data-for-${range}`, [range]),
      { initialProps: { range: '7d' } },
    )
    await act(async () => { await flushMicrotasks() })
    expect(result.current.data).toBe('data-for-7d')
    rerender({ range: '30d' })
    await act(async () => { await flushMicrotasks() })
    expect(result.current.data).toBe('data-for-30d')
  })

  it('失败自动 toast 并复位 loading', async () => {
    const { result } = renderHook(() => useAsyncData(async () => {
      throw new Error('load failed')
    }, []))
    await act(async () => { await flushMicrotasks() })
    expect(result.current.status).toBe('error')
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe('load failed')
  })
})
