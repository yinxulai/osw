import { describe, expect, it } from 'vitest'
import { ALL_TRANSPORT_KINDS, TransportKindSchema } from './schemas'
import { bodyDeliveryShape, isStageRunnable, stageShapeSupport, type BodyDeliveryShape } from './delivery-shape'

/**
 * 形态判定的门禁。
 *
 * 这里要盯住的核心不是「`http-stream` 是不是 `incremental`」这种单点，而是**穷尽性**：
 * 曾经的实现是 `transport === 'http-stream' ? 'incremental' : 'whole'`，那个兜底分支把当时
 * 还没实现的 `websocket` 也归成了「整包」，于是入口回 501、试跑说「改造成功」成了同一个系统的
 * 两个答案。因此下面的用例会遍历 `ALL_TRANSPORT_KINDS`：只要有人加了新形态而不表态，
 * 这张表就会漏给它一个形态，测试当场失败。
 */
describe('交付形态', () => {
  it('每个传输形态都有明确的交付形态', () => {
    // 先自检枚举本身没退化：这条轴今天就是三个取值，多一个少一个都要在这里先被看见。
    expect([...ALL_TRANSPORT_KINDS].sort()).toEqual(['http', 'http-stream', 'websocket'])
    const expected: Record<string, BodyDeliveryShape> = {
      http: 'whole',
      'http-stream': 'incremental',
      websocket: 'duplex',
    }
    for (const transport of ALL_TRANSPORT_KINDS) {
      expect(bodyDeliveryShape(transport), `${transport} 的交付形态`).toBe(expected[transport])
    }
  })

  it('websocket 是独立形态，不会被兜底成整包', () => {
    // 这条是本次修复的靶心：`websocket` 落到 `duplex` 而不是 `whole`。
    expect(bodyDeliveryShape('websocket')).toBe('duplex')
    expect(bodyDeliveryShape('websocket')).not.toBe('whole')
  })

  it('Schema 的取值与可判定的形态一一对应', () => {
    for (const transport of TransportKindSchema.options) {
      expect(() => bodyDeliveryShape(transport)).not.toThrow()
    }
  })

  it('请求阶段在所有形态下都可跑', () => {
    for (const transport of ALL_TRANSPORT_KINDS) {
      const shape = bodyDeliveryShape(transport)
      expect(stageShapeSupport('request', shape), `${transport}`).toBe('supported')
      expect(isStageRunnable('request', shape), `${transport}`).toBe(true)
    }
  })

  it('响应阶段区分「今天不做」与「不适用」', () => {
    // 整包：正常可跑。
    expect(stageShapeSupport('response', 'whole')).toBe('supported')
    // 流式：今天没有能做的事，逐条跳过并报原因——`skipped` 而不是 `not-applicable`。
    expect(stageShapeSupport('response', 'incremental')).toBe('skipped')
    expect(isStageRunnable('response', 'incremental')).toBe(false)
    // WebSocket：双向多轮没有「一份响应正文」，这是调用方用错，属于 `not-applicable`。
    expect(stageShapeSupport('response', 'duplex')).toBe('not-applicable')
    expect(isStageRunnable('response', 'duplex')).toBe(false)
  })

  it('跳过与不适用是两个值，不能塌缩成同一个', () => {
    // 塌缩正是这个模块要修的老毛病：混在一起，用户就会在试跑里看到 WS 响应「改造成功」。
    expect(stageShapeSupport('response', 'incremental')).not.toBe(stageShapeSupport('response', 'duplex'))
  })
})
