// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogicalModelProviderModel, Provider, ProviderHealth, ProviderModelHealth } from '@common/schemas'
import { createQueryFixture } from '@/test-support'
import { useLogicalModelControl } from './use-logical-model-control'

/*
 * 逻辑模型详情页的总装配钩子：把「绑定列表 / 运行指标 / 服务开关 / 模式 / 行内交互」拼成一份
 * 页面直接消费的对象。
 *
 * 这个文件真正在测的是**边界约定**，而不是转发：
 *
 *  1. 还没拿到逻辑模型（`null`）时必须把 `null` 传下去，让下游查询关火，而不是拿空串去发请求；
 *  2. 「打开绑定」在模型本体被全局停用时必须直接拒绝——界面会把开关置灰，但别的入口
 *     还能调到这里，被停用的模型就算绑上了也不会被调度，允许它打开只会骗人；
 *  3. 开关的最终状态以服务端返回值为准；
 *  4. `reload()` 要等三份数据都落定才返回。
 */

const state = vi.hoisted(() => ({
  error: vi.fn(),
  updateProviderModel: vi.fn(),
  loadModels: vi.fn(),
  updateEnabledModel: vi.fn(),
  refreshMode: vi.fn(),
  refreshMetrics: vi.fn(),
  providers: [] as Provider[],
  health: {} as Record<string, ProviderHealth>,
  providerModelHealth: {} as Record<string, ProviderModelHealth>,
  models: [] as LogicalModelProviderModel[],
  modelMetrics: {} as Record<string, unknown>,
  summaryMetrics: undefined as unknown,
  proxyBaseUrl: '',
  manualModelId: null as string | null,
  mode: 'auto' as string,
  switchingMode: false,
  copied: false,
  /** 下游钩子收到的入参，用来断言「未就绪时传的是 null」。 */
  refSeenByBindings: undefined as unknown,
  refSeenByMode: undefined as unknown,
  modelsSeenByMode: undefined as unknown,
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: vi.fn(), success: vi.fn(), error: state.error, info: vi.fn(), warning: vi.fn() }),
}))

vi.mock('@/data/providers', () => ({ useProviders: () => state.providers }))

vi.mock('@/data/health', () => ({
  useHealth: () => ({ providers: state.health, providerModels: state.providerModelHealth }),
}))

vi.mock('../queries', async () => {
  const actual = await vi.importActual<typeof import('../queries')>('../queries')
  return {
    EMPTY_LOGICAL_MODEL_REF: actual.EMPTY_LOGICAL_MODEL_REF,
    useUpdateProviderModelMutation: () => ({ mutateAsync: state.updateProviderModel }),
  }
})

vi.mock('./use-logical-model-provider-models', () => ({
  useLogicalModelProviderModels: (ref: unknown) => {
    state.refSeenByBindings = ref
    return {
      models: state.models,
      loading: false,
      loadModels: state.loadModels,
      updateModels: vi.fn(),
      updateEnabledModel: state.updateEnabledModel,
    }
  },
}))

vi.mock('./use-logical-model-metrics', () => ({
  useLogicalModelMetrics: () => ({
    modelMetrics: state.modelMetrics,
    summaryMetrics: state.summaryMetrics,
    refresh: state.refreshMetrics,
  }),
}))

vi.mock('./use-proxy-toggle', () => ({
  useProxyToggle: () => ({
    proxyStatus: { running: true, host: '127.0.0.1', port: 19300 },
    proxyBaseUrl: state.proxyBaseUrl,
    toggleProxy: vi.fn(),
  }),
}))

vi.mock('./use-logical-model-mode', () => ({
  useLogicalModelMode: (ref: unknown, models: unknown) => {
    state.refSeenByMode = ref
    state.modelsSeenByMode = models
    return {
      manualModelId: state.manualModelId,
      mode: state.mode,
      switchingMode: state.switchingMode,
      refresh: state.refreshMode,
      changeMode: vi.fn(),
      selectManualModel: vi.fn(),
      isCooling: vi.fn(() => false),
    }
  },
}))

