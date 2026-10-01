import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cachedConfigRead, configReadCacheGeneration, invalidateConfigReadCache } from './config-read-cache'
import { closeDatabases, initDatabases } from './index'
import { createLogicalModel, getLogicalModel, getLogicalModelByModelId, listLogicalModels, updateLogicalModel } from './logical-model-store'
import { createProvider, deleteProvider, listProviders } from './provider-store'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-config-read-cache-'))
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('config read cache', () => {
  it('serves repeat reads without running the reader again', async () => {
    // 缓存要回答的唯一问题是「同一个键读两次，第二次还去问数据库了吗」。
    const read = vi.fn().mockResolvedValue([1, 2, 3])

    await cachedConfigRead('probe:repeat', read)
    await cachedConfigRead('probe:repeat', read)

    expect(read).toHaveBeenCalledTimes(1)
  })

  it('keeps values separate per key', async () => {
    // 键就是缓存的身份；两个不同的读共用一格会让「按 id 查」串到别人的值上。
    const first = await cachedConfigRead('probe:key-a', () => 'a')
    const second = await cachedConfigRead('probe:key-b', () => 'b')

    expect([first, second]).toEqual(['a', 'b'])
  })

  it('drops every entry when the generation advances', async () => {
    // 失效是整份作废，不是按键删：配置写入本来就低频，按键维护依赖只会多一类「忘了删哪一格」的错。
    const read = vi.fn().mockReturnValue('value')

    await cachedConfigRead('probe:invalidate', read)
    invalidateConfigReadCache()
    await cachedConfigRead('probe:invalidate', read)

    expect(read).toHaveBeenCalledTimes(2)
    expect(configReadCacheGeneration()).toBeGreaterThan(0)
  })

  it('does not cache a rejected read', async () => {
    // 读失败是「这一刻读不到」，把它缓存下来会让一次瞬时故障固化成永久错误。
    const read = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue('recovered')
    const key = 'probe:rejection'

    await expect(cachedConfigRead(key, read)).rejects.toThrow('boom')

    expect(await cachedConfigRead(key, read)).toBe('recovered')
    expect(read).toHaveBeenCalledTimes(2)
  })
})

describe('config read cache integration with the stores', () => {
  it('reflects a logical model rename through the cached list read', async () => {
    // 端到端要证明的只有一件事：写完之后，缓存里的旧值不能继续被读到。
    // 失效挂在配置库句柄上（见 `./index.ts`），所以这里不需要任何手动调用。
    const created = await createLogicalModel({ modelId: 'cached-rename-before' })
    await listLogicalModels()

    await updateLogicalModel(created.id, { modelId: 'cached-rename-after' })

    const models = await listLogicalModels()
    expect(models.map(model => model.modelId)).toContain('cached-rename-after')
    await expect(getLogicalModelByModelId('cached-rename-after')).resolves.toMatchObject({ id: created.id })
    await expect(getLogicalModelByModelId('cached-rename-before')).resolves.toBeUndefined()
  })

  it('reflects a description update through the cached single read', async () => {
    const created = await createLogicalModel({ modelId: 'cached-description', description: 'before' })
    expect((await getLogicalModel(created.id))?.description).toBe('before')

    await updateLogicalModel(created.id, { description: 'after' })

    expect((await getLogicalModel(created.id))?.description).toBe('after')
  })

  it('reflects a provider deletion through the cached list read', async () => {
    const provider = await createProvider({ name: 'cached-provider', apiKeyReference: 'key_cached' })
    expect((await listProviders()).map(item => item.id)).toContain(provider.id)

    await deleteProvider(provider.id)

    expect((await listProviders()).map(item => item.id)).not.toContain(provider.id)
  })
})
