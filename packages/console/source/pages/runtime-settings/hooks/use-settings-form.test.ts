// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryFixture } from '@/test-support'
import type { Settings } from '@common/schemas'
import { useRuntimeSettingsUiStore } from '../store'
import { useSettingsForm } from './use-settings-form'

/*
 * 运行设置页的保存流程。这里最容易出错的不是「调没调接口」，而是三件围绕「脏」的事情：
 *
 *  1. 没有任何改动时**不该**发请求（否则每次进页面都会写一遍库、重启一遍代理）；
 *  2. 只有监听地址/端口变了才需要重启代理 —— 重启是有中断代价的；
 *  3. 重启失败要把真正的原因带出来，并且不能把保存说成成功。
 */

const state = vi.hoisted(() => ({
  success: vi.fn<(message: string) => void>(),
  error: vi.fn<(message: string) => void>(),
  updateApi: vi.fn(),
  restart: vi.fn(),
  globalSettings: null as Settings | null,
  proxyStatus: null as { host: string; port: number; running: boolean } | null,
  proxyRestart: { success: true, errorMessage: '' } as { success: boolean; errorMessage: string },
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
    success: state.success,
    error: state.error,
    info: vi.fn(),
    warning: vi.fn(),
  }),
}))

vi.mock('@/i18n/provider', async () => {
  const { createAppTranslator } = await import('@common/i18n/catalogs')
  const t = createAppTranslator('zh-CN')
  return { useTranslation: () => t }
})

vi.mock('@/api/unwrap', () => ({ unwrap: async (promise: Promise<unknown>) => await promise }))

vi.mock('@/api/runtime', () => ({
  settingsApi: { update: (input: unknown) => state.updateApi(input) },
}))

vi.mock('@/data/settings', async () => {
  const actual = await vi.importActual<typeof import('@/data/settings')>('@/data/settings')
  return {
    settingsKeys: actual.settingsKeys,
    useSettings: () => state.globalSettings,
    useSettingsLoading: () => false,
  }
})

vi.mock('@/data/proxy', () => ({
  useProxyStatus: () => state.proxyStatus,
  useProxyActions: () => ({ restart: state.restart }),
}))

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    listenHost: '127.0.0.1',
    listenPort: 19300,
    captureRequestLogs: true,
    requestLogRetentionDays: 7,
    captureRequestContent: false,
    contentRetentionDays: 1,
    cooldownBaseSeconds: 30,
    cooldownMaxSeconds: 300,
    consecutiveFailureThreshold: 3,
    idleTimeoutMilliseconds: 60_000,
    cacheAffinityEnabled: false,
    cacheAffinityTtlSeconds: 600,
    outboundProxyMode: 'system',
    outboundProxyUrl: '',
    outboundProxyBypass: '',
    autoLaunch: false,
    language: 'zh-CN',
    liveMetricTemplate: '',
    liveMetricMenuBarEnabled: false,
    liveMetricWindowEnabled: false,
    telemetryEnabled: false,
    telemetryEndpoint: '',
    ...overrides,
  } as Settings
}

beforeEach(() => {
  state.success.mockClear()
  state.error.mockClear()
  state.updateApi.mockReset()
  state.restart.mockReset()
  state.restart.mockResolvedValue({ success: true, errorMessage: '' })
  state.globalSettings = settings()
  state.proxyStatus = { host: '127.0.0.1', port: 19300, running: true }
  state.updateApi.mockImplementation(async (input: Partial<Settings>) => settings(input))
  useRuntimeSettingsUiStore.setState({ draft: null, baseline: null, saved: false, isDirty: false })
})

afterEach(() => vi.restoreAllMocks())

function setup() {
  const fixture = createQueryFixture()
  const view = renderHook(() => useSettingsForm(), { wrapper: fixture.wrapper })
  return { ...view, client: fixture.client }
}

describe('初始化', () => {
  it('服务端设置一到，表单就用它填草稿', async () => {
    const { result } = setup()

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.settings?.listenPort).toBe(19300)
    expect(result.current.isDirty).toBe(false)
  })

  it('保存中标记只在请求飞行期间为真', async () => {
    const { result } = setup()
    await act(async () => {
      await Promise.resolve()
    })
    act(() => {
      result.current.updateField('listenPort', 19400)
    })

    let release: (value: unknown) => void = () => undefined
    state.updateApi.mockImplementation(() => new Promise(resolve => { release = resolve }))
    await act(async () => {
      void result.current.saveSettings()
    })

    await waitFor(() => expect(result.current.saving).toBe(true))
    expect(state.updateApi).toHaveBeenCalledTimes(1)
    await act(async () => {
      release(settings({ listenPort: 19400 }))
    })
    await waitFor(() => expect(result.current.saving).toBe(false))
  })
})

describe('没有改动就不保存', () => {
  it('草稿与基线一致时点保存不发请求', async () => {
    const { result } = setup()
    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      await result.current.saveSettings()
    })

    expect(state.updateApi).not.toHaveBeenCalled()
    expect(state.success).not.toHaveBeenCalled()
  })

  it('改回来之后又变成「不脏」，保存同样不发请求', async () => {
    const { result } = setup()
    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      result.current.updateField('listenPort', 19400)
    })
    act(() => {
      result.current.updateField('listenPort', 19300)
    })

    await act(async () => {
      await result.current.saveSettings()
    })

    expect(state.updateApi).not.toHaveBeenCalled()
  })
})

