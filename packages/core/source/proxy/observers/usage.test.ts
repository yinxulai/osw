import { describe, expect, it } from 'vitest'
import { createUsageTracker, emptyUsage, extractTokenUsage, hasOutput } from './usage'

describe('usage tracker', () => {
  it('starts empty so that "not reported" is never mistaken for zero', () => {
    expect(emptyUsage()).toEqual({
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
      rawUsage: null,
    })
  })

  it('reads usage from nested provider fields', () => {
    const tracker = createUsageTracker()
    tracker.consumeJson('{"response":{"usage":{"input_tokens":12,"output_tokens":7}}}')
    expect(tracker.usage()).toMatchObject({ inputTokens: 12, outputTokens: 7 })
  })

  it('reads reasoning tokens from provider usage details', () => {
    const tracker = createUsageTracker()
    tracker.consumeJson('{"usage":{"prompt_tokens":12,"completion_tokens":7,"completion_tokens_details":{"reasoning_tokens":3}}}')
    expect(tracker.usage().reasoningTokens).toBe(3)
  })

  it.each([
    ['Gemini camel-case metadata', { usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 4, cachedContentTokenCount: 12 } }, { inputTokens: 30, outputTokens: 4, cachedInputTokens: 12 }],
    ['Gemini total cached tokens', { usage: { input_tokens: 30, output_tokens: 4, total_cached_tokens: 12 } }, { inputTokens: 30, outputTokens: 4, cachedInputTokens: 12 }],
    ['OpenAI prompt cache write details', { usage: { prompt_tokens: 30, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 12, cache_write_tokens: 6 } } }, { cachedInputTokens: 12, cacheCreationInputTokens: 6 }],
    ['OpenAI input cache write details', { usage: { input_tokens: 30, output_tokens: 4, input_tokens_details: { cached_tokens: 12, cache_write_tokens: 6 } } }, { inputTokens: 30, cachedInputTokens: 12, cacheCreationInputTokens: 6 }],
    ['Anthropic cache creation TTL details', { usage: { input_tokens: 12, output_tokens: 4, cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 7 } } }, { inputTokens: 24, cacheCreationInputTokens: 12 }],
    ['Anthropic cache read and write totals', { usage: { input_tokens: 8, output_tokens: 4, cache_read_input_tokens: 7, cache_creation_input_tokens: 5 } }, { inputTokens: 20, cachedInputTokens: 7, cacheCreationInputTokens: 5 }],
  ])('reads %s', (_name, body, expected) => {
    const tracker = createUsageTracker()
    tracker.consumeJson(JSON.stringify(body))
    expect(tracker.usage()).toMatchObject(expected)
  })

  it('prefers the real values when a gateway mixes chat-style placeholder zeros with responses-style fields', () => {
    // api.usvip.cc 这类聚合网关会把两套字段塞进同一个 usage：Chat 风格的
    // prompt_tokens / completion_tokens 是占位 0，真实值只在 Responses 风格的
    // input_tokens / output_tokens / input_tokens_details 里。按字段顺序取第一个数字
    // 会命中占位 0，输入、输出、缓存全被记成 0，TPS 与缓存命中率都算不出来。
    const tracker = createUsageTracker()
    tracker.consumeJson(JSON.stringify({
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        prompt_tokens_details: { cached_tokens: 0 },
        input_tokens: 38829,
        output_tokens: 477,
        input_tokens_details: { cached_tokens: 38272 },
      },
    }))
    expect(tracker.usage()).toMatchObject({
      inputTokens: 38829,
      outputTokens: 477,
      cachedInputTokens: 38272,
    })
  })

  it('keeps placeholder zeros as zero when every candidate is zero', () => {
    // 「真实的 0」与「没上报」必须分得开：上游确实报了 0 时回落值仍然是 0，
    // 只有所有候选都缺席才返回 null。
    const tracker = createUsageTracker()
    tracker.consumeJson('{"usage":{"prompt_tokens":0,"completion_tokens":0,"prompt_tokens_details":{"cached_tokens":0}}}')
    expect(tracker.usage()).toMatchObject({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 })
  })

  it('still reports null when no candidate is present at all', () => {
    const tracker = createUsageTracker()
    tracker.consumeJson('{"usage":{"total_tokens":7}}')
    expect(tracker.usage()).toMatchObject({ inputTokens: null, outputTokens: null, cachedInputTokens: null })
  })

  it('prefers a reported positive over a real zero across the same field family', () => {
    // 占位 0 不只出现在「另一套字段」里：同一族里前面的键也可能是占位的 0。
    const tracker = createUsageTracker()
    tracker.consumeJson('{"usage":{"completion_tokens_details":{"reasoning_tokens":0},"output_tokens_details":{"reasoning_tokens":12},"prompt_tokens":0,"input_tokens":30,"completion_tokens":0,"output_tokens":4}}')
    expect(tracker.usage()).toMatchObject({ inputTokens: 30, outputTokens: 4, reasoningTokens: 12 })
  })

  it('preserves zero cache metrics', () => {
    const tracker = createUsageTracker()
    tracker.consumeJson('{"usage":{"prompt_tokens":3,"completion_tokens":1,"prompt_tokens_details":{"cached_tokens":0,"cache_write_tokens":0}}}')
    expect(tracker.usage()).toMatchObject({ cachedInputTokens: 0, cacheCreationInputTokens: 0 })
  })

  it('merges usage reported across several SSE events', () => {
    const tracker = createUsageTracker()
    tracker.consumeSseChunk('data: {"usage":{"prompt_tokens":3}}\n\n')
    tracker.consumeSseChunk('data: {"usage":{"completion_tokens":7}}\n\n')
    expect(tracker.usage()).toMatchObject({ inputTokens: 3, outputTokens: 7 })
  })

  it('lets a later event replace an earlier reading of the same field', () => {
    const tracker = createUsageTracker()
    tracker.consumeSseChunk('data: {"usage":{"output_tokens":1}}\n\n')
    tracker.consumeSseChunk('data: {"usage":{"output_tokens":477}}\n\n')
    expect(tracker.usage().outputTokens).toBe(477)
  })

  it('does not let a later placeholder zero erase an already reported count', () => {
    // 占位 0 也会跨事件出现：聚合网关逐事件在两套字段之间切换，先报真实值，
    // 后一个事件只带占位 0。合并规则若是「后到者优先」，真实值会被 0 抹掉，
    // 与先在字段之间撞上占位 0 是同一个错误。
    const tracker = createUsageTracker()
    tracker.consumeSseChunk('data: {"usage":{"input_tokens":38829,"output_tokens":477}}\n\n')
    tracker.consumeSseChunk('data: {"usage":{"prompt_tokens":0,"completion_tokens":0}}\n\n')
    expect(tracker.usage()).toMatchObject({ inputTokens: 38829, outputTokens: 477 })
  })

  it('keeps a later reported zero when nothing positive was seen before', () => {
    // 只有「已经读到正数」时才拒绝 0；上游若自始至终都报 0，读数仍然是 0。
    const tracker = createUsageTracker()
    tracker.consumeSseChunk('data: {"usage":{"input_tokens":0}}\n\n')
    tracker.consumeSseChunk('data: {"usage":{"prompt_tokens":0}}\n\n')
    expect(tracker.usage().inputTokens).toBe(0)
  })

  it('parses split SSE lines and ignores the DONE sentinel', () => {
    const tracker = createUsageTracker()
    tracker.consumeSseChunk('data: {"usage":{"prompt_tokens":3}}\n\n')
    tracker.consumeSseChunk('data: [DONE]\n')
    expect(tracker.usage().inputTokens).toBe(3)
  })

  it('flushes a trailing SSE line that never got its newline', () => {
    const tracker = createUsageTracker()
    tracker.consumeSseChunk('data: {"usage":{"prompt_tokens":5}}')
    expect(tracker.usage().inputTokens).toBeNull()
    tracker.flush()
    expect(tracker.usage().inputTokens).toBe(5)
  })

  it('keeps forwarding when an upstream event is not valid JSON', () => {
    const tracker = createUsageTracker()
    expect(tracker.consumeJson('not json')).toBe(false)
    expect(tracker.usage()).toMatchObject({ inputTokens: null })
  })
})

