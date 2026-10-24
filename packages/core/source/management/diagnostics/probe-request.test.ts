import { describe, expect, it } from 'vitest'
import { buildDiagnosticBody, padPrompt } from './probe-request'

/**
 * 请求体怎么拼。
 *
 * 这些断言守的是「发出去的那句话」：三种协议各自长什么样、什么时候带输出上限、
 * 流式在哪里表达。它不碰网络也不碰数据库，因此不需要建库。
 */
describe('diagnostic request body — 协议形态', () => {
  it('只给直连 anthropic 补 max_tokens，且压在最小值上', () => {
    expect(JSON.parse(buildDiagnosticBody('anthropic-messages', 'claude', false))).toEqual({
      model: 'claude',
      max_tokens: 16,
      stream: true,
      messages: [{ role: 'user', content: 'Hi' }],
    })
  })

  it('走协议转换的 anthropic 不带 max_tokens（目标多是 OpenAI 形态）', () => {
    expect(JSON.parse(buildDiagnosticBody('anthropic-messages', 'gpt', true))).toEqual({
      model: 'gpt',
      stream: true,
      messages: [{ role: 'user', content: 'Hi' }],
    })
  })

  it('两个 OpenAI 协议都不带输出上限，避免命中不支持 max_tokens 的模型', () => {
    const completions = JSON.parse(buildDiagnosticBody('openai-completions', 'gpt', false)) as Record<string, unknown>
    expect(completions).toEqual({
      model: 'gpt',
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: 'user', content: 'Hi' }],
    })
    expect(completions).not.toHaveProperty('max_tokens')
    expect(JSON.parse(buildDiagnosticBody('openai-responses', 'gpt', false))).toEqual({
      model: 'gpt',
      stream: true,
      stream_options: { include_usage: true },
      input: [{ role: 'user', content: 'Hi' }],
    })
  })

  it('不给模式就是流式：诊断没有「非流式」这一种', () => {
    // 整包响应里既没有首字节时刻，也拿不到用量（用量挂在流尾），跑完半列都是 `—`。
    expect(JSON.parse(buildDiagnosticBody('openai-completions', 'gpt', false)).stream).toBe(true)
    expect(JSON.parse(buildDiagnosticBody('openai-completions', 'gpt', false)).stream).toBe(
      JSON.parse(buildDiagnosticBody('openai-completions', 'gpt', false, 'streaming')).stream,
    )
  })

  it('草稿连接测试可以显式要整包：它只是一次握手，不读流', () => {
    // `model-connectivity` 用的是 `requestHttpBuffered`：拿到 SSE 会一直读到流自己结束，
    // 量到的就不再是握手耗时而是一整个生成过程的耗时。
    const body = JSON.parse(buildDiagnosticBody('openai-completions', 'gpt', false, 'streaming', { stream: false }))
    expect(body).toEqual({ model: 'gpt', messages: [{ role: 'user', content: 'Hi' }] })
  })
})

