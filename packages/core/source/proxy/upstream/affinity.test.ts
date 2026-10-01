import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const settingsStore = vi.hoisted(() => ({
  getSettings: vi.fn(),
}))

vi.mock('@server/database/settings-store', () => settingsStore)

import {
  clearAffinityStoreForTests,
  readAffinityBinding,
  recordAffinityProviderModelId,
  resolveAffinityProviderModelId,
  writeAffinityBinding,
} from './affinity'

const ENABLED = { cacheAffinityEnabled: true, cacheAffinityTtlSeconds: 900 }
const DISABLED = { cacheAffinityEnabled: false, cacheAffinityTtlSeconds: 900 }

beforeEach(() => {
  clearAffinityStoreForTests()
  settingsStore.getSettings.mockReset()
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000_000_000)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('写入与读取', () => {
  it('round-trips a binding within the TTL', async () => {
    writeAffinityBinding('default', 'sess_alpha', 'model_alpha', true, 900)

    expect(readAffinityBinding('default', 'sess_alpha', true)).toBe('model_alpha')
  })

  it('namespaces bindings by logical model', () => {
    writeAffinityBinding('default', 'sess_alpha', 'model_alpha', true, 900)
    writeAffinityBinding('landing', 'sess_alpha', 'model_beta', true, 900)

    // 同一个会话键在不同落点各自绑定：图给多个落点时互不串扰。
    expect(readAffinityBinding('default', 'sess_alpha', true)).toBe('model_alpha')
    expect(readAffinityBinding('landing', 'sess_alpha', true)).toBe('model_beta')
  })

  it('rebinding overwrites and refreshes the TTL', () => {
    writeAffinityBinding('default', 'sess_alpha', 'model_alpha', true, 900)
    vi.advanceTimersByTime(600_000)
    writeAffinityBinding('default', 'sess_alpha', 'model_beta', true, 900)
    // 改绑记的是「这次」的时间，不是最早那次：再过 600 秒仍然存活。
    vi.advanceTimersByTime(600_000)

    expect(readAffinityBinding('default', 'sess_alpha', true)).toBe('model_beta')
  })

  it('expires a binding after the TTL of the last success', () => {
    writeAffinityBinding('default', 'sess_alpha', 'model_alpha', true, 900)
    vi.advanceTimersByTime(899_999)
    expect(readAffinityBinding('default', 'sess_alpha', true)).toBe('model_alpha')
    vi.advanceTimersByTime(1_000)

    expect(readAffinityBinding('default', 'sess_alpha', true)).toBeNull()
  })

  it('ignores bindings written while disabled', () => {
    writeAffinityBinding('default', 'sess_alpha', 'model_alpha', false, 900)

    expect(readAffinityBinding('default', 'sess_alpha', true)).toBeNull()
  })

  it('reads nothing once disabled, even with a live binding', () => {
    writeAffinityBinding('default', 'sess_alpha', 'model_alpha', true, 900)

    expect(readAffinityBinding('default', 'sess_alpha', false)).toBeNull()
  })

  it('evicts the oldest entries past the defensive cap', () => {
    for (let index = 0; index < 1000; index += 1) {
      writeAffinityBinding('default', `sess_${index}`, `model_${index}`, true, 900)
    }
    // 超出上限一个，最早写入的那个被回收。
    writeAffinityBinding('default', 'sess_1000', 'model_1000', true, 900)

    expect(readAffinityBinding('default', 'sess_0', true)).toBeNull()
    expect(readAffinityBinding('default', 'sess_1', true)).toBe('model_1')
    expect(readAffinityBinding('default', 'sess_1000', true)).toBe('model_1000')
  })
})

describe('异步入口', () => {
  it('resolves through settings and records only when enabled', async () => {
    settingsStore.getSettings.mockResolvedValue(ENABLED)
    await recordAffinityProviderModelId('default', 'sess_alpha', 'model_alpha')

    expect(await resolveAffinityProviderModelId('default', 'sess_alpha')).toBe('model_alpha')
    expect(settingsStore.getSettings).toHaveBeenCalledTimes(2)
  })

  it('skips the store entirely when disabled', async () => {
    settingsStore.getSettings.mockResolvedValue(DISABLED)
    await recordAffinityProviderModelId('default', 'sess_alpha', 'model_alpha')

    expect(await resolveAffinityProviderModelId('default', 'sess_alpha')).toBeNull()
  })

  it('answers null without reading settings when there is no session key', async () => {
    settingsStore.getSettings.mockResolvedValue(ENABLED)

    expect(await resolveAffinityProviderModelId('default', null)).toBeNull()
    expect(settingsStore.getSettings).not.toHaveBeenCalled()
  })
})