describe('first output detection', () => {
  it('ignores role-only, usage-only and sentinel events', () => {
    const tracker = createUsageTracker()
    expect(tracker.consumeSseChunk('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n')).toBe(false)
    expect(tracker.consumeSseChunk('data: {"usage":{"prompt_tokens":3}}\n\n')).toBe(false)
    expect(tracker.consumeSseChunk('data: [DONE]\n')).toBe(false)
    expect(tracker.consumeSseChunk('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n')).toBe(true)
  })

  it('recognizes text output in Anthropic streams', () => {
    const tracker = createUsageTracker()
    expect(tracker.consumeSseChunk('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n')).toBe(false)
    expect(tracker.consumeSseChunk('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}\n\n')).toBe(true)
  })

  it('recognizes text output in Responses streams', () => {
    const tracker = createUsageTracker()
    expect(tracker.consumeSseChunk('data: {"type":"response.created"}\n\n')).toBe(false)
    expect(tracker.consumeSseChunk('data: {"type":"response.output_text.delta","delta":"hello"}\n\n')).toBe(true)
  })

  it('flags JSON bodies that carry generated content', () => {
    expect(hasOutput({ choices: [{ message: { content: 'hello' } }] })).toBe(true)
    expect(hasOutput({ choices: [{ message: { content: '' } }] })).toBe(false)
    expect(hasOutput({ usage: { prompt_tokens: 3 } })).toBe(false)
  })

  it('counts reasoning content as real output on every protocol', () => {
    // 推理 Token 也是上游生成的内容，也会流到客户端：只认正文会让推理模型的首字延迟
    // 虚高到整段思考结束，而上游报的输出 Token 本来就含推理 Token，两个量会对不上。
    expect(hasOutput({ choices: [{ delta: { reasoning_content: '嗯' } }] })).toBe(true)
    expect(hasOutput({ choices: [{ message: { reasoning_content: '嗯' } }] })).toBe(true)
    expect(hasOutput({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '嗯' } })).toBe(true)
    expect(hasOutput({ type: 'response.reasoning_text.delta', delta: '嗯' })).toBe(true)
  })

  it('counts tool payload deltas as real output', () => {
    // 工具参数/输入也是上游生成的 Token，只是没有走正文通道
    expect(hasOutput({ type: 'response.function_call_arguments.delta', delta: '{"q"' })).toBe(true)
    expect(hasOutput({ type: 'response.custom_tool_call_input.delta', delta: 'free' })).toBe(true)
    expect(hasOutput({ type: 'response.function_call_arguments.delta', delta: '' })).toBe(false)
  })

  it('still ignores empty reasoning and non-content deltas', () => {
    expect(hasOutput({ choices: [{ delta: { reasoning_content: '' } }] })).toBe(false)
    expect(hasOutput({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '' } })).toBe(false)
    expect(hasOutput({ choices: [{ delta: { role: 'assistant' } }] })).toBe(false)
  })
})

