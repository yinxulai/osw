// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DragEndEvent } from '@dnd-kit/core'
import type { LogicalModelProviderModel } from '@common/schemas'
import { useLogicalModelInteractions } from './use-logical-model-interactions'

/*
 * 逻辑模型行的两个交互：复制接入地址、拖动排序。
 *
 * 排序这块是「乐观写入 + 服务端兜底」：本地先摆好（拖动必须立刻跟手），
 * 然后逐个上报优先级；只要有**任意一条**没保存成功，就必须整体回读服务端数据——
 * 半截成功的顺序比不动更糟，用户会以为存住了。
 */

const state = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: vi.fn(), success: state.success, error: state.error, info: vi.fn(), warning: vi.fn() }),
}))

vi.mock('@/i18n/provider', async () => {
  const { createAppTranslator } = await import('@common/i18n/catalogs')
  const t = createAppTranslator('zh-CN')
  return { useTranslation: () => t }
})

vi.mock('@/api/models', () => ({
  schedulingPolicyApi: { update: (input: unknown) => state.update(input) },
}))

const writeText = vi.fn<(text: string) => Promise<void>>()

function model(id: string, priority: number): LogicalModelProviderModel {
  return {
    id,
    providerId: 'prov_primary',
    modelName: `m-${id}`,
    endpoints: [],
    priority,
    enabled: true,
    modelEnabled: true,
    createdTime: 1,
    updatedTime: 1,
    deletedTime: null,
  }
}

const MODELS = [model('pm_a', 1), model('pm_b', 2), model('pm_c', 3)]

beforeEach(() => {
  vi.useFakeTimers()
  state.success.mockReset()
  state.error.mockReset()
  state.update.mockReset()
  state.update.mockResolvedValue({ success: true })
  writeText.mockReset()
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
})

afterEach(() => {
  vi.useRealTimers()
})

interface SetupOverrides { models?: LogicalModelProviderModel[]; proxyBaseUrl?: string }

function setup(overrides: SetupOverrides = {}) {
  const loadModels = vi.fn(async () => true)
  const updateModels = vi.fn()
  const view = renderHook(() => useLogicalModelInteractions(
    'lm_primary',
    overrides.models ?? MODELS,
    updateModels,
    loadModels,
    overrides.proxyBaseUrl ?? 'http://127.0.0.1:19300',
  ))
  return { view, loadModels, updateModels }
}

function drag(activeId: string, overId: string | null): DragEndEvent {
  return { active: { id: activeId }, over: overId === null ? null : { id: overId } } as unknown as DragEndEvent
}

