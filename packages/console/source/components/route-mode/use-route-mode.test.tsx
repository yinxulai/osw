// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { settingsKeys } from '@/data/settings'
import { openRouteModeDialog, useRouteMode, useRouteModeStore } from './use-route-mode'

/*
 * 当前生效的路由模式。
 *
 * 三条不变量：
 *   - 模式是**服务端事实**（`settings.routeMode`），设置没到之前按工作流渲染而不是闪空；
 *   - 切换只改这一项，不去碰另一份定义（切过去再切回来必须原样）——所以成功路径是
 *     「写回设置缓存」，不是「重新拉一遍所有东西」；
 *   - 「切换中」拦得住并发的第二次点击（页头和弹窗拿到的是同一个 switchMode）。
 */

const api = vi.hoisted(() => {
  const success = vi.fn()
  const error = vi.fn()
  return {
    get: vi.fn(),
    update: vi.fn(),
    success,
    error,
    toast: { toast: vi.fn(), success, error, info: vi.fn(), warning: vi.fn() },
  }
})

vi.mock('@/api/runtime', () => ({
  settingsApi: { get: api.get, update: api.update },
}))

// 真 `useToast` 的返回值是模块级常量（引用恒定），这里也必须照做：
// 每次调用都新建一个对象的话，`switchMode` 的 `useCallback` 依赖每渲染一次就变一次。
vi.mock('@/components/ui/toast', () => ({
  useToast: () => api.toast,
}))

function settings(routeMode: 'workflow' | 'rules') {
  return {
    id: 'settings',
    routeMode,
    language: 'zh-CN',
    themeMode: 'system',
    requestLogRetentionDays: 7,
    requestLogRetentionCount: 1000,
  }
}

let client: QueryClient

beforeEach(() => {
  api.get.mockReset()
  api.update.mockReset()
  api.success.mockReset()
  api.error.mockReset()
  api.get.mockResolvedValue({ success: true, data: settings('workflow') })
  api.update.mockResolvedValue({ success: true, data: settings('rules') })
  useRouteModeStore.setState({ dialogOpen: false, switching: false })
  window.localStorage.clear()
  useLanguageStore.setState({ preference: 'zh-CN' })
})

afterEach(() => {
  useRouteModeStore.setState({ dialogOpen: false, switching: false })
})

function setup() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(() => useRouteMode(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <I18nProvider>{children}</I18nProvider>
      </QueryClientProvider>
    ),
  })
}

describe('读取当前模式', () => {
  it('设置到达之前按工作流渲染（既有行为，不会闪错）', () => {
    const { result } = setup()

    expect(result.current.mode).toBe('workflow')
    expect(result.current.loading).toBe(true)
  })

  it('设置到达后读服务端给的值', async () => {
    api.get.mockResolvedValue({ success: true, data: settings('rules') })
    const { result } = setup()

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.mode).toBe('rules')
  })

  it('没有设置时退回工作流（模式永远是一个合法值，界面上不会出现空白开关）', async () => {
    api.get.mockResolvedValue({ success: true, data: undefined })
    const { result } = setup()

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.mode).toBe('workflow')
  })
})

describe('切换模式', () => {
  it('只把这一项设置写回服务端（不碰另一份定义）', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.switchMode('rules')
    })

    expect(api.update).toHaveBeenCalledWith({ routeMode: 'rules' })
  })

  it('成功后把新设置写进缓存（两个工作台共用同一份设置缓存，这里是唯一状态源）', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.switchMode('rules')
    })

    expect(client.getQueryData(settingsKeys.all)).toEqual(settings('rules'))
  })

  it('成功后给出「已切到规则模式」这类提示（用户必须知道现在生效的是哪一份）', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.switchMode('rules')
    })

    expect(api.success).toHaveBeenCalledTimes(1)
    expect(String(api.success.mock.calls[0][0])).toContain('规则')
  })

  it('切到当前已经生效的模式时直接返回成功，不发请求（避免无谓写库）', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))

    const changed = await act(async () => result.current.switchMode('workflow'))

    expect(changed).toBe(true)
    expect(api.update).not.toHaveBeenCalled()
  })

  it('失败时返回 false 并给出错误提示（调用方据此决定不收起弹窗）', async () => {
    api.update.mockResolvedValue({ success: false, errorCode: 'E', errorMessage: '写不进去' })
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))

    const changed = await act(async () => result.current.switchMode('rules'))

    expect(changed).toBe(false)
    expect(api.error).toHaveBeenCalledWith('写不进去')
  })

  it('切换中不让第二次提交通过（并发点两下只该写一次）', async () => {
    let resolveUpdate: (value: unknown) => void = () => undefined
    api.update.mockImplementation(() => new Promise(resolve => { resolveUpdate = resolve }))
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))

    let first: Promise<boolean> = Promise.resolve(false)
    act(() => {
      first = result.current.switchMode('rules')
    })
    await waitFor(() => expect(useRouteModeStore.getState().switching).toBe(true))

    const second = await result.current.switchMode('rules')
    expect(second).toBe(false)
    expect(api.update).toHaveBeenCalledTimes(1)

    resolveUpdate({ success: true, data: settings('rules') })
    await act(async () => {
      await first
    })
  })

  it('切换结束后标志位复位（失败也要复位，否则按钮永远锁死）', async () => {
    api.update.mockResolvedValue({ success: false, errorCode: 'E', errorMessage: '写不进去' })
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.switchMode('rules')
    })

    expect(useRouteModeStore.getState().switching).toBe(false)
  })
})

describe('弹窗状态放在模块级 store 里', () => {
  it('任何位置都能打开弹窗，不需要包 Provider（触发按钮与弹窗不在同一棵子树）', () => {
    // 触发按钮长在页头、弹窗挂在 App 上，props 传不过去。
    expect(useRouteModeStore.getState().dialogOpen).toBe(false)

    openRouteModeDialog()

    expect(useRouteModeStore.getState().dialogOpen).toBe(true)
  })
})
