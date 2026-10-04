import { describe, expect, it } from 'vitest'
import type { SharedRewriteRule, SharedRewriteRulePayload } from '@common/shared-rewrite-rules'
import { searchTextOf, signatureOf } from './signature'

/**
 * 造一份最小可用载荷：一个 `header-set` 动作。
 *
 * 入参刻意是 `Record<string, unknown>` 而不是 `Partial<SharedRewriteRulePayload>`：
 * `signatureOf` 收的是**未经校验**的原始输入，这些用例正是在测「原始输入怎么被规范化成
 * 签名」，把入参钉成解析后的形状反而测不到那些没写全的、等 schema 补默认值的载荷。
 */
function payload(overrides: Record<string, unknown> = {}): unknown {
  return {
    name: 'Example rule',
    scope: 'model',
    actions: [{ type: 'header-set', name: 'User-Agent', value: 'OSW', stage: 'request' }],
    ...overrides,
  }
}

describe('signatureOf', () => {
  it('同一份内容总是得到同一个 id', async () => {
    const first = await signatureOf(payload())
    const second = await signatureOf(payload())
    expect(second.id).toBe(first.id)
    expect(first.id).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('键顺序不同不影响签名', async () => {
    const first = await signatureOf(payload({ description: 'd', name: 'A' }))
    const reordered = await signatureOf({ ...(payload() as Record<string, unknown>), name: 'A', description: 'd' })
    expect(reordered.id).toBe(first.id)
  })

  it('补上默认值之后才参与签名', async () => {
    // 显式写出默认值与省略它，应当是同一条规则。
    const explicit = await signatureOf(payload({ schemaVersion: 1, match: {}, testCases: [] }))
    const implicit = await signatureOf(payload())
    expect(implicit.id).toBe(explicit.id)
  })

  it('内容不同则签名不同', async () => {
    const first = await signatureOf(payload({ name: 'A' }))
    const second = await signatureOf(payload({ name: 'B' }))
    expect(second.id).not.toBe(first.id)
  })

  it('动作顺序是签名的一部分', async () => {
    const forward = await signatureOf(payload({
      actions: [
        { type: 'header-set', name: 'A', value: '1' },
        { type: 'header-set', name: 'B', value: '2' },
      ],
    }))
    const backward = await signatureOf(payload({
      actions: [
        { type: 'header-set', name: 'B', value: '2' },
        { type: 'header-set', name: 'A', value: '1' },
      ],
    }))
    expect(backward.id).not.toBe(forward.id)
  })

  it('非法载荷直接抛错，不会产生签名', async () => {
    await expect(signatureOf({ name: '', actions: [] })).rejects.toThrow()
  })
})

describe('searchTextOf', () => {
  it('名称与说明拼在一起并转小写', () => {
    const text = searchTextOf({ ...(payload() as SharedRewriteRulePayload) } as SharedRewriteRulePayload)
    expect(text).toContain('example rule')
  })

  it('折叠多余空白', () => {
    const rule = { ...(payload() as SharedRewriteRulePayload), name: 'A   B', description: '  c ' } as SharedRewriteRulePayload
    expect(searchTextOf(rule)).toBe('a b c')
  })
})

describe('record shape', () => {
  it('记录带 id 与用量，载荷部分与输入一致', async () => {
    const { payload: parsed } = await signatureOf(payload())
    const record: SharedRewriteRule = { ...parsed, id: 'sha256:x', usageCount: 0, createdTime: 1, updatedTime: 1 }
    expect(record.actions).toHaveLength(1)
    expect(record.usageCount).toBe(0)
  })
})