vi.mock('./use-logical-model-interactions', () => ({
  useLogicalModelInteractions: () => ({ copied: state.copied, copyEndpoint: vi.fn(), handleDragEnd: vi.fn() }),
}))

function model(overrides: Partial<LogicalModelProviderModel> = {}): LogicalModelProviderModel {
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

const REF = { id: 'lm_primary', modelId: 'gpt-5' }

beforeEach(() => {
  state.error.mockReset()
  state.updateProviderModel.mockReset()
  state.updateProviderModel.mockResolvedValue({ enabled: true })
  state.loadModels.mockReset()
  state.loadModels.mockResolvedValue(true)
  state.updateEnabledModel.mockReset()
  state.refreshMode.mockReset()
  state.refreshMode.mockResolvedValue(undefined)
  state.refreshMetrics.mockReset()
  state.refreshMetrics.mockResolvedValue(undefined)
  state.providers = []
  state.health = {}
  state.providerModelHealth = {}
  state.models = []
  state.modelMetrics = {}
  state.summaryMetrics = undefined
  state.proxyBaseUrl = ''
  state.manualModelId = null
  state.mode = 'auto'
  state.switchingMode = false
  state.copied = false
  state.refSeenByBindings = undefined
  state.refSeenByMode = undefined
  state.modelsSeenByMode = undefined
})

function setup(ref: typeof REF | null = REF) {
  const { wrapper } = createQueryFixture()
  const view = renderHook(() => useLogicalModelControl(ref), { wrapper })
  return { result: view.result, rerender: view.rerender }
}

describe('未就绪的空壳', () => {
  it('逻辑模型还没拿到时，下游收到的是 null（查询据此关火，不拿空串发请求）', () => {
    setup(null)

    expect(state.refSeenByBindings).toBeNull()
    expect(state.refSeenByMode).toBeNull()
  })

  it('未就绪时给出空集合与空指标，页面不用各写一遍兜底', () => {
    const { result } = setup(null)

    expect(result.current.models).toEqual([])
    expect(result.current.providers).toEqual({})
    expect(result.current.modelMetrics).toEqual({})
    expect(result.current.summaryMetrics).toBeUndefined()
  })

  it('就绪时把逻辑模型原样交给下游（数据记录 id 与模型 id 两个都要用）', () => {
    setup(REF)

    expect(state.refSeenByBindings).toEqual(REF)
    expect(state.refSeenByMode).toEqual(REF)
  })

  it('把绑定列表交给模式钩子（自动模式要按列表选一个锁）', () => {
    state.models = [model({ id: 'pm_a' }), model({ id: 'pm_b' })]
    setup()

    expect(state.modelsSeenByMode).toEqual([model({ id: 'pm_a' }), model({ id: 'pm_b' })])
  })
})

describe('供应商映射', () => {
  it('把供应商列表转成「id → 记录」的映射，方便按行取名字', () => {
    state.providers = [{ id: 'prov_a', name: 'A' } as Provider, { id: 'prov_b', name: 'B' } as Provider]

    const { result } = setup()

    expect(result.current.providers.prov_a.name).toBe('A')
    expect(result.current.providers.prov_b.name).toBe('B')
  })
})

describe('健康与指标透传', () => {
  it('健康数据按「供应商级 / 模型级」两份原样传出', () => {
    state.health = {
      prov_a: { providerId: 'prov_a', consecutiveFailures: 1, cooldownUntilTime: null, lastSuccessTime: null, lastFailureTime: null, updatedTime: 1 },
    }
    state.providerModelHealth = {
      pm_a: { providerModelId: 'pm_a', consecutiveFailures: 2, cooldownUntilTime: null, lastSuccessTime: null, lastFailureTime: null, updatedTime: 1 },
    }
    state.modelMetrics = { pm_a: { requestCount: 3 } }

    const { result } = setup()

    expect(result.current.health).toEqual(state.health)
    expect(result.current.providerModelHealth).toEqual(state.providerModelHealth)
    expect(result.current.modelMetrics).toEqual({ pm_a: { requestCount: 3 } })
  })

  it('服务开关、手动锁定、复制态、代理地址都从对应钩子取出', () => {
    state.proxyBaseUrl = 'http://127.0.0.1:19300/v1'
    state.manualModelId = 'pm_b'
    state.mode = 'manual'
    state.switchingMode = true
    state.copied = true

    const { result } = setup()

    expect(result.current.proxyStatus.running).toBe(true)
    expect(result.current.proxyBaseUrl).toBe('http://127.0.0.1:19300/v1')
    expect(result.current.manualModelId).toBe('pm_b')
    expect(result.current.mode).toBe('manual')
    expect(result.current.switchingMode).toBe(true)
    expect(result.current.copied).toBe(true)
  })
})

describe('启用 / 停用绑定', () => {
  it('打开绑定时把请求发给调度策略，并把界面上的开关同步过去', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.updateEnabled(model({ id: 'pm_a', modelEnabled: true }), true)
    })

    expect(state.updateProviderModel).toHaveBeenCalledWith({ id: 'pm_a', enabled: true })
    expect(state.updateEnabledModel).toHaveBeenCalledWith('pm_a', true)
  })

  it('模型本体被全局停用时拒绝打开绑定：绑了也不会被调度，开关不该亮着', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.updateEnabled(model({ id: 'pm_a', modelEnabled: false }), true)
    })

    expect(state.updateProviderModel).not.toHaveBeenCalled()
    expect(state.updateEnabledModel).not.toHaveBeenCalled()
  })

  it('模型本体被停用时仍然可以关闭绑定（关永远安全）', async () => {
    state.updateProviderModel.mockResolvedValue({ enabled: false })
    const { result } = setup()

    await act(async () => {
      await result.current.updateEnabled(model({ id: 'pm_a', modelEnabled: false }), false)
    })

    expect(state.updateProviderModel).toHaveBeenCalledWith({ id: 'pm_a', enabled: false })
  })

  it('界面以服务端返回的 enabled 为准，而不是我们请求的值', async () => {
    state.updateProviderModel.mockResolvedValue({ enabled: false })
    const { result } = setup()

    await act(async () => {
      await result.current.updateEnabled(model({ id: 'pm_a' }), true)
    })

    expect(state.updateEnabledModel).toHaveBeenCalledWith('pm_a', false)
  })

  it('接口失败时提示原因，且不动界面上的状态', async () => {
    state.updateProviderModel.mockRejectedValue(new Error('scheduling policy locked'))
    const { result } = setup()

    await act(async () => {
      await result.current.updateEnabled(model({ id: 'pm_a' }), true)
    })

    expect(state.error).toHaveBeenCalledWith('scheduling policy locked')
    expect(state.updateEnabledModel).not.toHaveBeenCalled()
  })

  it('非 Error 抛出时也要给出提示（String 化，别丢进虚空）', async () => {
    state.updateProviderModel.mockRejectedValue('nope')
    const { result } = setup()

    await act(async () => {
      await result.current.updateEnabled(model({ id: 'pm_a' }), true)
    })

    expect(state.error).toHaveBeenCalledWith('nope')
  })
})

describe('重新加载', () => {
  it('reload 要等绑定列表、模式、指标三份数据都落定', async () => {
    const order: string[] = []
    state.loadModels.mockImplementation(async () => { order.push('models'); return true })
    state.refreshMode.mockImplementation(async () => { order.push('mode') })
    state.refreshMetrics.mockImplementation(async () => { order.push('metrics') })
    const { result } = setup()

    await act(async () => {
      await result.current.reload()
    })

    expect(order.sort()).toEqual(['metrics', 'mode', 'models'])
  })
})
