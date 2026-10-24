// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogicalModelProviderModel, ProviderHealth, ProviderModelHealth } from '@common/schemas'
import { useLogicalModelMode } from './use-logical-model-mode'

/*
 * 逻辑模型的「自动 / 手动指定」模式。
 *
 * 三条要点：
 *  - 模式不是本地状态，而是从服务端的手动锁定读出来的（manualModelId 有值就是手动）；
 *  - 切到手动时必须**立刻锁定一个**模型，否则请求会被路由到空处——所以没有模型可锁时要拦住并说明；
 *  - 请求还没落定时再点一次不该重复提交。
 */

const state = vi.hoisted(() => ({
  error: vi.fn(),
  manualModelId: null as string | null,
  pending: false,
  switchTo: vi.fn(),
  refetch: vi.fn(),
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: vi.fn(), success: vi.fn(), error: state.error, info: vi.fn(), warning: vi.fn() }),
}))

vi.mock('@/i18n/provider', async () => {
  const { createAppTranslator } = await import('@common/i18n/catalogs')
  const t = createAppTranslator('zh-CN')
  return { useTranslation: () => t }
})

vi.mock('../queries', async () => {
  const actual = await vi.importActual<typeof import('../queries')>('../queries')
  return {
    EMPTY_LOGICAL_MODEL_REF: actual.EMPTY_LOGICAL_MODEL_REF,
    useLogicalModelModeQuery: () => ({ data: state.manualModelId === null ? undefined : { manualModelId: state.manualModelId }, refetch: state.refetch }),
    useSwitchManualModelMutation: () => ({ mutateAsync: state.switchTo, isPending: state.pending }),
  }
})

function model(id: string): LogicalModelProviderModel {
  return {
    id,
    providerId: 'prov_primary',
    modelName: `m-${id}`,
    endpoints: [],
    priority: 1,
    enabled: true,
    modelEnabled: true,
    createdTime: 1,
    updatedTime: 1,
    deletedTime: null,
  }
}

const MODELS = [model('pm_a'), model('pm_b')]

beforeEach(() => {
  state.error.mockReset()
  state.switchTo.mockReset()
  state.switchTo.mockResolvedValue(undefined)
  state.refetch.mockReset()
  state.manualModelId = null
  state.pending = false
})

interface SetupOptions {
  models?: LogicalModelProviderModel[]
  health?: Record<string, ProviderHealth>
  providerModelHealth?: Record<string, ProviderModelHealth>
}

function setup(options: SetupOptions = {}) {
  return renderHook(() => useLogicalModelMode(
    { id: 'lm_primary', modelId: 'gpt-5' },
    options.models ?? MODELS,
    options.health ?? {},
    options.providerModelHealth ?? {},
  ))
}

describe('模式来源', () => {
  it('服务端没给手动锁定时是自动模式', () => {
    const { result } = setup()

    expect(result.current.mode).toBe('auto')
    expect(result.current.manualModelId).toBeNull()
  })

  it('服务端给了手动锁定就是手动模式（模式是服务端状态，不是本地开关）', () => {
    state.manualModelId = 'pm_b'

    const { result } = setup()

    expect(result.current.mode).toBe('manual')
    expect(result.current.manualModelId).toBe('pm_b')
  })

  it('提交中就是「切换中」，界面据此禁用按钮', () => {
    state.pending = true

    const { result } = setup()

    expect(result.current.switchingMode).toBe(true)
  })

  it('refresh 直接透传查询的 refetch', () => {
    const { result } = setup()

    result.current.refresh()

    expect(state.refetch).toHaveBeenCalledTimes(1)
  })
})

