import { describe, expect, it } from 'vitest'
import { createUsageTracker } from './usage'

/**
 * 重构前的行为快照（characterization）。
 *
 * `usage.test.ts` 覆盖的是「口径」——占位 0、跨事件合并、Anthropic 缓存是否含在总输入里。
 * 但它在某些字段族上只挑了代表，剩下的别名没有直接断言。把用量读取按协议拆成适配器时，
 * 最容易出的事故不是逻辑写错，而是**字段清单在搬运中少了一条**：少一条不会让任何现有
 * 用例变红，只会在某家上游上静默返回 `null`。
 *
 * 所以这里先把每条别名、每个可放 usages 的位置逐条钉住，再动结构。这些断言描述的是
 * 「现在实际是什么」，重构后必须一字不差。
 */
function read(body: unknown) {
  const tracker = createUsageTracker()
  tracker.consumeJson(JSON.stringify(body))
  return tracker.usage()
}

describe('用量字段族：每个别名都要能被读到', () => {
  it('OpenAI 风格总量别名', () => {
    expect(read({ usage: { total_input_tokens: 11, total_output_tokens: 5 } }))
      .toMatchObject({ inputTokens: 11, outputTokens: 5 })
  })

  it('缓存读数的其余别名', () => {
    expect(read({ usage: { prompt_tokens: 30, completion_tokens: 4, cached_input_tokens: 9 } }))
      .toMatchObject({ inputTokens: 30, cachedInputTokens: 9 })
    expect(read({ usage: { input_tokens: 30, output_tokens: 4, cache_read_tokens: 9 } }))
      .toMatchObject({ inputTokens: 30, cachedInputTokens: 9 })
    expect(read({ usage: { total_cached_tokens: 9 } }))
      .toMatchObject({ cachedInputTokens: 9, inputTokens: null })
  })

  it('缓存写入的其余别名（都不是「输入不含缓存」的触发字段）', () => {
    for (const key of ['cache_creation_tokens', 'cached_creation_input_tokens', 'cache_write_tokens']) {
      expect(read({ usage: { input_tokens: 8, output_tokens: 4, [key]: 5 } }))
        .toMatchObject({ inputTokens: 8, cacheCreationInputTokens: 5 })
    }
  })

  it('Anthropic 缓存写入只给了半档 TTL 时也只加那一档', () => {
    expect(read({ usage: { input_tokens: 8, output_tokens: 4, cache_creation: { ephemeral_5m_input_tokens: 5 } } }))
      .toMatchObject({ inputTokens: 13, cacheCreationInputTokens: 5 })
  })

  it('推理 Token 的第二个来源', () => {
    expect(read({ usage: { input_tokens: 12, output_tokens: 4, output_tokens_details: { reasoning_tokens: 7 } } }))
      .toMatchObject({ reasoningTokens: 7 })
  })

  it('Gemini 的 snake_case 元数据', () => {
    expect(read({ usage_metadata: { promptTokenCount: 10, candidatesTokenCount: 2, cachedContentTokenCount: 3 } }))
      .toMatchObject({ inputTokens: 10, outputTokens: 2, cachedInputTokens: 3 })
  })
})

describe('usage 可以出现在哪些层级', () => {
  it('包在 message 里', () => {
    expect(read({ message: { usage: { input_tokens: 5, output_tokens: 2 } } }))
      .toMatchObject({ inputTokens: 5, outputTokens: 2 })
  })

  it('包在 response 里', () => {
    expect(read({ response: { usage: { input_tokens: 12, output_tokens: 7 } } }))
      .toMatchObject({ inputTokens: 12, outputTokens: 7 })
  })

  it('散在 output 数组的每一项里', () => {
    expect(read({ output: [{ usage: { input_tokens: 6 } }, { usage: { output_tokens: 3 } }] }))
      .toMatchObject({ inputTokens: 6, outputTokens: 3 })
  })

  it('裸在报文顶层（没有 usage 容器）', () => {
    expect(read({ input_tokens: 30, output_tokens: 9 }))
      .toMatchObject({ inputTokens: 30, outputTokens: 9 })
  })

  it('顶层是最后才回落的来源：容器里的值优先', () => {
    expect(read({ input_tokens: 99, output_tokens: 99, usage: { prompt_tokens: 30, completion_tokens: 4 } }))
      .toMatchObject({ inputTokens: 30, outputTokens: 4 })
  })

  it('多个位置同时给时按位置顺序合并', () => {
    expect(read({ usage: { prompt_tokens: 10 }, response: { usage: { completion_tokens: 3 } } }))
      .toMatchObject({ inputTokens: 10, outputTokens: 3 })
  })
})
