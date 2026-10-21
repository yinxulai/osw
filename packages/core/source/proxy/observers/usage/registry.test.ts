import { describe, expect, it } from 'vitest'
import { USAGE_ADAPTERS, extractTokenUsage } from './registry'

/**
 * 注册表本身的约定。
 *
 * 字段之间的优先级不是写在一张表里的，而是由 {@link USAGE_ADAPTERS} 的**数组顺序**决定的：
 * 候选值按适配器顺序首尾相接，再由 `firstNumber` 取第一个正数。顺序被无意改变时，
 * 端到端用例未必会红（只有当同一份报文里两家的字段同时有值且不同才会露出来），
 * 所以这里把顺序直接钉住。
 */
describe('usage adapter registry', () => {
  it('适配器顺序就是字段优先级', () => {
    expect(USAGE_ADAPTERS.map(adapter => adapter.id))
      .toEqual(['openai-chat', 'openai-responses', 'anthropic', 'gemini'])
  })

  it('总量字段是占位 0 时，不替 Anthropic 的「输入不含缓存」作证', () => {
    // `prompt_tokens: 0` 是聚合网关的占位写法。它虽然来自 Chat，但不能算「这份报文给了总量」——
    // 一旦算作总量，缓存就不再被加回，而这条报文真实的缓存读数是 7。
    expect(extractTokenUsage({ usage: { prompt_tokens: 0, input_tokens: 8, cache_read_input_tokens: 7 } }))
      .toMatchObject({ inputTokens: 15, cachedInputTokens: 7 })
  })

  it('每个适配器对无关报文都返回空读数（read 是全函数）', () => {
    for (const adapter of USAGE_ADAPTERS) {
      const reading = adapter.read({ unrelated: true })
      expect(Object.keys(reading).sort()).toEqual(['cacheCreation', 'cachedInput', 'input', 'output', 'reasoning'])
      // 「字段不在」必须是 undefined，不能是 null/0：注册表靠 firstNumber 把二者区分开。
      // 逐个字段取，不用 `Object.values`：接口没有索引签名时它会退化成 `any[]`，
      // 参数随即变成隐式 any（TS7006）。显式列出字段也顺带钉住了「一共就这五组」。
      const fieldGroups: readonly (readonly unknown[])[] = [
        reading.input,
        reading.output,
        reading.cachedInput,
        reading.cacheCreation,
        reading.reasoning,
      ]
      for (const values of fieldGroups) {
        expect(values.every(value => value === undefined)).toBe(true)
      }
    }
  })
})
