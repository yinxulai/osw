// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryFixture } from '@/test-support'
import type { ProviderModelRoute } from '@common/schemas'
import { useModelManagement } from './use-model-management'
import { modelKeys } from './use-model-data'

/*
 * 模型页的所有「会改数据」的动作都从这里出去。
 *
 * 要钉住的是几类容易写错的地方：
 *  - 删除、批量删除都要**先问一句**，用户点「取消」时一个接口都不许发；
 *  - 批量操作是「部分成功也要如实说」，不能全成功才发现其实丢了一半；
 *  - 开关是乐观更新，失败要能回滚，而且失败时不能再补一句「已启用」。
 */

interface UpdateBody { enabled: boolean }

const state = vi.hoisted(() => ({
  success: vi.fn<(message: string) => void>(),
  error: vi.fn<(message: string) => void>(),
  confirm: vi.fn(async () => true),
  update: vi.fn<(id: string, body: UpdateBody) => Promise<unknown>>(),
  remove: vi.fn<(id: string) => Promise<unknown>>(),
  models: [] as ProviderModelRoute[],
  providers: [] as { id: string }[],
  selectedProviderId: 'prov_a' as string | null,
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

vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => state.confirm,
}))

vi.mock('@/i18n/provider', async () => {
  const { createAppTranslator } = await import('@common/i18n/catalogs')
  const t = createAppTranslator('zh-CN')
  return { useTranslation: () => t }
})

vi.mock('@/api/unwrap', () => ({ unwrap: async (promise: Promise<unknown>) => await promise }))

vi.mock('@/api/models', () => ({
  providerModelApi: {
    update: (id: string, body: UpdateBody) => state.update(id, body),
    remove: (id: string) => state.remove(id),
  },
}))

// 子 hook 各自有单测；这里只关心 `useModelManagement` 把它们拼起来的方式。
vi.mock('./use-model-data', async () => {
  const actual = await vi.importActual<typeof import('./use-model-data')>('./use-model-data')
  return {
    modelKeys: actual.modelKeys,
    useModelData: () => ({
      providers: state.providers,
      health: [],
      providersLoading: false,
      models: state.models,
      setModels: vi.fn(),
      selectedProviderId: state.selectedProviderId,
      setSelectedProviderId: vi.fn(),
      loading: false,
      loadModels: vi.fn(async () => true),
      reload: vi.fn(async () => undefined),
    }),
  }
})

vi.mock('./use-provider-dialog', () => ({
  useProviderDialog: () => ({ savingProvider: false, providers: [] }),
}))
vi.mock('./use-provider-management', () => ({
  useProviderManagement: () => ({ removeProvider: vi.fn(), updateProviderEnabled: vi.fn(), reorderProviders: vi.fn() }),
}))
vi.mock('./use-model-dialog', () => ({ useModelDialog: () => ({ savingModel: false }) }))
vi.mock('./use-provider-transfer', () => ({ useProviderTransfer: () => ({}) }))

function model(overrides: Partial<ProviderModelRoute> = {}): ProviderModelRoute {
  return {
    id: 'pm_1',
    providerId: 'prov_a',
    modelName: 'gpt-4o',
    endpoints: [],
    priority: 0,
    enabled: true,
    createdTime: 1,
    updatedTime: 1,
    deletedTime: null,
    ...overrides,
  }
}

beforeEach(() => {
  state.success.mockClear()
  state.error.mockClear()
  state.confirm.mockReset()
  state.confirm.mockResolvedValue(true)
  state.update.mockReset()
  state.update.mockResolvedValue({ id: 'pm_1', enabled: true })
  state.remove.mockReset()
  state.remove.mockResolvedValue({ id: 'pm_1' })
  state.providers = [{ id: 'prov_a' }, { id: 'prov_b' }]
  state.selectedProviderId = 'prov_a'
  state.models = [model()]
})

afterEach(() => vi.restoreAllMocks())

function setup() {
  const fixture = createQueryFixture()
  const view = renderHook(() => useModelManagement(), { wrapper: fixture.wrapper })
  fixture.client.setQueryData(modelKeys.all, state.models)
  return { ...view, client: fixture.client }
}

