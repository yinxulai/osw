// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogicalModelProviderModel } from '@common/schemas'
import { createQueryFixture } from '@/test-support'
import type { LogicalModelKeysRef } from '../queries'

/*
 * 逻辑模型的绑定列表。
 *
 * 这个钩子做三件事，每件都有它的理由：
 *
 *  1. **投影**：只把界面要用的字段抄出来。多带字段传下去，等于默许页面去读那些
 *     界面上不该出现的内部列，哪天后端加一列就悄悄漏出去；
 *  2. **就地改写缓存**：拖动排序、开关绑定要立刻反映在界面上，不能等一次往返；
 *  3. **`loadModels` 返回「成功还是失败」**，因为调用方要靠它决定是否恢复服务端数据。
 *
 * 这里让 mock 走真正的 `useQuery`（只换 queryFn），是因为「投影」与「改写」读写的必须是
 * **同一份缓存**——否则测出来的就只是两个各自能跑的函数，而不是它们协同的样子。
 */

const state = vi.hoisted(() => ({
  data: undefined as LogicalModelProviderModel[] | undefined,
  failRefetch: false,
}))

vi.mock('../queries', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  const actual = await vi.importActual<typeof import('../queries')>('../queries')
  return {
    logicalModelKeys: actual.logicalModelKeys,
    useLogicalModelProviderModelsQuery: (ref: LogicalModelKeysRef | null) => useQuery({
      queryKey: actual.logicalModelKeys.models(ref?.id ?? ''),
      queryFn: async () => {
        if (state.failRefetch) throw new Error('upstream down')
        return state.data ?? []
      },
      enabled: ref !== null,
      refetchInterval: false,
    }),
  }
})

import { logicalModelKeys } from '../queries'
import { useLogicalModelProviderModels } from './use-logical-model-provider-models'

const REF = { id: 'lm_primary', modelId: 'gpt-5' }

/** 服务端返回的一行，字段比界面需要的多——投影就该把它们丢掉。 */
function rawModel(overrides: Partial<LogicalModelProviderModel> = {}): LogicalModelProviderModel {
  return {
    id: 'pm_a',
    providerId: 'prov_primary',
    modelName: 'gpt-5',
    endpoints: [],
    priority: 1,
    enabled: true,
    modelEnabled: true,
    createdTime: 1,
    updatedTime: 1,
    deletedTime: null,
    ...overrides,
  }
}

beforeEach(() => {
  state.data = undefined
  state.failRefetch = false
})

function setup(ref: typeof REF | null = REF) {
  const { client, wrapper } = createQueryFixture()
  const view = renderHook(() => useLogicalModelProviderModels(ref), { wrapper })
  return { client, ...view }
}

describe('投影', () => {
  it('端点只抄出界面要用的四个字段，内部的其它字段一律不带', async () => {
    state.data = [
      rawModel({
        endpoints: [
          {
            protocol: 'openai',
            endpointUrl: 'https://api.example.com/v1',
            customAuthHeader: 'x-key',
            protocolConversionEnabled: true,
            // 后端将来可能加的东西：不该出现在界面对象里
            secretReference: 'providers/x/secret',
          } as never,
        ],
      }),
    ]

    const { result } = setup()

    await waitFor(() => expect(result.current.models).toHaveLength(1))
    expect(result.current.models[0].endpoints).toEqual([
      { protocol: 'openai', endpointUrl: 'https://api.example.com/v1', customAuthHeader: 'x-key', protocolConversionEnabled: true },
    ])
  })

  it('模型本体的启用状态要原样带走', async () => {
    // 界面靠它区分「这个逻辑模型没启用它」与「模型在模型管理里被停用了」，后者不画成待命。
    state.data = [rawModel({ modelEnabled: false })]

    const { result } = setup()

    await waitFor(() => expect(result.current.models[0]?.modelEnabled).toBe(false))
  })

  it('没有数据时给空列表，不给 undefined', () => {
    const { result } = setup()

    expect(result.current.models).toEqual([])
  })
})

describe('加载态', () => {
  it('loading 直接跟着查询的 isPending 走', () => {
    state.data = [rawModel()]
    const { result } = setup()

    expect(result.current.loading).toBe(true)
  })
})

describe('重新加载', () => {
  it('loadModels 触发一次重新取数，成功时返回 true', async () => {
    state.data = [rawModel()]
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))

    let ok = false
    await act(async () => {
      ok = await result.current.loadModels()
    })

    expect(ok).toBe(true)
  })

  it('取数失败时返回 false，让调用方知道该恢复服务端数据', async () => {
    state.data = [rawModel()]
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))

    state.failRefetch = true
    let ok = true
    await act(async () => {
      ok = await result.current.loadModels()
    })

    expect(ok).toBe(false)
  })
})

describe('就地改写缓存', () => {
  it('updateModels 把新列表写进这个逻辑模型的缓存键', async () => {
    state.data = [rawModel({ id: 'pm_a' })]
    const { result, client } = setup()
    await waitFor(() => expect(result.current.models).toHaveLength(1))

    act(() => {
      result.current.updateModels(current => current.map(m => ({ ...m, priority: 9 })))
    })

    const cached = client.getQueryData<LogicalModelProviderModel[]>(logicalModelKeys.models('lm_primary'))
    expect(cached?.[0].priority).toBe(9)
  })

  it('缓存里还没有数据时从空列表开始算（不会因为 undefined 崩掉）', () => {
    const { result, client } = setup()

    act(() => {
      result.current.updateModels(current => [...current, rawModel({ id: 'pm_new' })])
    })

    const cached = client.getQueryData<LogicalModelProviderModel[]>(logicalModelKeys.models('lm_primary'))
    expect(cached?.map(m => m.id)).toEqual(['pm_new'])
  })

  it('改写之后界面立刻就能读到新值（不用等下一次往返）', async () => {
    state.data = [rawModel({ id: 'pm_a', enabled: true }), rawModel({ id: 'pm_b', enabled: true })]
    const { result } = setup()
    await waitFor(() => expect(result.current.models).toHaveLength(2))

    act(() => {
      result.current.updateEnabledModel('pm_b', false)
    })

    await waitFor(() => {
      expect(result.current.models.map(m => [m.id, m.enabled])).toEqual([['pm_a', true], ['pm_b', false]])
    })
  })

  it('只翻目标那一行，别的行原样不动', async () => {
    state.data = [rawModel({ id: 'pm_a', enabled: true }), rawModel({ id: 'pm_b', enabled: true })]
    const { result, client } = setup()
    await waitFor(() => expect(result.current.models).toHaveLength(2))

    act(() => {
      result.current.updateEnabledModel('pm_b', false)
    })

    const cached = client.getQueryData<LogicalModelProviderModel[]>(logicalModelKeys.models('lm_primary'))
    expect(cached?.map(m => [m.id, m.enabled])).toEqual([['pm_a', true], ['pm_b', false]])
  })
})

describe('未就绪', () => {
  it('逻辑模型还没拿到时用空串做缓存键（不会把别人的数据写串）', () => {
    const { result, client } = setup(null)

    act(() => {
      result.current.updateModels(current => [...current, rawModel({ id: 'pm_x' })])
    })

    expect(client.getQueryData(logicalModelKeys.models(''))).toBeDefined()
    expect(client.getQueryData(logicalModelKeys.models('lm_primary'))).toBeUndefined()
    void result
  })
})
