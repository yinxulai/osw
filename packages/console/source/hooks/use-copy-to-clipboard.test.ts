// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCopyToClipboard } from './use-copy-to-clipboard'

/*
 * 复制按钮的用户可见行为一共三条：真的写进了剪贴板、按钮亮 1.5 秒、写失败时有话说。
 *
 * 文案走真的 zh-CN 目录（`createAppTranslator('zh-CN')`），不是编一个字面量——
 * 否则「复制失败」这类提示改了词这里也不会响。
 */

const state = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: vi.fn(), success: state.success, error: state.error, info: vi.fn(), warning: vi.fn() }),
}))

vi.mock('@/i18n/provider', async () => {
  const { createAppTranslator } = await import('@common/i18n/catalogs')
  const t = createAppTranslator('zh-CN')
  return { useTranslation: () => t }
})

/** 1.5 秒的亮起时长，与实现里的 `FEEDBACK_DURATION` 对齐。 */
const FEEDBACK_DURATION = 1500

const writeText = vi.fn<(text: string) => Promise<void>>()

beforeEach(() => {
  vi.useFakeTimers()
  state.success.mockClear()
  state.error.mockClear()
  writeText.mockReset()
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useCopyToClipboard', () => {
  it('还没复制过时没有按钮处于已复制状态', () => {
    const { result } = renderHook(() => useCopyToClipboard())

    expect(result.current.copiedKey).toBeNull()
  })

  it('复制成功后把内容写进剪贴板、点亮对应按钮并给出提示', async () => {
    const { result } = renderHook(() => useCopyToClipboard())

    await act(() => result.current.copy('origin', 'http://127.0.0.1:19300'))

    expect(writeText).toHaveBeenCalledWith('http://127.0.0.1:19300')
    expect(result.current.copiedKey).toBe('origin')
    expect(state.success).toHaveBeenCalledWith('已复制到剪贴板')
    expect(state.error).not.toHaveBeenCalled()
  })

  it('1.5 秒后按钮回到未点亮状态', async () => {
    const { result } = renderHook(() => useCopyToClipboard())
    await act(() => result.current.copy('origin', 'http://127.0.0.1:19300'))

    act(() => {
      vi.advanceTimersByTime(FEEDBACK_DURATION - 1)
    })
    expect(result.current.copiedKey).toBe('origin')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.copiedKey).toBeNull()
  })

  it('同一页面上多个复制入口各自独立点亮', async () => {
    const { result } = renderHook(() => useCopyToClipboard())

    await act(() => result.current.copy('origin', 'http://127.0.0.1:19300'))
    await act(() => result.current.copy('apiKey', 'sk-test'))

    // key 是「最后一次复制」而不是「哪些复制过」：按了第二个入口，第一个就不再高亮。
    expect(result.current.copiedKey).toBe('apiKey')
  })

  it('连续复制会重置计时，而不是让第一次的计时提前熄灭', async () => {
    const { result } = renderHook(() => useCopyToClipboard())

    await act(() => result.current.copy('origin', 'a'))
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    await act(() => result.current.copy('apiKey', 'b'))

    // 第一次剩下的 500ms 早就该被取消；此刻仍然是「已复制」。
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(result.current.copiedKey).toBe('apiKey')

    act(() => {
      vi.advanceTimersByTime(FEEDBACK_DURATION - 600)
    })
    expect(result.current.copiedKey).toBeNull()
  })

  it('空内容直接忽略：不碰剪贴板也不弹提示', async () => {
    const { result } = renderHook(() => useCopyToClipboard())

    await act(() => result.current.copy('origin', ''))

    expect(writeText).not.toHaveBeenCalled()
    expect(result.current.copiedKey).toBeNull()
    expect(state.success).not.toHaveBeenCalled()
    expect(state.error).not.toHaveBeenCalled()
  })

  it('剪贴板拒绝时提示具体原因', async () => {
    writeText.mockRejectedValue(new Error('Document is not focused'))
    const { result } = renderHook(() => useCopyToClipboard())

    await act(() => result.current.copy('origin', 'http://127.0.0.1:19300'))

    expect(state.error).toHaveBeenCalledWith('Document is not focused')
    expect(state.success).not.toHaveBeenCalled()
    expect(result.current.copiedKey).toBeNull()
  })

  it('非 Error 的拒绝退回通用文案', async () => {
    writeText.mockRejectedValue('nope')
    const { result } = renderHook(() => useCopyToClipboard())

    await act(() => result.current.copy('origin', 'http://127.0.0.1:19300'))

    expect(state.error).toHaveBeenCalledWith('复制失败')
  })

  it('卸载后不留待触发的计时器', async () => {
    const { result, unmount } = renderHook(() => useCopyToClipboard())
    await act(() => result.current.copy('origin', 'a'))
    expect(result.current.copiedKey).toBe('origin')

    unmount()
    expect(vi.getTimerCount()).toBe(0)

    // 计时器已清掉，跑过原定时点也不会在已卸载的组件上 setState。
    act(() => {
      vi.advanceTimersByTime(FEEDBACK_DURATION)
    })
    expect(state.success).toHaveBeenCalledTimes(1)
  })
})
