// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryFixture } from '@/test-support'
import { storageKeys } from './use-storage-usage'
import { useRequestLogRetention } from './use-request-log-retention'

/*
 * 「按天数清理历史日志」。
 *
 * 这个动作会真删数据，所以它有两个必须守住的点：
 *  - 报数必须来自服务端的返回值（界面上的「已清理 N 条」不能是前端猜的）；
 *  - 删完要让**所有**受影响的数据失效：请求列表、统计、逻辑模型指标、以及磁盘占用读数。
 *    少失效一个，界面上就会出现「刚清完却还显示着旧数字」。
 */

const state = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  prune: vi.fn(),
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: vi.fn(), success: state.success, error: state.error, info: vi.fn(), warning: vi.fn() }),
}))

vi.mock('@/i18n/provider', async () => {
  const { createAppTranslator } = await import('@common/i18n/catalogs')
  const t = createAppTranslator('zh-CN')
  return { useTranslation: () => t }
})

vi.mock('@/api/observability', () => ({
  requestLogApi: { prune: (params: unknown) => state.prune(params) },
}))

const params = { requestLogRetentionDays: 7, contentRetentionDays: 3 }

beforeEach(() => {
  state.success.mockReset()
  state.error.mockReset()
  state.prune.mockReset()
  state.prune.mockResolvedValue({ success: true, data: { deletedLogs: 120, deletedContents: 45 } })
})

function setup() {
  const fixture = createQueryFixture()
  const view = renderHook(() => useRequestLogRetention(), { wrapper: fixture.wrapper })
  return { ...fixture, view }
}

describe('清理成功', () => {
  it('提交调用方给的天数', async () => {
    const { view } = setup()

    await act(async () => {
      await view.result.current.pruneLogs(params)
    })

    expect(state.prune).toHaveBeenCalledWith(params)
  })

  it('把服务端返回的删除条数原样交回给调用方', async () => {
    const { view } = setup()

    let result: unknown = null
    await act(async () => {
      result = await view.result.current.pruneLogs(params)
    })

    expect(result).toEqual({ deletedLogs: 120, deletedContents: 45 })
  })

  it('提示里带上两个数字，用户才知道这次到底删了什么', async () => {
    const { view } = setup()

    await act(async () => {
      await view.result.current.pruneLogs(params)
    })

    expect(state.success).toHaveBeenCalledWith('已清理 120 条请求日志、45 条正文')
  })

  it('删完就刷新所有受影响的数据，包括磁盘占用读数', async () => {
    const { client, view } = setup()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    await act(async () => {
      await view.result.current.pruneLogs(params)
    })

    const invalidated = invalidate.mock.calls.map(call => JSON.stringify(call[0]?.queryKey))
    expect(invalidated).toContain('["request-logs"]')
    expect(invalidated).toContain('["analytics"]')
    expect(invalidated).toContain('["logical-model-metrics"]')
    expect(invalidated).toContain(JSON.stringify(storageKeys.usage))
  })
})

describe('清理失败', () => {
  it('失败时把服务端的原因带进提示', async () => {
    state.prune.mockResolvedValue({ success: false, errorCode: 'X', errorMessage: 'database is locked' })
    const { view } = setup()

    await act(async () => {
      await view.result.current.pruneLogs(params)
    })

    expect(state.error).toHaveBeenCalledTimes(1)
    expect(String(state.error.mock.calls[0][0])).toContain('database is locked')
    expect(state.success).not.toHaveBeenCalled()
  })

  it('失败时返回 null，调用方据此决定要不要关弹窗', async () => {
    state.prune.mockResolvedValue({ success: false, errorCode: 'X', errorMessage: 'boom' })
    const { view } = setup()

    let result: unknown = 'not-null'
    await act(async () => {
      result = await view.result.current.pruneLogs(params)
    })

    expect(result).toBeNull()
  })
})
