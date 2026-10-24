// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useScreenshotExport } from './use-screenshot-export'

/*
 * 官网截图导出。
 *
 * 这个按钮只在开发环境存在（`getPlatformCapabilities().screenshotExport` 缺席时整块退化），
 * 两条必须守住的行为：
 *  - 「进行中」不能重复点：导出会真的开一堆隐藏窗口，重复点会把机器拖死；
 *  - 结束（成功或失败）后必须把 exporting 与 progress 都清干净，否则界面会永远停在
 *    「正在导出 12/24」那一行。
 */

const state = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  capability: null as {
    exportAll: () => Promise<{ count: number; outputDirectory: string }>
    onProgress: (callback: (progress: { completed: number; total: number; current: string }) => void) => () => void
  } | null,
  unsubscribed: 0,
  pushedProgress: null as ((progress: { completed: number; total: number; current: string }) => void) | null,
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: vi.fn(), success: state.success, error: state.error, info: vi.fn(), warning: vi.fn() }),
}))

vi.mock('@/i18n/provider', async () => {
  const { createAppTranslator } = await import('@common/i18n/catalogs')
  const t = createAppTranslator('zh-CN')
  return { useTranslation: () => t }
})

vi.mock('@/platform/capabilities', () => ({
  getPlatformCapabilities: () => ({ screenshotExport: state.capability ?? undefined }),
}))

function installCapability(exportAll: ScreenshotExportAPI['exportAll']) {
  state.capability = {
    exportAll,
    onProgress: callback => {
      state.pushedProgress = callback
      return () => { state.unsubscribed += 1 }
    },
  }
}

beforeEach(() => {
  state.success.mockReset()
  state.error.mockReset()
  state.unsubscribed = 0
  state.pushedProgress = null
  installCapability(async () => ({ count: 24, outputDirectory: 'out/shots' }))
})

function setup() {
  return renderHook(() => useScreenshotExport())
}

describe('能力缺失（浏览器形态）', () => {
  it('没有导出能力时点击是无声的，不报错也不进进行中', async () => {
    state.capability = null
    const { result } = setup()

    await act(async () => {
      await result.current.exportScreenshots()
    })

    expect(result.current.exporting).toBe(false)
    expect(state.success).not.toHaveBeenCalled()
    expect(state.error).not.toHaveBeenCalled()
  })
})

describe('进度订阅', () => {
  it('挂载时订阅进度，卸载时退订（否则主进程会往已销毁的窗口发消息）', () => {
    const { unmount } = setup()

    expect(state.pushedProgress).not.toBeNull()

    unmount()

    expect(state.unsubscribed).toBe(1)
  })

  it('进度事件直接进状态，界面据此画「正在导出 12/24」', () => {
    const { result } = setup()

    act(() => {
      state.pushedProgress?.({ completed: 12, total: 24, current: 'zh-CN/dark/router' })
    })

    expect(result.current.progress).toEqual({ completed: 12, total: 24, current: 'zh-CN/dark/router' })
  })
})

describe('导出', () => {
  it('导出中先摆出「0/0」的进度，等第一条真实进度回来再对齐', async () => {
    let release: (value: { count: number; outputDirectory: string }) => void = () => undefined
    installCapability(() => new Promise(resolve => { release = resolve }))
    const { result } = setup()

    await act(async () => {
      void result.current.exportScreenshots()
      await Promise.resolve()
    })

    expect(result.current.exporting).toBe(true)
    expect(result.current.progress).toEqual({ completed: 0, total: 0, current: '' })

    await act(async () => {
      release({ count: 24, outputDirectory: 'out/shots' })
    })
    expect(result.current.exporting).toBe(false)
    expect(result.current.progress).toBeNull()
  })

  it('导出中再点一次不会又开一轮', async () => {
    const exportAll = vi.fn(() => new Promise<never>(() => undefined))
    installCapability(exportAll)
    const { result } = setup()

    await act(async () => {
      void result.current.exportScreenshots()
      await Promise.resolve()
    })
    await act(async () => {
      void result.current.exportScreenshots()
      await Promise.resolve()
    })

    expect(exportAll).toHaveBeenCalledTimes(1)
  })

  it('成功时把张数与输出目录一并告诉用户（否则他不知道图去哪了）', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.exportScreenshots()
    })

    expect(state.success).toHaveBeenCalledWith('已导出 24 张截图到 out/shots')
  })

  it('失败时说清原因，并同样把状态清干净', async () => {
    installCapability(async () => { throw new Error('browser window crashed') })
    const { result } = setup()

    await act(async () => {
      await result.current.exportScreenshots()
    })

    expect(state.error).toHaveBeenCalledWith('截图导出失败：browser window crashed')
    expect(result.current.exporting).toBe(false)
    expect(result.current.progress).toBeNull()
  })

  it('非 Error 的失败也不留 undefined 在提示里', async () => {
    installCapability(async () => { throw 'boom' })
    const { result } = setup()

    await act(async () => {
      await result.current.exportScreenshots()
    })

    expect(state.error).toHaveBeenCalledWith('截图导出失败：boom')
  })

  it('失败之后还能再点一次（没有把 exporting 卡死在 true）', async () => {
    let attempt = 0
    installCapability(async () => {
      attempt += 1
      if (attempt === 1) throw new Error('first attempt failed')
      return { count: 24, outputDirectory: 'out/shots' }
    })
    const { result } = setup()

    await act(async () => {
      await result.current.exportScreenshots()
    })
    await act(async () => {
      await result.current.exportScreenshots()
    })

    expect(state.success).toHaveBeenCalledWith('已导出 24 张截图到 out/shots')
  })
})