describe('保存', () => {
  it('改动后保存：提示成功、草稿变成新的基线', async () => {
    const { result } = setup()
    await act(async () => {
      await Promise.resolve()
    })
    act(() => {
      result.current.updateField('cooldownBaseSeconds', 45)
    })

    await act(async () => {
      await result.current.saveSettings()
    })

    expect(state.updateApi).toHaveBeenCalledWith(expect.objectContaining({ cooldownBaseSeconds: 45 }))
    expect(state.success).toHaveBeenCalledWith('设置已保存')
    expect(result.current.isDirty).toBe(false)
    expect(result.current.saved).toBe(true)
  })

  it('保存成功后短暂显示「已保存」，随后自己收回', async () => {
    vi.useFakeTimers()
    try {
      const { result } = setup()
      await act(async () => {
        await Promise.resolve()
      })
      act(() => {
        result.current.updateField('listenPort', 19400)
      })
      await act(async () => {
        await result.current.saveSettings()
      })

      expect(result.current.saved).toBe(true)
      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(result.current.saved).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('只改了日志相关设置时不重启代理', async () => {
    const { result } = setup()
    await act(async () => {
      await Promise.resolve()
    })
    act(() => {
      result.current.updateField('requestLogRetentionDays', 30)
    })

    await act(async () => {
      await result.current.saveSettings()
    })

    expect(state.restart).not.toHaveBeenCalled()
  })

  it('改了监听端口就重启代理', async () => {
    const { result } = setup()
    await act(async () => {
      await Promise.resolve()
    })
    act(() => {
      result.current.updateField('listenPort', 19400)
    })

    await act(async () => {
      await result.current.saveSettings()
    })

    expect(state.restart).toHaveBeenCalledTimes(1)
    expect(state.success).toHaveBeenCalledWith('设置已保存')
  })

  it('改了监听地址也重启代理', async () => {
    const { result } = setup()
    await act(async () => {
      await Promise.resolve()
    })
    act(() => {
      result.current.updateField('listenHost', '0.0.0.0')
    })

    await act(async () => {
      await result.current.saveSettings()
    })

    expect(state.restart).toHaveBeenCalledTimes(1)
  })

  it('接口原样返回的监听地址与端口决定要不要重启（而不是草稿）', async () => {
    // 服务端可能把端口归一到别的值，此时以服务端的结果为准。
    state.updateApi.mockImplementation(async (input: Partial<Settings>) => settings({ ...input, listenPort: 19999 }))
    const { result } = setup()
    await act(async () => {
      await Promise.resolve()
    })
    act(() => {
      result.current.updateField('cooldownBaseSeconds', 45)
    })

    await act(async () => {
      await result.current.saveSettings()
    })

    expect(state.restart).toHaveBeenCalledTimes(1)
  })

  it('重启失败：提示里带出服务端说的原因，并且不说保存成功', async () => {
    state.restart.mockResolvedValue({ success: false, errorMessage: '端口被占用' })
    const { result } = setup()
    await act(async () => {
      await Promise.resolve()
    })
    act(() => {
      result.current.updateField('listenPort', 19400)
    })

    await act(async () => {
      await result.current.saveSettings()
    })

    expect(state.error).toHaveBeenCalledWith('设置已保存，但代理重启失败：端口被占用')
    expect(state.success).not.toHaveBeenCalled()
    expect(result.current.saved).toBe(false)
  })

  it('保存接口本身失败：把服务端的原始错误说出来', async () => {
    state.updateApi.mockRejectedValue(new Error('端口范围非法'))
    const { result } = setup()
    await act(async () => {
      await Promise.resolve()
    })
    act(() => {
      result.current.updateField('listenPort', 99999)
    })

    await act(async () => {
      await result.current.saveSettings()
    })

    expect(state.error).toHaveBeenCalledWith('端口范围非法')
    expect(state.success).not.toHaveBeenCalled()
  })

  it('保存失败后这个改动仍然是「未保存」', async () => {
    state.updateApi.mockRejectedValue(new Error('boom'))
    const { result } = setup()
    await act(async () => {
      await Promise.resolve()
    })
    act(() => {
      result.current.updateField('listenPort', 19400)
    })

    await act(async () => {
      await result.current.saveSettings()
    })

    expect(result.current.isDirty).toBe(true)
  })
})

describe('放弃改动', () => {
  it('resetSettings 把草稿退回上次保存的值', async () => {
    const { result } = setup()
    await act(async () => {
      await Promise.resolve()
    })
    act(() => {
      result.current.updateField('listenPort', 19400)
    })
    expect(result.current.isDirty).toBe(true)

    act(() => {
      result.current.resetSettings()
    })

    expect(result.current.settings?.listenPort).toBe(19300)
    expect(result.current.isDirty).toBe(false)
  })
})
