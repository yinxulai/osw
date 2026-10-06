// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderModelRoute } from '@common/schemas'
import { createQueryFixture, provider, providerHealth, providerModelHealth } from '@/test-support'
import { useModelManagementUiStore } from '../store'
import { modelKeys, useModelData } from './use-model-data'

/*
 * 模型管理页的数据来源。
 *
 * 这里的重点是**投影**：接口回的是 `provider_models + provider_model_endpoints + protocol_converters`
 * 三张表拼出来的视图，界面要的是「一个模型一段协议地址」。投影错了不会报错，只会静默地把
 * 「没配地址」显示成一个能点的地址、或者把协议转换开关画反——前者会让用户以为能直接路由，
 * 后者会让请求被悄悄改写。所以每条投影规则都单独钉一遍：
 *
 *   - `url` 为 `null` → 空串（空串是「还没配」，不是缺字段）；
 *   - `customAuthHeader` 恒为 `null`：这一版界面上没有这个字段，投影不能凭空造一个；
 *   - `protocolConversionEnabled` 取「任一转换器开着」，只开一个也算开；
 *   - `priority` 恒为 0：模型管理页不管优先级，那是逻辑模型页的事；
 *   - `enabled` 是模型本体开关，要原样透传。
 */

const state = vi.hoisted(() => ({
  list: vi.fn(),
  providers: [] as unknown[],
  providersLoading: false,
  health: { providers: [] as unknown[], providerModels: [] as unknown[] },
  refreshProviders: vi.fn(),
  refreshHealth: vi.fn(),
}))

vi.mock('@/api/models', () => ({
  providerModelApi: { list: () => state.list() },
}))

vi.mock('@/data/providers', () => ({
  useProviders: () => state.providers,
  useProvidersLoading: () => state.providersLoading,
  useProvidersActions: () => ({ refresh: state.refreshProviders, reorder: vi.fn() }),
}))

vi.mock('@/data/health', () => ({
  useHealth: () => state.health,
  useHealthActions: () => ({ refresh: state.refreshHealth }),
}))

/** 一条 `provider-model/list` 原始行，`endpoints` 里挂转换器。 */
function rawModel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pm_a',
    providerId: 'prov_primary',
    modelName: 'gpt-5',
    enabled: true,
    createdTime: 1,
    updatedTime: 2,
    deletedTime: null,
    endpoints: [],
    ...overrides,
  }
}

function endpoint(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pme_a',
    providerModelId: 'pm_a',
    providerEndpointId: 'pe_a',
    url: 'https://api.example.com/v1',
    enabled: true,
    protocol: 'openai',
    createdTime: 1,
    updatedTime: 1,
    deletedTime: null,
    conversions: [],
    ...overrides,
  }
}

beforeEach(() => {
  state.list.mockReset()
  state.list.mockResolvedValue({ success: true, data: [rawModel()] })
  state.providers = []
  state.providersLoading = false
  state.health = { providers: [], providerModels: [] }
  state.refreshProviders.mockReset()
  state.refreshHealth.mockReset()
  useModelManagementUiStore.setState({ selectedProviderId: '' })
})

function setup() {
  const { client, wrapper } = createQueryFixture()
  const view = renderHook(() => useModelData(), { wrapper })
  return { client, view, result: view.result }
}

describe('端点投影', () => {
  it('url 为 null 时投影成空串（空串＝还没配地址，界面据此禁用路由）', async () => {
    state.list.mockResolvedValue({ success: true, data: [rawModel({ endpoints: [endpoint({ url: null })] })] })
    const { result } = setup()

    await waitFor(() => expect(result.current.models).toHaveLength(1))
    expect(result.current.models[0].endpoints[0].endpointUrl).toBe('')
  })

  it('customAuthHeader 恒为 null——这一版界面上没有这个字段，不能凭空造值', async () => {
    state.list.mockResolvedValue({ success: true, data: [rawModel({ endpoints: [endpoint()] })] })
    const { result } = setup()

    await waitFor(() => expect(result.current.models).toHaveLength(1))
    expect(result.current.models[0].endpoints[0].customAuthHeader).toBeNull()
  })

  it('只要有一个转换器开着就算开（取 some 而不是首个）', async () => {
    state.list.mockResolvedValue({
      success: true,
      data: [
        rawModel({
          endpoints: [
            endpoint({ conversions: [{ id: 'c1', clientProtocol: 'anthropic', enabled: false }, { id: 'c2', clientProtocol: 'gemini', enabled: true }] }),
          ],
        }),
      ],
    })
    const { result } = setup()

    await waitFor(() => expect(result.current.models).toHaveLength(1))
    expect(result.current.models[0].endpoints[0].protocolConversionEnabled).toBe(true)
  })

  it('转换器全关时投影成关', async () => {
    state.list.mockResolvedValue({
      success: true,
      data: [
        rawModel({
          endpoints: [endpoint({ conversions: [{ id: 'c1', clientProtocol: 'anthropic', enabled: false }] })],
        }),
      ],
    })
    const { result } = setup()

    await waitFor(() => expect(result.current.models).toHaveLength(1))
    expect(result.current.models[0].endpoints[0].protocolConversionEnabled).toBe(false)
  })

  it('providerId / modelName / enabled / 时间戳原样带过来', async () => {
    state.list.mockResolvedValue({
      success: true,
      data: [rawModel({ providerId: 'prov_other', modelName: 'claude-4', enabled: false, createdTime: 11, updatedTime: 22 })],
    })
    const { result } = setup()

    await waitFor(() => expect(result.current.models).toHaveLength(1))
    expect(result.current.models[0]).toMatchObject({
      id: 'pm_a',
      providerId: 'prov_other',
      modelName: 'claude-4',
      enabled: false,
      createdTime: 11,
      updatedTime: 22,
    })
  })

  it('priority 恒为 0——模型管理页不管优先级，那是逻辑模型页的字段', async () => {
    state.list.mockResolvedValue({ success: true, data: [rawModel()] })
    const { result } = setup()

    await waitFor(() => expect(result.current.models).toHaveLength(1))
    expect(result.current.models[0].priority).toBe(0)
  })
})