describe('切换模式', () => {
  it('已经是手动模式时再点「手动指定」不重复提交（模式来自服务端，比较的是它）', async () => {
    state.manualModelId = 'pm_b'
    const { result } = setup()

    await act(async () => {
      await result.current.changeMode('manual')
    })

    expect(state.switchTo).not.toHaveBeenCalled()
  })

  it('从自动切到手动时默认锁第一个模型，避免锁到空处', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.changeMode('manual')
    })

    expect(state.switchTo).toHaveBeenCalledWith('pm_a')
  })

  it('切回自动时提交 null——解除锁定就是「传空」', async () => {
    state.manualModelId = 'pm_b'
    const { result } = setup()

    await act(async () => {
      await result.current.changeMode('auto')
    })

    expect(state.switchTo).toHaveBeenCalledWith(null)
  })

  it('没有模型可锁时拦住并说明原因，而不是提交一个空锁定', async () => {
    const { result } = setup({ models: [] })

    await act(async () => {
      await result.current.changeMode('manual')
    })

    expect(state.switchTo).not.toHaveBeenCalled()
    expect(state.error).toHaveBeenCalledWith('请先添加一个模型，再切换到手动指定模式')
  })

  it('点的是当前模式时不提交（按钮在两种模式下都存在）', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.changeMode('auto')
    })

    expect(state.switchTo).not.toHaveBeenCalled()
  })

  it('上一次还没落定时再点不予受理', async () => {
    state.pending = true
    const { result } = setup()

    await act(async () => {
      await result.current.changeMode('manual')
    })

    expect(state.switchTo).not.toHaveBeenCalled()
  })

  it('切换失败时把服务端的原因给用户', async () => {
    state.switchTo.mockRejectedValue(new Error('逻辑模型不存在'))
    const { result } = setup()

    await act(async () => {
      await result.current.changeMode('manual')
    })

    expect(state.error).toHaveBeenCalledWith('逻辑模型不存在')
  })
})

describe('手动指定具体模型', () => {
  it('手动模式下点某一行就锁到它', async () => {
    state.manualModelId = 'pm_a'
    const { result } = setup()

    await act(async () => {
      await result.current.selectManualModel(model('pm_b'))
    })

    expect(state.switchTo).toHaveBeenCalledWith('pm_b')
  })

  it('自动模式下点行不生效——锁定只属于手动模式', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.selectManualModel(model('pm_b'))
    })

    expect(state.switchTo).not.toHaveBeenCalled()
  })

  it('提交中不重复受理', async () => {
    state.manualModelId = 'pm_a'
    state.pending = true
    const { result } = setup()

    await act(async () => {
      await result.current.selectManualModel(model('pm_b'))
    })

    expect(state.switchTo).not.toHaveBeenCalled()
  })
})

describe('冷却判定', () => {
  const farFuture = Date.now() + 60_000
  const past = Date.now() - 60_000

  it('供应商级冷却也算冷却（调度是这么看的，界面不能更乐观）', () => {
    const { result } = setup({ health: { prov_primary: { providerId: 'prov_primary', consecutiveFailures: 1, cooldownUntilTime: farFuture, lastSuccessTime: null, lastFailureTime: null, updatedTime: 1 } } })

    expect(result.current.isCooling('prov_primary', 'pm_a')).toBe(true)
  })

  it('模型级冷却同样生效', () => {
    const { result } = setup({ providerModelHealth: { pm_a: { providerModelId: 'pm_a', consecutiveFailures: 1, cooldownUntilTime: farFuture, lastSuccessTime: null, lastFailureTime: null, updatedTime: 1 } } })

    expect(result.current.isCooling('prov_primary', 'pm_a')).toBe(true)
  })

  it('冷却已过期就不算', () => {
    const { result } = setup({ health: { prov_primary: { providerId: 'prov_primary', consecutiveFailures: 1, cooldownUntilTime: past, lastSuccessTime: null, lastFailureTime: null, updatedTime: 1 } } })

    expect(result.current.isCooling('prov_primary', 'pm_a')).toBe(false)
  })

  it('没有健康度数据时不算冷却', () => {
    const { result } = setup()

    expect(result.current.isCooling('prov_primary', 'pm_a')).toBe(false)
  })
})
