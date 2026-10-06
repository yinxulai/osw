// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryFixture, provider } from '@/test-support'
import { useProviderManagement } from './use-provider-management'

/*
 * 供应商的删除 / 启停 / 排序。
 *
 * 三件事都有「本地已经乐观生效」的成分，所以断言要落在**哪一步是破坏性的**上：
 *
 *  - 删除必须先问一句，而且弹窗里要带上**供应商名字**——列表里同名不同家的供应商很多，
 *    只写「删除该供应商？」等于让用户闭着眼睛点确认；
 *  - 启停只有成功之后才提示，失败的提示用接口给的原因，且**不能**再补一句「已启用」；
 *  - 排序是拖拽后乐观生效的，失败要提示「已恢复服务端数据」——用户看到列表自己弹回去，
 *    必须有一句话解释发生了什么。
 */

const state = vi.hoisted(() => ({
  success: vi.fn<(message: string) => void>(),
  error: vi.fn<(message: string) => void>(),
  confirm: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(),
  reorder: vi.fn(),
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: vi.fn(), success: state.success, error: state.error, info: vi.fn(), warning: vi.fn() }),
}))

vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => state.confirm,
}))

vi.mock('@/i18n/provider', async () => {
  const { createAppTranslator } = await import('@common/i18n/catalogs')
  const t = createAppTranslator('zh-CN')
  return { useTranslation: () => t }
})

vi.mock('@/api/providers', () => ({
  providerApi: {
    remove: (id: string) => state.remove(id),
    update: (id: string, updates: unknown) => state.update(id, updates),
  },
}))

vi.mock('@/data/providers', () => ({
  useProvidersActions: () => ({ refresh: vi.fn(), reorder: state.reorder }),
}))

function ok(data: unknown = undefined) {
  return { success: true, data }
}

function setup() {
  const reload = vi.fn(async () => undefined)
  // 变更（useMutation）也要在 QueryClient 里跑：没有 provider 会直接抛错。
  const { wrapper } = createQueryFixture()
  const view = renderHook(() => useProviderManagement({ reload }), { wrapper })
  return { reload, result: view.result }
}

beforeEach(() => {
  state.success.mockReset()
  state.error.mockReset()
  state.confirm.mockReset()
  state.confirm.mockResolvedValue(true)
  state.remove.mockReset()
  state.remove.mockResolvedValue(ok({ id: 'prov_primary' }))
  state.update.mockReset()
  state.update.mockResolvedValue(ok(provider()))
  state.reorder.mockReset()
  state.reorder.mockResolvedValue(undefined)
})

describe('删除供应商', () => {
  it('先确认，弹窗带上名字，确认后才真删', async () => {
    const { result, reload } = setup()

    await act(async () => {
      await result.current.removeProvider(provider({ name: 'Primary' }))
    })

    expect(state.confirm).toHaveBeenCalledWith({
      title: '删除“Primary”？',
      description: '该供应商将被删除，关联模型会被禁用。',
      confirmLabel: '删除供应商',
      variant: 'destructive',
    })
    expect(state.remove).toHaveBeenCalledWith('prov_primary')
    expect(state.success).toHaveBeenCalledWith('供应商已删除')
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('取消时一个接口都不调、也不弹成功提示', async () => {
    state.confirm.mockResolvedValue(false)
    const { result, reload } = setup()

    await act(async () => {
      await result.current.removeProvider(provider())
    })

    expect(state.remove).not.toHaveBeenCalled()
    expect(state.success).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('删除失败时报出接口的原因，并且不提示「已删除」', async () => {
    state.remove.mockResolvedValue({ success: false, errorCode: 'PROVIDER_IN_USE', errorMessage: 'provider in use' })
    const { result, reload } = setup()

    await act(async () => {
      await result.current.removeProvider(provider())
    })

    expect(state.error).toHaveBeenCalledWith('provider in use')
    expect(state.success).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('启停供应商', () => {
  it('启用时写 enabled: true 并提示已启用', async () => {
    const { result, reload } = setup()

    await act(async () => {
      await result.current.updateProviderEnabled(provider({ id: 'prov_primary' }), true)
    })

    expect(state.update).toHaveBeenCalledWith('prov_primary', { enabled: true })
    expect(state.success).toHaveBeenCalledWith('供应商已启用')
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('停用时写 enabled: false 并提示已停用', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.updateProviderEnabled(provider(), false)
    })

    expect(state.update).toHaveBeenCalledWith('prov_primary', { enabled: false })
    expect(state.success).toHaveBeenCalledWith('供应商已停用')
  })

  it('失败时报错且不提示成功（界面不能出现「已启用」+「失败」两句矛盾提示）', async () => {
    state.update.mockResolvedValue({ success: false, errorCode: 'X', errorMessage: 'keyring locked' })
    const { result, reload } = setup()

    await act(async () => {
      await result.current.updateProviderEnabled(provider(), true)
    })

    expect(state.error).toHaveBeenCalledWith('keyring locked')
    expect(state.success).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('排序供应商', () => {
  it('成功时静静地交给数据层（拖拽已经乐观生效，成功不需要多一句提示）', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.reorderProviders(['prov_b', 'prov_a'])
    })

    expect(state.reorder).toHaveBeenCalledWith(['prov_b', 'prov_a'])
    expect(state.error).not.toHaveBeenCalled()
    expect(state.success).not.toHaveBeenCalled()
  })

  it('失败时提示「已恢复服务端数据」并带上原因（列表自己弹回去了，得解释一句）', async () => {
    state.reorder.mockRejectedValue(new Error('boom'))
    const { result } = setup()

    await act(async () => {
      await result.current.reorderProviders(['prov_b', 'prov_a'])
    })

    expect(state.error).toHaveBeenCalledWith('供应商顺序保存失败，已恢复服务端数据：boom')
  })

  it('抛出的不是 Error 时也 String 化，不能吞掉原因', async () => {
    state.reorder.mockRejectedValue('nope')
    const { result } = setup()

    await act(async () => {
      await result.current.reorderProviders(['prov_b'])
    })

    expect(state.error).toHaveBeenCalledWith('供应商顺序保存失败，已恢复服务端数据：nope')
  })
})