describe('空数据', () => {
  it('接口还没回来时 models 是一个稳定空数组（每次渲染新数组会让下游 memo 全失效）', async () => {
    state.list.mockImplementation(() => new Promise(() => undefined))
    const { view, result } = setup()

    const first = result.current.models
    expect(first).toEqual([])

    view.rerender()
    expect(result.current.models).toBe(first)
  })
})

describe('就地改写', () => {
  it('setModels 传函数时基于缓存里的当前值计算', async () => {
    state.list.mockResolvedValue({ success: true, data: [rawModel({ id: 'pm_a' }), rawModel({ id: 'pm_b' })] })
    const { client, result } = setup()
    await waitFor(() => expect(result.current.models).toHaveLength(2))

    act(() => {
      result.current.setModels(current => current.map(model => ({ ...model, enabled: false })))
    })

    expect(client.getQueryData<{ enabled: boolean }[]>(modelKeys.all)?.map(model => model.enabled)).toEqual([false, false])
  })

  it('setModels 传数组时整段替换', async () => {
    const { client, result } = setup()
    await waitFor(() => expect(result.current.models).toHaveLength(1))

    act(() => {
      result.current.setModels([{ ...(client.getQueryData<ProviderModelRoute[]>(modelKeys.all) ?? [])[0], modelName: 'renamed' }])
    })

    expect((client.getQueryData<{ modelName: string }[]>(modelKeys.all) ?? [])[0].modelName).toBe('renamed')
  })
})

describe('重新加载', () => {
  it('loadModels 成功时返回 true', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.models).toHaveLength(1))

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.loadModels()
    })

    expect(ok).toBe(true)
  })

  it('loadModels 失败时返回 false（不抛异常：页面要能自己决定画什么）', async () => {
    state.list.mockResolvedValue({ success: true, data: [rawModel()] })
    const { result } = setup()
    await waitFor(() => expect(result.current.models).toHaveLength(1))
    state.list.mockResolvedValue({ success: false, errorCode: 'X', errorMessage: 'boom' })

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.loadModels()
    })

    expect(ok).toBe(false)
  })

  it('reload 会连供应商与健康一起刷新，并且也重新取模型', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.models).toHaveLength(1))
    const before = state.list.mock.calls.length

    await act(async () => {
      await result.current.reload()
    })

    expect(state.refreshProviders).toHaveBeenCalledTimes(1)
    expect(state.refreshHealth).toHaveBeenCalledTimes(1)
    expect(state.list.mock.calls.length).toBeGreaterThan(before)
  })
})

describe('加载标记', () => {
  it('模型没回来时就是 loading', async () => {
    state.list.mockImplementation(() => new Promise(() => undefined))
    const { result } = setup()

    expect(result.current.loading).toBe(true)
  })

  it('模型回来了但供应商还在加载，仍然是 loading（页面不能只画半边）', async () => {
    state.providersLoading = true
    const { result } = setup()

    await waitFor(() => expect(result.current.models).toHaveLength(1))
    expect(result.current.loading).toBe(true)
  })
})

describe('供应商自动选中', () => {
  it('没选过时默认选中第一个供应商', async () => {
    state.providers = [provider({ id: 'prov_primary' }), provider({ id: 'prov_second' })]
    setup()

    await waitFor(() => expect(useModelManagementUiStore.getState().selectedProviderId).toBe('prov_primary'))
  })

  it('已经选过时不覆盖用户的选择', async () => {
    state.providers = [provider({ id: 'prov_primary' })]
    useModelManagementUiStore.setState({ selectedProviderId: 'prov_second' })
    setup()

    await waitFor(() => expect(state.providers).toHaveLength(1))
    expect(useModelManagementUiStore.getState().selectedProviderId).toBe('prov_second')
  })

  it('一个供应商都没有时保持空选中（不写空串以外的值）', async () => {
    state.providers = []
    setup()

    await waitFor(() => expect(state.list).toHaveBeenCalled())
    expect(useModelManagementUiStore.getState().selectedProviderId).toBe('')
  })
})

describe('透传', () => {
  it('health / providers 原样交给页面', async () => {
    state.health = { providers: [providerHealth()], providerModels: [providerModelHealth()] }
    state.providers = [provider()]
    state.providersLoading = false
    const { result } = setup()

    await waitFor(() => expect(result.current.providers).toHaveLength(1))
    expect(result.current.health.providers[0].providerId).toBe('prov_primary')
    expect(result.current.health.providerModels[0].providerModelId).toBe('pm_primary')
    expect(result.current.providersLoading).toBe(false)
  })

  it('setSelectedProviderId 直接写 store', async () => {
    const { result } = setup()
    await waitFor(() => expect(state.list).toHaveBeenCalled())

    act(() => {
      result.current.setSelectedProviderId('prov_primary')
    })

    expect(useModelManagementUiStore.getState().selectedProviderId).toBe('prov_primary')
  })
})