describe('diagnostic request body — 诊断模式', () => {
  it('流式诊断在三种协议下都声明 stream: true', () => {
    // 只靠 accept 头不够：三种协议都只认请求体里的 `stream`。
    expect(JSON.parse(buildDiagnosticBody('openai-completions', 'gpt', false, 'streaming'))).toMatchObject({ stream: true })
    expect(JSON.parse(buildDiagnosticBody('openai-responses', 'gpt', false, 'streaming'))).toMatchObject({ stream: true })
    expect(JSON.parse(buildDiagnosticBody('anthropic-messages', 'claude', false, 'streaming'))).toMatchObject({ stream: true })
  })

  it('两个 OpenAI 协议都要用量：不写 include_usage 的上游就不会在流尾报 Token', () => {
    // 这就是「输出 Token 恒为 —」的根因：要了流、却没要用量，收尾帧里没有 usage。
    expect(JSON.parse(buildDiagnosticBody('openai-completions', 'gpt', false, 'streaming')).stream_options).toEqual({ include_usage: true })
    expect(JSON.parse(buildDiagnosticBody('openai-responses', 'gpt', false, 'streaming')).stream_options).toEqual({ include_usage: true })
    // Anthropic 的 `/v1/messages` 没有这个字段，带了反而可能被当成非法参数。
    expect(JSON.parse(buildDiagnosticBody('anthropic-messages', 'claude', false, 'streaming'))).not.toHaveProperty('stream_options')
  })

  it('速度诊断同样流式，并且换成一段够长的提示词', () => {
    const body = JSON.parse(buildDiagnosticBody('openai-completions', 'gpt', false, 'speed')) as {
      stream?: boolean
      messages: { content: string }[]
    }
    // 一句话的回答里，出字快慢全被首字节和连接开销盖住，所以速度诊断必须换提示词。
    expect(body.stream).toBe(true)
    expect(body.messages[0].content).not.toBe('Hi')
    expect(body.messages[0].content.length).toBeGreaterThan(20)
  })

  it('直连 anthropic 测速度时把 max_tokens 放大，走转换时仍然不加', () => {
    // 数到 200 会被 16 个 Token 掐断，测出来的就不是「出字速度」而是「上限速度」。
    expect(JSON.parse(buildDiagnosticBody('anthropic-messages', 'claude', false, 'speed')).max_tokens).toBeGreaterThan(16)
    expect(JSON.parse(buildDiagnosticBody('anthropic-messages', 'gpt', true, 'speed'))).not.toHaveProperty('max_tokens')
  })
})

/**
 * 「测试配置」里那几项落到请求体上的样子。
 *
 * 这几条守的是同一个原则：配置只改**发出去的那句话**，不改诊断本身的形态。
 * 提示词换了，模式仍是模式（流式与否、max_tokens 都不跟着动）。
 */
describe('diagnostic request body — 提示词与输入长度', () => {
  function promptOf(body: string): string {
    const parsed = JSON.parse(body) as { messages?: { content: string }[]; input?: { content: string }[] }
    return (parsed.messages ?? parsed.input)![0].content
  }

  it('自定义提示词替换掉模式默认值，三种协议都换', () => {
    const prompt = '只回一个词'
    expect(promptOf(buildDiagnosticBody('openai-completions', 'gpt', false, 'streaming', { prompt }))).toBe(prompt)
    expect(promptOf(buildDiagnosticBody('openai-responses', 'gpt', false, 'streaming', { prompt }))).toBe(prompt)
    expect(promptOf(buildDiagnosticBody('anthropic-messages', 'claude', false, 'streaming', { prompt }))).toBe(prompt)
  })

  it('提示词只去首尾空白：中间原样发出去', () => {
    expect(promptOf(buildDiagnosticBody('openai-completions', 'gpt', false, 'streaming', { prompt: '  a  b  ' }))).toBe('a  b')
  })

  it('空提示词回落到模式默认值，而不是发一句空话', () => {
    // 界面留空就不传 prompt，服务端必须自己兜回默认值，否则上游会收到空 content。
    expect(promptOf(buildDiagnosticBody('openai-completions', 'gpt', false, 'streaming', { prompt: '   ' }))).toBe('Hi')
    const speed = promptOf(buildDiagnosticBody('openai-completions', 'gpt', false, 'speed', {}))
    expect(speed.length).toBeGreaterThan(20)
  })

  it('输入长度把提示词补齐到目标字符数', () => {
    const padded = promptOf(buildDiagnosticBody('openai-completions', 'gpt', false, 'streaming', { prompt: 'Hi', inputLength: 500 }))
    expect(padded.length).toBe(500)
    expect(padded.startsWith('Hi')).toBe(true)
    // 补的是可忽略的填充句，不是重复同一个字符（重复字符会被网关压掉，长度就白加了）。
    expect(padded).toContain('Ignore the following filler text')
  })

  it('已经超长的提示词不被截断：尊重用户写的那份', () => {
    const prompt = 'x'.repeat(100)
    expect(padPrompt(prompt, 50)).toBe(prompt)
  })

  it('输入长度为 0 时原样返回，不留尾随空白', () => {
    expect(padPrompt('Hi', 0)).toBe('Hi')
    expect(padPrompt('Hi', -1)).toBe('Hi')
  })
})
