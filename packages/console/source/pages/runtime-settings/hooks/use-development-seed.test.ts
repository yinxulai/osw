// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryFixture } from '@/test-support'
import { useDevelopmentSeed } from './use-development-seed'

/*
 * 「插入开发测试数据」。
 *
 * 它会往本机库里写东西，所以先确认后写入；结果分两种（真插入了 / 本来就有），
 * 提示必须区分开——否则用户点了两次会以为自己插了两份。两种情况都要重载数据。
 */

const state = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  confirm: vi.fn(),
  seed: vi.fn(),
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

vi.mock('@/api/tools', () => ({
  developmentApi: { seed: () => state.seed() },
}))

beforeEach(() => {
  state.success.mockReset()
  state.error.mockReset()
  state.confirm.mockReset()
  state.confirm.mockResolvedValue(true)
  state.seed.mockReset()
  state.seed.mockResolvedValue({ success: true, data: { inserted: true } })
})

function setup() {
  const reload = vi.fn(async () => undefined)
  const { wrapper } = createQueryFixture()
  const view = renderHook(() => useDevelopmentSeed(reload), { wrapper })
  return { view, reload }
}

describe('确认', () => {
  it('先问清楚要做什么，再写入', async () => {
    const { view } = setup()

    await act(async () => {
      await view.result.current.seedDevelopmentData()
    })

    expect(state.confirm).toHaveBeenCalledWith({
      title: '插入开发测试数据？',
      description: '将补充缺失的测试配置，已有配置不会被覆盖。',
      confirmLabel: '插入数据',
    })
    expect(state.seed).toHaveBeenCalledTimes(1)
  })

  it('取消时一个字节都不写入', async () => {
    state.confirm.mockResolvedValue(false)
    const { view } = setup()

    await act(async () => {
      await view.result.current.seedDevelopmentData()
    })

    expect(state.seed).not.toHaveBeenCalled()
    expect(state.success).not.toHaveBeenCalled()
    expect(state.error).not.toHaveBeenCalled()
  })
})

describe('结果提示', () => {
  it('真插入了就说「已插入」，并重载数据让界面看到新内容', async () => {
    const { view, reload } = setup()

    await act(async () => {
      await view.result.current.seedDevelopmentData()
    })

    expect(state.success).toHaveBeenCalledWith('测试数据已插入')
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('本来就有配置时说「已存在」——不能谎称又插了一遍', async () => {
    state.seed.mockResolvedValue({ success: true, data: { inserted: false } })
    const { view, reload } = setup()

    await act(async () => {
      await view.result.current.seedDevelopmentData()
    })

    expect(state.success).toHaveBeenCalledWith('测试数据已存在')
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('失败', () => {
  it('失败时把服务端的原因带进提示，也不重载', async () => {
    state.seed.mockResolvedValue({ success: false, errorCode: 'X', errorMessage: 'disk is full' })
    const { view, reload } = setup()

    await act(async () => {
      await view.result.current.seedDevelopmentData()
    })

    expect(state.error).toHaveBeenCalledWith('插入失败：disk is full')
    expect(state.success).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('失败后还能再点一次', async () => {
    state.seed
      .mockResolvedValueOnce({ success: false, errorCode: 'X', errorMessage: 'boom' })
      .mockResolvedValueOnce({ success: true, data: { inserted: true } })
    const { view } = setup()

    await act(async () => {
      await view.result.current.seedDevelopmentData()
    })
    await act(async () => {
      await view.result.current.seedDevelopmentData()
    })

    expect(state.confirm).toHaveBeenCalledTimes(2)
    expect(state.success).toHaveBeenCalledWith('测试数据已插入')
  })
})
