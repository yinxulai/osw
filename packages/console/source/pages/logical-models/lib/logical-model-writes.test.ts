import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createLogicalModel,
  removeLogicalModel,
  removeProviderModelBinding,
  updateLogicalModel,
} from './logical-model-writes'

/*
 * 逻辑模型的写入动作。
 *
 * 这一层只负责「把那次请求发对」——什么时候刷新列表是调用方的决定。所以要钉住的是
 * **请求形状**：路径上的 id 不进请求体、内建模型不带模型名、删绑定不删模型。
 */

vi.mock('@/api/models', () => ({
  logicalModelApi: { create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  schedulingPolicyApi: { remove: vi.fn() },
}))

const { logicalModelApi, schedulingPolicyApi } = await import('@/api/models')

const create = vi.mocked(logicalModelApi.create)
const update = vi.mocked(logicalModelApi.update)
const remove = vi.mocked(logicalModelApi.remove)
const removePolicy = vi.mocked(schedulingPolicyApi.remove)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createLogicalModel', () => {
  it('把请求体原样发出去，并把 data 解出来', async () => {
    create.mockResolvedValue({ success: true, data: { id: 'lm_new' } } as never)

    await expect(createLogicalModel({ modelId: 'gpt-4o', description: '说明' })).resolves.toEqual({ id: 'lm_new' })
    expect(create).toHaveBeenCalledWith({ modelId: 'gpt-4o', description: '说明' })
  })

  it('失败时抛出本地化后的错误，调用方不需要自己判断 success', async () => {
    create.mockResolvedValue({ success: false, errorCode: 'conflict', errorMessage: 'logical model exists' } as never)

    await expect(createLogicalModel({ modelId: 'gpt-4o', description: '' })).rejects.toThrow()
  })
})

describe('updateLogicalModel', () => {
  it('记录 id 进路径，不进请求体', async () => {
    update.mockResolvedValue({ success: true, data: { id: 'lm_1' } } as never)

    await updateLogicalModel('lm_1', { modelId: 'new-name', description: '说明' })

    expect(update).toHaveBeenCalledWith('lm_1', { modelId: 'new-name', description: '说明' })
    expect(update.mock.calls[0][1]).not.toHaveProperty('id')
  })

  it('只改说明时不带模型名', async () => {
    update.mockResolvedValue({ success: true, data: { id: 'lm_1' } } as never)

    await updateLogicalModel('lm_1', { description: '改说明' })

    expect(update).toHaveBeenCalledWith('lm_1', { description: '改说明' })
  })

  it('失败时抛出', async () => {
    update.mockResolvedValue({ success: false, errorCode: 'notFound', errorMessage: 'gone' } as never)

    await expect(updateLogicalModel('lm_1', { description: '' })).rejects.toThrow()
  })
})

describe('removeLogicalModel', () => {
  it('按记录 id 删，服务端软删除，界面只需要把列表刷掉', async () => {
    remove.mockResolvedValue({ success: true, data: null } as never)

    await removeLogicalModel('lm_1')

    expect(remove).toHaveBeenCalledWith('lm_1')
  })

  it('失败时抛出——删不掉这件事必须让用户知道', async () => {
    remove.mockResolvedValue({ success: false, errorCode: 'notFound', errorMessage: 'gone' } as never)

    await expect(removeLogicalModel('lm_1')).rejects.toThrow()
  })
})

describe('removeProviderModelBinding', () => {
  it('只删绑定：逻辑模型 id 与供应商模型 id 一起进路径', async () => {
    removePolicy.mockResolvedValue({ success: true, data: null } as never)

    await removeProviderModelBinding('lm_1', 'pm_a')

    expect(removePolicy).toHaveBeenCalledWith('lm_1', 'pm_a')
  })

  it('不会顺手去删供应商模型本体', async () => {
    removePolicy.mockResolvedValue({ success: true, data: null } as never)

    await removeProviderModelBinding('lm_1', 'pm_a')

    expect(logicalModelApi.remove).not.toHaveBeenCalled()
  })

  it('失败时抛出', async () => {
    removePolicy.mockResolvedValue({ success: false, errorCode: 'notFound', errorMessage: 'gone' } as never)

    await expect(removeProviderModelBinding('lm_1', 'pm_a')).rejects.toThrow()
  })
})
