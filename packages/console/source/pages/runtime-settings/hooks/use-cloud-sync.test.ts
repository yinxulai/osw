// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CloudBackupDescriptor, CloudBackupKind } from '@common/cloud-backup'
import type { CloudSyncStatus } from '@common/cloud-sync'
import { useCloudSync } from './use-cloud-sync'

/*
 * 云同步的动作编排。
 *
 * 三条用户可见的约定：
 *  - 「换方式 / 存凭据 / 绑位置」成功时**不弹提示**（行内描述行自己就变了），失败必须说；
 *  - 「备份 / 恢复」成功必须报数 —— 这两个按钮动了几百行数据，「没报错」不等于用户知道发生了什么；
 *  - 同一时刻只有一个动作在跑，且上一次的提示不会留着误导人。
 */

const state = vi.hoisted(() => ({
  status: null as CloudSyncStatus | null,
  loading: false,
  configure: vi.fn(),
  push: vi.fn(),
  pull: vi.fn(),
  descriptors: [] as CloudBackupDescriptor[],
}))

vi.mock('@/i18n/provider', async () => {
  const { createAppTranslator } = await import('@common/i18n/catalogs')
  const t = createAppTranslator('zh-CN')
  return { useTranslation: () => t }
})

vi.mock('@/data/cloud-sync', () => ({
  useCloudSyncStatus: () => state.status,
  useCloudSyncLoading: () => state.loading,
  useCloudSyncActions: () => ({
    configure: { mutateAsync: state.configure },
    test: { mutateAsync: vi.fn() },
    push: { mutateAsync: state.push },
    pull: { mutateAsync: state.pull },
  }),
}))

function descriptor(kind: CloudBackupKind): CloudBackupDescriptor {
  return { kind, label: kind, credentialLabel: '', targetLabel: '' } as CloudBackupDescriptor
}

function status(overrides: Partial<CloudSyncStatus> = {}): CloudSyncStatus {
  return {
    provider: 'github-gist',
    providers: [descriptor('github-gist'), descriptor('webdav')],
    credentialConfigured: false,
    accountLabel: '',
    target: '',
    targetUrl: '',
    lastPushedTime: 0,
    lastPulledTime: 0,
    ...overrides,
  }
}

beforeEach(() => {
  state.status = status()
  state.loading = false
  state.configure.mockReset()
  state.configure.mockResolvedValue(undefined)
  state.push.mockReset()
  state.push.mockResolvedValue({ pushed: { providers: 2, models: 5, logicalModels: 1, bindings: 6 }, status: status() })
  state.pull.mockReset()
  state.pull.mockResolvedValue({ pulled: { providers: 1, models: 3, logicalModels: 2 }, status: status() })
})

function setup() {
  return renderHook(() => useCloudSync())
}

describe('承载方式', () => {
  it('状态里的 provider 决定当前用哪个后端描述', () => {
    state.status = status({ provider: 'webdav' })

    const { result } = setup()

    expect(result.current.descriptor?.kind).toBe('webdav')
  })

  it('状态还没到时没有描述，也不会崩', () => {
    state.status = null

    const { result } = setup()

    expect(result.current.descriptor).toBeNull()
  })

  it('后端列表里没有当前 kind 时说明这是版本不匹配，返回 null 而不是随便挑一个', () => {
    state.status = status({ provider: 's3' as CloudBackupKind })

    const { result } = setup()

    expect(result.current.descriptor).toBeNull()
  })

  it('换同步方式只提交 provider 这一项', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.selectProvider('webdav')
    })

    expect(state.configure).toHaveBeenCalledWith({ provider: 'webdav' })
  })
})

