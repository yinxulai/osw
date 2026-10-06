// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useLogicalModelControlService } from './service'
import { useLogicalModelControl } from './hooks/use-logical-model-control'

/*
 * 页面组合层只是转发。这里额外钉住**参数是原样透传的**：
 * 逻辑模型引用（id + modelId 两把钥匙）被谁吞掉一个，绑定列表就会拉到别人的数据。
 */

vi.mock('./hooks/use-logical-model-control', () => ({
  useLogicalModelControl: vi.fn(() => ({ marker: 'logical-model-control' })),
}))

describe('useLogicalModelControlService', () => {
  it('把逻辑模型引用原样交给领域 hook', () => {
    const ref = { id: 'lm_primary', modelId: 'gpt-5' }

    const { result } = renderHook(() => useLogicalModelControlService(ref))

    expect(result.current).toEqual({ marker: 'logical-model-control' })
    expect(vi.mocked(useLogicalModelControl)).toHaveBeenCalledWith(ref)
  })

  it('没有选中逻辑模型时把 null 透传下去（hook 据此不发请求）', () => {
    renderHook(() => useLogicalModelControlService(null))

    expect(vi.mocked(useLogicalModelControl)).toHaveBeenCalledWith(null)
  })
})