describe('复制接入地址', () => {
  it('不传地址时复制面板上显示的接入地址', async () => {
    const { view } = setup()

    await act(async () => {
      await view.result.current.copyEndpoint()
    })

    expect(writeText).toHaveBeenCalledWith('http://127.0.0.1:19300')
    expect(view.result.current.copied).toBe(true)
  })

  it('传了地址就复制那一条（每一行复制自己的协议地址）', async () => {
    const { view } = setup()

    await act(async () => {
      await view.result.current.copyEndpoint('http://127.0.0.1:19300/v1/messages')
    })

    expect(writeText).toHaveBeenCalledWith('http://127.0.0.1:19300/v1/messages')
  })

  it('1.5 秒后收起「已复制」状态', async () => {
    const { view } = setup()
    await act(async () => {
      await view.result.current.copyEndpoint()
    })
    expect(view.result.current.copied).toBe(true)

    await act(async () => {
      vi.advanceTimersByTime(1499)
    })
    expect(view.result.current.copied).toBe(true)

    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(view.result.current.copied).toBe(false)
  })

  it('连续复制两次时重新计时，而不是被第一次的计时器提前收掉', async () => {
    const { view } = setup()
    await act(async () => {
      await view.result.current.copyEndpoint()
    })

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    await act(async () => {
      await view.result.current.copyEndpoint()
      vi.advanceTimersByTime(1000)
    })

    // 第一次的计时器若没被清掉，此刻已经到点并会把状态收回去。
    expect(view.result.current.copied).toBe(true)
  })

  it('卸载时清掉计时器，不在已卸载的组件上做状态更新', async () => {
    const { view } = setup()
    await act(async () => {
      await view.result.current.copyEndpoint()
    })

    view.unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('拖动排序', () => {
  it('放到空白处什么都不做', async () => {
    const { view, updateModels } = setup()

    await act(async () => {
      await view.result.current.handleDragEnd(drag('pm_a', null))
    })

    expect(updateModels).not.toHaveBeenCalled()
    expect(state.update).not.toHaveBeenCalled()
  })

  it('原地放下什么都不做（拖动常常会点中自己）', async () => {
    const { view, updateModels } = setup()

    await act(async () => {
      await view.result.current.handleDragEnd(drag('pm_a', 'pm_a'))
    })

    expect(updateModels).not.toHaveBeenCalled()
    expect(state.update).not.toHaveBeenCalled()
  })

  it('拖到列表里不存在的 id（例如已删掉的模型）时安静退出', async () => {
    const { view, updateModels } = setup()

    await act(async () => {
      await view.result.current.handleDragEnd(drag('pm_missing', 'pm_a'))
    })

    expect(updateModels).not.toHaveBeenCalled()
    expect(state.update).not.toHaveBeenCalled()
  })

  it('本地立刻换位，并按新顺序把优先级重写成 1..n', async () => {
    const { view, updateModels } = setup()

    await act(async () => {
      await view.result.current.handleDragEnd(drag('pm_c', 'pm_a'))
    })

    const next = updateModels.mock.calls[0][0](MODELS) as LogicalModelProviderModel[]
    expect(next.map(item => item.id)).toEqual(['pm_c', 'pm_a', 'pm_b'])
    expect(next.map(item => item.priority)).toEqual([1, 2, 3])

    expect(state.update).toHaveBeenCalledTimes(3)
    expect(state.update.mock.calls.map(call => call[0])).toEqual([
      { logicalModelId: 'lm_primary', providerModelId: 'pm_c', priority: 1 },
      { logicalModelId: 'lm_primary', providerModelId: 'pm_a', priority: 2 },
      { logicalModelId: 'lm_primary', providerModelId: 'pm_b', priority: 3 },
    ])
    expect(state.error).not.toHaveBeenCalled()
    expect(view.result.current.copied).toBe(false)
  })

  it('往上拖也按同样的规则重写优先级', async () => {
    const { view, updateModels } = setup()

    await act(async () => {
      await view.result.current.handleDragEnd(drag('pm_a', 'pm_c'))
    })

    const next = updateModels.mock.calls[0][0](MODELS) as LogicalModelProviderModel[]
    expect(next.map(item => item.id)).toEqual(['pm_b', 'pm_c', 'pm_a'])
    expect(next.map(item => item.priority)).toEqual([1, 2, 3])
  })

  it('任意一条没保存成功就整体回读服务端，并明确说清「已恢复」', async () => {
    state.update
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, errorCode: 'X', errorMessage: 'boom' })
      .mockResolvedValueOnce({ success: true })
    const { view, loadModels, updateModels } = setup()

    await act(async () => {
      await view.result.current.handleDragEnd(drag('pm_c', 'pm_a'))
    })

    // 半截成功的顺序比不动更糟：必须把服务端那份真正生效的顺序拉回来。
    expect(loadModels).toHaveBeenCalledTimes(1)
    expect(state.error).toHaveBeenCalledWith('逻辑模型顺序保存失败，已恢复服务端数据')
    // 本地乐观写入仍然发生过（汇总页据此立刻跟手），只是随后被回读覆盖。
    expect(updateModels).toHaveBeenCalledTimes(1)
  })

  it('全部成功时不回读，省掉一次多余的请求', async () => {
    const { view, loadModels } = setup()

    await act(async () => {
      await view.result.current.handleDragEnd(drag('pm_c', 'pm_a'))
    })

    expect(loadModels).not.toHaveBeenCalled()
  })
})
