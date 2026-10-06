// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Settings } from '@common/schemas'
import { settingsKeys, useSettings, useSettingsActions, useSettingsError, useSettingsLoading } from '@/data/settings'
import { createQueryFixture } from '@/test-support'

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    id: 'singleton',
    listenHost: '127.0.0.1',
    listenPort: 9300,
    captureRequestLogs: true,
    requestLogRetentionDays: 0,
    captureRequestContent: true,
    contentRetentionDays: 7,
    cooldownBaseSeconds: 30,
    cooldownMaxSeconds: 300,
    consecutiveFailureThreshold: 3,
    idleTimeoutMilliseconds: 30_000,
    cacheAffinityEnabled: false,
    cacheAffinityTtlSeconds: 900,
    outboundProxyMode: 'system',
    outboundProxyUrl: '',
    outboundProxyBypass: 'localhost,127.0.0.1,::1',
    autoLaunch: false,
    language: 'system',
    routeMode: 'workflow',
    liveMetricTemplate: '',
    liveMetricMenuBarEnabled: true,
    liveMetricWindowEnabled: true,
    telemetryEnabled: true,
    telemetryEndpoint: '',
    cloudSyncProvider: 'github-gist',
    cloudSyncAccountLabel: '',
    cloudSyncTarget: '',
    cloudSyncLastPushedTime: 0,
    cloudSyncLastPulledTime: 0,
    updatedTime: 1,
    ...overrides,
  } as Settings
}

const state = vi.hoisted(() => ({ value: null as Settings | null, requests: 0 }))

vi.mock('@/api/runtime', () => ({
  settingsApi: {
    get: async () => {
      state.requests += 1
      return { success: true, data: state.value }
    },
  },
}))

beforeEach(() => {
  state.value = null
  state.requests = 0
})

describe('useSettings', () => {
  it('数据没到时是 null：调用方必须显式处理「还不知道」，而不是拿到一份假默认值', () => {
    const { wrapper } = createQueryFixture()
    expect(renderHook(() => useSettings(), { wrapper }).result.current).toBeNull()
  })

  it('拿到数据后原样给出', async () => {
    state.value = settings({ listenPort: 19400 })
    const { wrapper } = createQueryFixture()
    const { result } = renderHook(() => useSettings(), { wrapper })

    await waitFor(() => expect(result.current?.listenPort).toBe(19400))
  })

  it('加载态与错误态出自同一次查询', async () => {
    state.value = settings()
    const { wrapper } = createQueryFixture()
    const loading = renderHook(() => useSettingsLoading(), { wrapper })
    const error = renderHook(() => useSettingsError(), { wrapper })

    await waitFor(() => expect(loading.result.current).toBe(false))
    expect(error.result.current).toBeNull()
  })
})

describe('useSettingsActions', () => {
  it('refresh 重取设置', async () => {
    state.value = settings()
    const { client, wrapper } = createQueryFixture()
    const view = renderHook(() => useSettings(), { wrapper })
    await waitFor(() => expect(state.requests).toBe(1))

    const actions = renderHook(() => useSettingsActions(), { wrapper })
    await act(async () => actions.result.current.refresh())

    await waitFor(() => expect(state.requests).toBe(2))
    expect((client.getQueryData(settingsKeys.all) as Settings).id).toBe('singleton')
  })
})
