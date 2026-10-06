// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryFixture } from '@/test-support'
import { storageKeys, useStorageUsage } from './use-storage-usage'

/*
 * 设置页里的「观测库占用」读数。
 *
 * 这是一个**只读的读数**，不是业务状态：拿不到就返回 `null` 让界面用占位符，
 * 不能把设置页变成错误页；也不重试——文件 stat 失败通常意味着路径有问题，重试解决不了。
 */

const state = vi.hoisted(() => ({ usage: vi.fn() }))

vi.mock('@/api/observability', () => ({
  storageApi: { usage: () => state.usage() },
}))

beforeEach(() => {
  state.usage.mockReset()
  state.usage.mockResolvedValue({ success: true, data: { dataBytes: 1024 } })
})

function setup() {
  const { wrapper } = createQueryFixture()
  return renderHook(() => useStorageUsage(), { wrapper })
}

describe('读数', () => {
  it('拿到字节数', async () => {
    const { result } = setup()

    await waitFor(() => expect(result.current).toBe(1024))
  })

  it('查询键固定，清理日志那条路径才能失效到它', () => {
    expect(storageKeys.usage).toEqual(['storage-usage'])
  })

  it('还没拿到时是 null（界面据此显示占位，而不是 0 B）', () => {
    state.usage.mockImplementation(() => new Promise(() => undefined))

    const { result } = setup()

    expect(result.current).toBeNull()
  })

  it('读数是 0 时也照实返回 0，不能被当成「还没拿到」', async () => {
    state.usage.mockResolvedValue({ success: true, data: { dataBytes: 0 } })

    const { result } = setup()

    await waitFor(() => expect(result.current).toBe(0))
  })
})

describe('失败退化', () => {
  it('接口失败时退回 null，不抛错也不重试', async () => {
    state.usage.mockResolvedValue({ success: false, errorCode: 'X', errorMessage: 'stat failed' })
    const { result } = setup()

    await waitFor(() => expect(state.usage).toHaveBeenCalledTimes(1))
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(result.current).toBeNull()
    expect(state.usage).toHaveBeenCalledTimes(1)
  })
})
