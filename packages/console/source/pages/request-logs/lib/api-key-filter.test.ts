import { describe, expect, it } from 'vitest'
import { ALL_API_KEYS, ANONYMOUS_API_KEY, apiKeyIdParam, apiKeyLabel } from './api-key-filter'

/*
 * 这一维最容易出的错不是「筛错了」，是「筛得对但发错了」：
 * 把「没筛」发成 `null` 会让结果集从「全部请求」变成「只有匿名请求」，
 * 而界面上两件事长得一模一样——用户只会以为「我的 Key 一把都没被用过」。
 */

describe('apiKeyIdParam', () => {
  it('不筛时一个字段都不发（不是发 null）', () => {
    expect(apiKeyIdParam(ALL_API_KEYS)).toEqual({})
    expect(apiKeyIdParam(ALL_API_KEYS)).not.toHaveProperty('apiKeyId')
  })

  it('筛匿名请求时发 null（这是服务端的真实筛选值）', () => {
    expect(apiKeyIdParam(ANONYMOUS_API_KEY)).toEqual({ apiKeyId: null })
  })

  it('筛某一把 Key 时原样发 id', () => {
    expect(apiKeyIdParam('ak_abc')).toEqual({ apiKeyId: 'ak_abc' })
  })

  it('「全部」与「匿名」是不同的取值，不能共用一个哨兵', () => {
    expect(ALL_API_KEYS).not.toBe(ANONYMOUS_API_KEY)
  })
})

describe('apiKeyLabel', () => {
  const keys = [{ id: 'ak_1', name: '笔记本上的 Cursor' }]
  const labels = { anonymous: '未署名', unknown: '已删除的 Key' }

  it('null 是「未署名」，不是在列表里找不到', () => {
    expect(apiKeyLabel(null, keys, labels)).toBe('未署名')
  })

  it('按 id 反查出当前名字（改名后历史记录跟着换标签）', () => {
    expect(apiKeyLabel('ak_1', keys, labels)).toBe('笔记本上的 Cursor')
  })

  it('查不到说明 Key 已被删除，但记录仍然展示', () => {
    expect(apiKeyLabel('ak_gone', keys, labels)).toBe('已删除的 Key')
  })

  it('没有 Key 列表时也不会把 id 当成名字', () => {
    expect(apiKeyLabel('ak_1', [], labels)).toBe('已删除的 Key')
  })
})
