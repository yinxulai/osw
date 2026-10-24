// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProviderModelRoute } from '@common/schemas'
import { providerModelKeys, useDeletedProviderModelIds } from '@/data/provider-models'
import { createQueryFixture } from '@/test-support'

/*
 * 「这个模型已经被删了」的名单只有一个来源：连软删除行一起拉回来的那一份。
 * 它只读、单独缓存，不和编辑器里的 `['provider-models']` 共用——那一格放的是映射过的编辑器形状。
 */

function model(overrides: Partial<ProviderModelRoute> = {}): ProviderModelRoute {
  return {
    id: 'pm_primary',
    providerId: 'prov_primary',
    modelName: 'gpt-5',
    endpoints: [],
    priority: 1,
    enabled: true,
    createdTime: 1,
    updatedTime: 1,
    deletedTime: null,
    ...overrides,
  }
}

const state = vi.hoisted(() => ({
  models: [] as ProviderModelRoute[],
}))

vi.mock('@/api/models', () => ({
  providerModelApi: {
    listIncludingDeleted: async () => ({ success: true, data: state.models }),
  },
}))

beforeEach(() => {
  state.models = []
})

describe('useDeletedProviderModelIds', () => {
  it('只收软删除的 id', async () => {
    state.models = [
      model({ id: 'pm_live', deletedTime: null }),
      model({ id: 'pm_gone', deletedTime: 1_700_000 }),
    ]
    const { wrapper } = createQueryFixture()
    const { result } = renderHook(() => useDeletedProviderModelIds(), { wrapper })

    await waitFor(() => expect(result.current.size).toBe(1))
    expect(result.current.has('pm_gone')).toBe(true)
    expect(result.current.has('pm_live')).toBe(false)
  })

  it('数据没到时是空集合，不是 undefined', () => {
    const { wrapper } = createQueryFixture()
    expect(renderHook(() => useDeletedProviderModelIds(), { wrapper }).result.current.size).toBe(0)
  })

  it('用独立的缓存键，不挤占编辑器的模型列表', async () => {
    state.models = [model({ id: 'pm_gone', deletedTime: 1 })]
    const { client, wrapper } = createQueryFixture()
    renderHook(() => useDeletedProviderModelIds(), { wrapper })

    await waitFor(() => expect(client.getQueryData(providerModelKeys.withDeleted)).toHaveLength(1))
    expect(client.getQueryData(['provider-models'])).toBeUndefined()
  })
})