describe('选中供应商', () => {
  it('只列出当前供应商的模型，并按优先级排序', () => {
    state.models = [
      model({ id: 'pm_2', priority: 5 }),
      model({ id: 'pm_1', priority: 1 }),
      model({ id: 'pm_other', providerId: 'prov_b', priority: 0 }),
    ]

    const { result } = setup()

    expect(result.current.selectedProvider).toEqual({ id: 'prov_a' })
    expect(result.current.selectedModels.map(item => item.id)).toEqual(['pm_1', 'pm_2'])
  })

  it('没有选中供应商时没有当前供应商', () => {
    state.selectedProviderId = null

    const { result } = setup()

    expect(result.current.selectedProvider).toBeUndefined()
  })
})

describe('单个开关', () => {
  it('启用成功后有回执', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.updateModelEnabled(model(), true)
    })

    expect(state.update).toHaveBeenCalledWith('pm_1', { enabled: true })
    expect(state.success).toHaveBeenCalledWith('模型已启用')
  })

  it('停用成功后有回执', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.updateModelEnabled(model(), false)
    })

    expect(state.success).toHaveBeenCalledWith('模型已停用')
  })

  it('先乐观地把开关切过去，让界面不等接口', async () => {
    let release: (value: unknown) => void = () => undefined
    state.update.mockImplementation(() => new Promise(resolve => { release = resolve }))
    const { result, client } = setup()
    const before = client.getQueryData<ProviderModelRoute[]>(modelKeys.all)

    await act(async () => {
      void result.current.updateModelEnabled(model(), false)
      // `onMutate` 是异步的，等它把乐观值写进缓存再断言。
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(client.getQueryData<ProviderModelRoute[]>(modelKeys.all)?.[0].enabled).toBe(false)
    expect(before?.[0].enabled).toBe(true)

    await act(async () => {
      release({ id: 'pm_1', enabled: false })
    })
  })

  it('失败时回滚到改动前的样子，并且只报错、不报「已启用」', async () => {
    state.update.mockRejectedValue(new Error('供应商已停用'))
    const { result, client } = setup()

    await act(async () => {
      await result.current.updateModelEnabled(model(), false)
    })

    expect(client.getQueryData<ProviderModelRoute[]>(modelKeys.all)?.[0].enabled).toBe(true)
    expect(state.error).toHaveBeenCalledWith('供应商已停用')
    expect(state.success).not.toHaveBeenCalled()
  })
})

describe('删除单个模型', () => {
  it('先确认：标题里带模型名，说明里说清后果', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.removeModel(model())
    })

    expect(state.confirm).toHaveBeenCalledWith({
      title: '删除“gpt-4o”？',
      description: '该模型关联的所有协议接口都会被移除，此操作无法撤销。',
      confirmLabel: '删除模型',
      variant: 'destructive',
    })
  })

  it('用户点取消：一个接口都不发，也不弹提示', async () => {
    state.confirm.mockResolvedValue(false)
    const { result } = setup()

    await act(async () => {
      await result.current.removeModel(model())
    })

    expect(state.remove).not.toHaveBeenCalled()
    expect(state.success).not.toHaveBeenCalled()
    expect(state.error).not.toHaveBeenCalled()
  })

  it('确认后删除并回执', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.removeModel(model())
    })

    expect(state.remove).toHaveBeenCalledWith('pm_1')
    expect(state.success).toHaveBeenCalledWith('模型已删除')
  })

  it('删除失败时把服务端原因说出来', async () => {
    state.remove.mockRejectedValue(new Error('模型正在被逻辑模型引用'))
    const { result } = setup()

    await act(async () => {
      await result.current.removeModel(model())
    })

    expect(state.error).toHaveBeenCalledWith('模型正在被逻辑模型引用')
    expect(state.success).not.toHaveBeenCalled()
  })
})