describe('凭据与位置', () => {
  it('保存凭据提交 credential', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.saveCredential('ghp_abc')
    })

    expect(state.configure).toHaveBeenCalledWith({ credential: 'ghp_abc' })
  })

  it('「忘记凭据」提交的是空串——空串在这套接口里就是「清除」', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.clearCredential()
    })

    expect(state.configure).toHaveBeenCalledWith({ credential: '' })
  })

  it('绑定位置提交 target', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.bindTarget('gist_abc')
    })

    expect(state.configure).toHaveBeenCalledWith({ target: 'gist_abc' })
  })

  it('成功时返回 true，且**不弹**成功提示（行内已经变了）', async () => {
    const { result } = setup()

    let ok = false
    await act(async () => {
      ok = await result.current.saveCredential('ghp_abc')
    })

    expect(ok).toBe(true)
    expect(result.current.message).toBeNull()
    expect(result.current.errorMessage).toBeNull()
  })

  it('失败时返回 false 并把原因留在 errorMessage 上，调用方据此留住输入框内容', async () => {
    state.configure.mockRejectedValue(new Error('令牌无效'))
    const { result } = setup()

    let ok = true
    await act(async () => {
      ok = await result.current.saveCredential('bad')
    })

    expect(ok).toBe(false)
    expect(result.current.errorMessage).toBe('令牌无效')
    expect(result.current.busy).toBe(false)
  })

  it('失败原因不是 Error 时退回通用文案，不把 [object Object] 摆到界面上', async () => {
    state.configure.mockRejectedValue({ weird: true })
    const { result } = setup()

    await act(async () => {
      await result.current.saveCredential('bad')
    })

    expect(result.current.errorMessage).toBe('未知错误')
  })
})

describe('备份与恢复', () => {
  it('备份成功后按服务端返回的数量报数', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.push()
    })

    expect(result.current.message).toBe('已备份 2 个供应商、5 个模型、1 个逻辑模型')
    expect(result.current.errorMessage).toBeNull()
  })

  it('恢复成功后同样报数', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.pull()
    })

    expect(result.current.message).toBe('已恢复 1 个供应商、3 个模型、2 个逻辑模型')
  })

  it('备份失败时不留下上一次的成功回执', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.push()
    })
    expect(result.current.message).not.toBeNull()

    state.push.mockRejectedValue(new Error('网络不可达'))
    await act(async () => {
      await result.current.push()
    })

    expect(result.current.message).toBeNull()
    expect(result.current.errorMessage).toBe('网络不可达')
  })

  it('恢复失败时同理清掉上一次的回执', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.push()
    })

    state.pull.mockRejectedValue(new Error('快照已损坏'))
    await act(async () => {
      await result.current.pull()
    })

    expect(result.current.message).toBeNull()
    expect(result.current.errorMessage).toBe('快照已损坏')
  })

  it('开始一个新动作时立刻清掉上一次的错误', async () => {
    state.configure.mockRejectedValue(new Error('令牌无效'))
    const { result } = setup()
    await act(async () => {
      await result.current.saveCredential('bad')
    })
    expect(result.current.errorMessage).toBe('令牌无效')

    await act(async () => {
      await result.current.push()
    })

    expect(result.current.errorMessage).toBeNull()
  })
})

describe('忙碌状态', () => {
  it('空闲时 pending 为 null', () => {
    const { result } = setup()

    expect(result.current.pending).toBeNull()
    expect(result.current.busy).toBe(false)
  })

  it('备份进行中 pending 是 push，控件据此转圈', async () => {
    let release: (value: unknown) => void = () => undefined
    state.push.mockImplementation(() => new Promise(resolve => { release = resolve }))
    const { result } = setup()

    await act(async () => {
      void result.current.push()
      await Promise.resolve()
    })

    expect(result.current.pending).toBe('push')
    expect(result.current.busy).toBe(true)

    await act(async () => {
      release({ pushed: { providers: 0, models: 0, logicalModels: 0, bindings: 0 }, status: status() })
    })
    expect(result.current.pending).toBeNull()
  })

  it('换方式、存凭据、绑位置共用同一个 pending=configure', async () => {
    let release: (value: unknown) => void = () => undefined
    state.configure.mockImplementation(() => new Promise(resolve => { release = resolve }))
    const { result } = setup()

    await act(async () => {
      void result.current.bindTarget('gist_abc')
      await Promise.resolve()
    })

    expect(result.current.pending).toBe('configure')

    await act(async () => {
      release(undefined)
    })
  })

  it('失败也要把 pending 收回去，否则界面会一直转圈', async () => {
    state.push.mockRejectedValue(new Error('boom'))
    const { result } = setup()

    await act(async () => {
      await result.current.push()
    })

    expect(result.current.pending).toBeNull()
    expect(result.current.busy).toBe(false)
  })
})

describe('透传', () => {
  it('status 与 loading 直接来自数据层', () => {
    state.loading = true

    const { result } = setup()

    expect(result.current.status?.provider).toBe('github-gist')
    expect(result.current.loading).toBe(true)
  })
})
