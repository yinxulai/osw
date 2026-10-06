// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { healthKeys } from '@/data/health'
import { logicalModelKeys } from '@/data/logical-models'
import { providerKeys } from '@/data/providers'
import { proxyKeys } from '@/data/proxy'
import { settingsKeys } from '@/data/settings'
import { createQueryFixture } from '@/test-support'
import { useRuntimeDataReload } from './use-runtime-data-reload'

/*
 * 「运行时数据全部重载」——保存设置之后、引导页完成之后都会调它。
 *
 * 这里用的是 `refetchQueries` 而不是 `invalidateQueries`，是刻意的：
 * 调用方下一步就要读到最新值，失效只是把数据标脏，读到旧值的话「保存后界面上还是旧的」
 * 这类 bug 就会复现。所以这条用例断言的就是「重新拉取」这件事本身。
 */

function setup() {
  const { client, wrapper } = createQueryFixture()
  const refetch = vi.spyOn(client, 'refetchQueries')
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const view = renderHook(() => useRuntimeDataReload(), { wrapper })
  return { view, refetch, invalidate }
}

describe('重载范围', () => {
  it('把五类运行时数据全部重新拉一遍', async () => {
    const { view, refetch } = setup()

    await view.result.current()

    const keys = refetch.mock.calls.map(call => JSON.stringify(call[0]?.queryKey))
    expect(keys).toEqual([
      JSON.stringify(settingsKeys.all),
      JSON.stringify(providerKeys.all),
      JSON.stringify(logicalModelKeys.all),
      JSON.stringify(healthKeys.all),
      JSON.stringify(proxyKeys.status),
    ])
  })

  it('用的是重新拉取而不是仅仅标脏（保存后必须立刻读到新值）', async () => {
    const { view, refetch, invalidate } = setup()

    await view.result.current()

    expect(refetch).toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('返回的函数可以直接 await（调用方按「落定后再继续」用它）', async () => {
    const { view } = setup()

    await expect(view.result.current()).resolves.toBeUndefined()
  })
})