describe('批量删除', () => {
  it('没有选中任何模型时不弹确认框', async () => {
    const { result } = setup()

    let outcome = true
    await act(async () => {
      outcome = await result.current.removeModels([])
    })

    expect(outcome).toBe(false)
    expect(state.confirm).not.toHaveBeenCalled()
  })

  it('全部删成功：提示删了几个', async () => {
    const { result } = setup()

    let outcome = false
    await act(async () => {
      outcome = await result.current.removeModels([model({ id: 'a' }), model({ id: 'b' })])
    })

    expect(outcome).toBe(true)
    expect(state.success).toHaveBeenCalledWith('已删除 2 个模型')
  })

  it('部分失败也要如实说成功几个、失败几个', async () => {
    state.remove.mockImplementation(async id => {
      if (id === 'b') throw new Error('boom')
      return { id }
    })
    const { result } = setup()

    await act(async () => {
      await result.current.removeModels([model({ id: 'a' }), model({ id: 'b' })])
    })

    expect(state.success).toHaveBeenCalledWith('已删除 1 个模型，1 个删除失败')
  })

  it('全部失败：报错并且不谎报成功', async () => {
    state.remove.mockRejectedValue(new Error('boom'))
    const { result } = setup()

    let outcome = true
    await act(async () => {
      outcome = await result.current.removeModels([model({ id: 'a' })])
    })

    expect(outcome).toBe(false)
    expect(state.error).toHaveBeenCalledWith('批量删除失败，请稍后重试')
    expect(state.success).not.toHaveBeenCalled()
  })

  it('用户点取消时返回 false 且不删任何东西', async () => {
    state.confirm.mockResolvedValue(false)
    const { result } = setup()

    let outcome = true
    await act(async () => {
      outcome = await result.current.removeModels([model({ id: 'a' })])
    })

    expect(outcome).toBe(false)
    expect(state.remove).not.toHaveBeenCalled()
  })
})

describe('批量停用', () => {
  it('选中的模型本来就全是停用的：直接说「已是停用状态」，不发接口', async () => {
    state.models = [model({ id: 'a', enabled: false })]
    const { result } = setup()

    let outcome = false
    await act(async () => {
      outcome = await result.current.disableModels(state.models)
    })

    expect(outcome).toBe(true)
    expect(state.success).toHaveBeenCalledWith('所选模型已是停用状态')
    expect(state.update).not.toHaveBeenCalled()
  })

  it('只对启用中的那几个发请求', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.disableModels([model({ id: 'a' }), model({ id: 'b', enabled: false })])
    })

    expect(state.update).toHaveBeenCalledTimes(1)
    expect(state.update).toHaveBeenCalledWith('a', { enabled: false })
    expect(state.success).toHaveBeenCalledWith('已禁用 1 个模型')
  })

  it('部分失败时分别报数', async () => {
    state.update.mockImplementation(async id => {
      if (id === 'b') throw new Error('boom')
      return { id, enabled: false }
    })
    const { result } = setup()

    await act(async () => {
      await result.current.disableModels([model({ id: 'a' }), model({ id: 'b' })])
    })

    expect(state.success).toHaveBeenCalledWith('已禁用 1 个模型，1 个失败')
  })

  it('全部失败时报错', async () => {
    state.update.mockRejectedValue(new Error('boom'))
    const { result } = setup()

    let outcome = true
    await act(async () => {
      outcome = await result.current.disableModels([model({ id: 'a' })])
    })

    expect(outcome).toBe(false)
    expect(state.error).toHaveBeenCalledWith('批量禁用失败，请稍后重试')
  })

  it('没选中任何模型时直接返回 false', async () => {
    const { result } = setup()

    let outcome = true
    await act(async () => {
      outcome = await result.current.disableModels([])
    })

    expect(outcome).toBe(false)
    expect(state.update).not.toHaveBeenCalled()
  })
})

describe('对外聚合的内容', () => {
  it('协议选项表随 hook 一起给出，页面不用另找一份', () => {
    const { result } = setup()

    expect(result.current.PROTOCOL_OPTIONS.length).toBeGreaterThan(0)
  })

  it('saving 只在两个对话框真正保存时为真', () => {
    const { result } = setup()

    expect(result.current.saving).toBe(false)
  })
})