describe('output token estimation', () => {
  it('starts at zero before any content arrives', () => {
    const tracker = createUsageTracker()
    expect(tracker.estimatedOutputTokens()).toBe(0)
  })

  it('accumulates an estimate from streamed content deltas', () => {
    // 上游只在收尾帧报真实用量，实时指标在流式期间只能靠估值。估值要随内容逐块增长。
    const tracker = createUsageTracker()
    tracker.consumeSseChunk('data: {"choices":[{"delta":{"content":"abcd"}}]}\n\n')
    const afterFirst = tracker.estimatedOutputTokens()
    expect(afterFirst).toBeGreaterThan(0)

    tracker.consumeSseChunk('data: {"choices":[{"delta":{"content":"efgh"}}]}\n\n')
    expect(tracker.estimatedOutputTokens()).toBeGreaterThan(afterFirst)
  })

  it('weights dense scripts heavier than ASCII', () => {
    // 中文一字约一个 Token，英文约四字一个：同一段「字数」的中英文不该估出同一个数。
    const ascii = createUsageTracker()
    ascii.consumeSseChunk('data: {"choices":[{"delta":{"content":"ab"}}]}\n\n')
    const cjk = createUsageTracker()
    cjk.consumeSseChunk('data: {"choices":[{"delta":{"content":"中文"}}]}\n\n')
    expect(cjk.estimatedOutputTokens()).toBeGreaterThan(ascii.estimatedOutputTokens())
  })

  it('does not count usage-only, role-only or sentinel frames', () => {
    const tracker = createUsageTracker()
    tracker.consumeSseChunk('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n')
    tracker.consumeSseChunk('data: {"usage":{"output_tokens":9}}\n\n')
    tracker.consumeSseChunk('data: [DONE]\n')
    expect(tracker.estimatedOutputTokens()).toBe(0)
  })

  it('counts reasoning content toward the estimate', () => {
    // 上游报的输出 Token 含推理 Token，估算也必须含，否则推理阶段的速度被系统性低估。
    const tracker = createUsageTracker()
    tracker.consumeSseChunk('data: {"choices":[{"delta":{"reasoning_content":"思考中"}}]}\n\n')
    expect(tracker.estimatedOutputTokens()).toBeGreaterThan(0)
  })

  it('counts Anthropic and Responses deltas', () => {
    const anthropic = createUsageTracker()
    anthropic.consumeSseChunk('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}\n\n')
    expect(anthropic.estimatedOutputTokens()).toBeGreaterThan(0)

    const responses = createUsageTracker()
    responses.consumeSseChunk('data: {"type":"response.output_text.delta","delta":"hello"}\n\n')
    expect(responses.estimatedOutputTokens()).toBeGreaterThan(0)
  })

  it('estimates from a whole non-streaming JSON body too', () => {
    const tracker = createUsageTracker()
    tracker.consumeJson(JSON.stringify({ choices: [{ message: { content: 'hello world' } }] }))
    expect(tracker.estimatedOutputTokens()).toBeGreaterThan(0)
  })
})

describe('token usage extraction', () => {
  it('returns an empty reading for a payload without usage', () => {
    expect(extractTokenUsage({ id: 'resp-1' })).toMatchObject({ inputTokens: null, rawUsage: null })
  })

  it('keeps the provider payload so that unknown fields are not lost', () => {
    expect(extractTokenUsage({ usage: { prompt_tokens: 3, vendor_field: 'kept' } }).rawUsage).toMatchObject({ prompt_tokens: 3, vendor_field: 'kept' })
  })
})
