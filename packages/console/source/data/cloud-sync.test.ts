// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CloudSyncConfigureRequest, CloudSyncPullResult, CloudSyncPushResult, CloudSyncStatus } from '@common/cloud-sync'
import { cloudSyncKeys, useCloudSyncActions, useCloudSyncLoading, useCloudSyncStatus } from '@/data/cloud-sync'
import { createQueryFixture } from '@/test-support'

/*
 * 云同步数据层盯的是「写回缓存的是哪一段」：
 * `push` / `pull` 的回包是 `{ status, pushed, pulled, … }`，进缓存的必须是内层的 `status`
 * ——存整包进去，`useCloudSyncStatus()` 就会把 `pushed` 当成状态字段读，界面显示成一串 undefined。
 */

function status(overrides: Partial<CloudSyncStatus> = {}): CloudSyncStatus {
  return {
    provider: 'github-gist',
    providers: [],
    credentialConfigured: false,
    accountLabel: '',
    target: '',
    targetUrl: '',
    lastPushedTime: 0,
    lastPulledTime: 0,
    ...overrides,
  }
}

const state = vi.hoisted(() => ({
  value: null as CloudSyncStatus | null,
  statusRequests: 0,
  configureRequests: 0,
  pushResult: null as CloudSyncPushResult | null,
  pullResult: null as CloudSyncPullResult | null,
  failConfigure: null as Error | null,
}))

vi.mock('@/api/cloud-sync', () => ({
  cloudSyncApi: {
    status: async () => {
      state.statusRequests += 1
      return { success: true, data: state.value }
    },
    configure: async () => {
      state.configureRequests += 1
      if (state.failConfigure) throw state.failConfigure
      return { success: true, data: state.value }
    },
    test: async () => ({ success: true, data: state.value }),
    push: async () => ({ success: true, data: state.pushResult }),
    pull: async () => ({ success: true, data: state.pullResult }),
  },
}))

beforeEach(() => {
  state.value = null
  state.statusRequests = 0
  state.configureRequests = 0
  state.pushResult = null
  state.pullResult = null
  state.failConfigure = null
})

describe('useCloudSyncStatus', () => {
  it('状态没到时是 null', () => {
    const { wrapper } = createQueryFixture()
    expect(renderHook(() => useCloudSyncStatus(), { wrapper }).result.current).toBeNull()
  })

  it('拿到状态后原样给出，连「连上了谁」一起', async () => {
    state.value = status({ credentialConfigured: true, accountLabel: 'yinxulai' })
    const { wrapper } = createQueryFixture()
    const { result } = renderHook(() => useCloudSyncStatus(), { wrapper })

    await waitFor(() => expect(result.current?.accountLabel).toBe('yinxulai'))
    expect(result.current?.credentialConfigured).toBe(true)
  })

  it('加载态出自同一次查询', async () => {
    state.value = status()
    const { wrapper } = createQueryFixture()
    const loading = renderHook(() => useCloudSyncLoading(), { wrapper })

    await waitFor(() => expect(loading.result.current).toBe(false))
  })
})

describe('useCloudSyncActions', () => {
  it('configure 成功后把回包状态写进缓存', async () => {
    state.value = status({ credentialConfigured: true, accountLabel: 'someone' })
    const { client, wrapper } = createQueryFixture()
    const actions = renderHook(() => useCloudSyncActions(), { wrapper })

    const input: CloudSyncConfigureRequest = { credential: 'ghp_x' }
    await act(async () => actions.result.current.configure.mutateAsync(input))

    expect(state.configureRequests).toBe(1)
    expect((client.getQueryData(cloudSyncKeys.status) as CloudSyncStatus).accountLabel).toBe('someone')
  })

  it('push 写进缓存的是内层 status，而不是整包结果', async () => {
    state.pushResult = {
      status: status({ target: 'gist_abc', targetUrl: 'https://gist.github.com/gist_abc', lastPushedTime: 1_700_000_000_000 }),
      pushed: { providers: 2, models: 5, logicalModels: 1, bindings: 6 },
      createdTarget: true,
    }
    const { client, wrapper } = createQueryFixture()
    const actions = renderHook(() => useCloudSyncActions(), { wrapper })

    await act(async () => actions.result.current.push.mutateAsync())

    const cached = client.getQueryData(cloudSyncKeys.status) as CloudSyncStatus & { pushed?: unknown }
    expect(cached.target).toBe('gist_abc')
    expect(cached.lastPushedTime).toBe(1_700_000_000_000)
    expect(cached.pushed).toBeUndefined()
  })

  it('pull 同样只把内层 status 写进缓存', async () => {
    state.pullResult = {
      status: status({ lastPulledTime: 1_700_000_001_000 }),
      pulled: { providers: 1, models: 1, logicalModels: 1, bindings: 1 },
      exportedAt: 1_699_999_999_000,
    }
    const { client, wrapper } = createQueryFixture()
    const actions = renderHook(() => useCloudSyncActions(), { wrapper })

    await act(async () => actions.result.current.pull.mutateAsync())

    const cached = client.getQueryData(cloudSyncKeys.status) as CloudSyncStatus & { pulled?: unknown }
    expect(cached.lastPulledTime).toBe(1_700_000_001_000)
    expect(cached.pulled).toBeUndefined()
  })

  it('每次动作都一并失效设置：令牌与远端句柄本身也是设置项', async () => {
    state.value = status({ accountLabel: 'someone' })
    const { wrapper } = createQueryFixture()
    // 状态查询先挂上：没有观察者的查询只会被标记，不会真的重取一次。
    const statusView = renderHook(() => useCloudSyncStatus(), { wrapper })
    await waitFor(() => expect(statusView.result.current?.accountLabel).toBe('someone'))
    expect(state.statusRequests).toBe(1)

    const actions = renderHook(() => useCloudSyncActions(), { wrapper })
    await act(async () => actions.result.current.test.mutateAsync())

    // 动作成功之后状态被强制刷新——上次同步时间与「连上了谁」都是服务端写回的，界面不能自己推。
    await waitFor(() => expect(state.statusRequests).toBe(2))
  })

  it('失败时不写缓存：onSuccess 不该在失败路径上跑', async () => {
    state.failConfigure = new Error('bad credential')
    const { client, wrapper } = createQueryFixture()
    const actions = renderHook(() => useCloudSyncActions(), { wrapper })

    await act(async () => {
      await expect(actions.result.current.configure.mutateAsync({ credential: 'bad' })).rejects.toThrow('bad credential')
    })

    expect(client.getQueryData(cloudSyncKeys.status)).toBeUndefined()
  })
})
