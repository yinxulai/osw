// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useModelManagementService } from './service'
import { useModelManagement } from './hooks/use-model-management'

/*
 * 页面组合层只是转发：它存在的意义是「页面不直接依赖具体 hook 名」，方便领域行为搬家。
 * 所以这里钉的是**转发是无损的**——多传、少传、换名都会让页面上的某个按钮失效。
 */

vi.mock('./hooks/use-model-management', () => ({
  useModelManagement: vi.fn(() => ({ marker: 'model-management' })),
}))

describe('useModelManagementService', () => {
  it('原样返回 useModelManagement 的结果（同一个对象，不做二次包装）', () => {
    const { result } = renderHook(() => useModelManagementService())

    expect(result.current).toEqual({ marker: 'model-management' })
    expect(vi.mocked(useModelManagement)).toHaveBeenCalledTimes(1)
  })
})
