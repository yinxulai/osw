import { describe, expect, it } from 'vitest'
import type { Modifier, ModifierContext, ModifierFrameMode, ModifierScope, TransportKind } from '@server/proxy/contracts'
import { matchesModifierScope, selectCandidates } from './modifier-selection'

/*
 * 修改器的结构性筛选。
 *
 * 这一层只看「这次交换是什么形态」——方向、粒度、`scope`——**不看上游回了什么**，
 * 所以它能在上游回话之前一次算完。正因为如此，`scope` 判错的后果是静默的：
 * 本该跑的修改器不跑，日志上什么都不会说。这里的断言就是替那段沉默发声。
 */

interface ContextOverrides { direction?: ModifierContext['direction']; transport?: TransportKind }

function context(overrides: ContextOverrides = {}): ModifierContext {
  return {
    direction: overrides.direction ?? 'response',
    clientProtocol: 'openai-completions',
    upstreamProtocol: 'anthropic-messages',
    exchange: {
      requestId: 'req-1',
      logicalModelId: 'logical-1',
      clientProtocol: 'openai-completions',
      transport: overrides.transport ?? 'http',
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {},
      body: Buffer.alloc(0),
      signal: new AbortController().signal,
    },
    attempt: { index: 0, endpointId: 'messages', endpointProtocol: 'anthropic-messages' },
    upstreamHead: null,
  }
}

function modifier(overrides: Partial<Modifier> & Pick<Modifier, 'id'>): Modifier {
  return {
    order: 0,
    direction: 'response',
    frameMode: 'frame',
    match: () => true,
    ...overrides,
  }
}

function ids(modifiers: readonly Modifier[], frameMode: ModifierFrameMode = 'frame', ctx = context()): string[] {
  return selectCandidates(modifiers, ctx, frameMode).map(item => item.id)
}

describe('selectCandidates', () => {
  it('只留下方向一致且粒度一致的修改器', () => {
    const modifiers = [
      modifier({ id: 'right' }),
      modifier({ id: 'other-direction', direction: 'request' }),
      modifier({ id: 'other-mode', frameMode: 'buffered' }),
      modifier({ id: 'skipped', frameMode: 'skip' }),
    ]

    expect(ids(modifiers)).toEqual(['right'])
  })

  it('同一个修改器可以只在一个粒度里出现，换个粒度就没有它', () => {
    const modifiers = [
      modifier({ id: 'buffered-one', frameMode: 'buffered' }),
      modifier({ id: 'frame-one', frameMode: 'frame' }),
    ]

    expect(ids(modifiers, 'buffered')).toEqual(['buffered-one'])
    expect(ids(modifiers, 'frame')).toEqual(['frame-one'])
    expect(ids(modifiers, 'skip')).toEqual([])
  })

  it('按 order 升序，同值保持注册顺序', () => {
    const modifiers = [
      modifier({ id: 'third', order: 30 }),
      modifier({ id: 'first-a', order: 10 }),
      modifier({ id: 'first-b', order: 10 }),
      modifier({ id: 'second', order: 20 }),
    ]

    expect(ids(modifiers)).toEqual(['first-a', 'first-b', 'second', 'third'])
  })

  it('不改动传入的数组（原地排序会污染注册表）', () => {
    const modifiers = [
      modifier({ id: 'later', order: 20 }),
      modifier({ id: 'earlier', order: 10 }),
    ]

    ids(modifiers)

    expect(modifiers.map(item => item.id)).toEqual(['later', 'earlier'])
  })

  it('scope 里没写的传输形态被挡掉，写了的放行', () => {
    const modifiers = [
      modifier({ id: 'whole-only', scope: { shapes: ['whole'] } }),
      modifier({ id: 'stream-only', scope: { shapes: ['incremental'] } }),
      modifier({ id: 'unscoped' }),
    ]

    expect(ids(modifiers)).toEqual(['whole-only', 'unscoped'])
    expect(ids(modifiers, 'frame', context({ transport: 'http-stream' }))).toEqual(['stream-only', 'unscoped'])
  })

  it('`scope.shapes` 与 `scope.transports` 是两条轴，同时写就必须同时满足', () => {
    const scope: ModifierScope = { transports: ['http'], shapes: ['whole'] }
    const modifiers = [modifier({ id: 'both', scope })]

    expect(ids(modifiers, 'frame', context({ transport: 'http' }))).toEqual(['both'])
    // http-stream 的形态是 incremental，两条轴中有一条不满足就不选。
    expect(ids(modifiers, 'frame', context({ transport: 'http-stream' }))).toEqual([])
  })

  it('WebSocket 的形态是 duplex：只声明 whole 的响应改写规则不参与', () => {
    const modifiers = [
      modifier({ id: 'whole-only', scope: { shapes: ['whole'] } }),
      modifier({ id: 'duplex-only', scope: { shapes: ['duplex'] } }),
    ]

    expect(ids(modifiers, 'frame', context({ transport: 'websocket' }))).toEqual(['duplex-only'])
  })

  it('筛选用的是客户端跳的形态，不是上游跳（上游怎么连是规划器的决定）', () => {
    const modifiers = [modifier({ id: 'whole-only', scope: { shapes: ['whole'] } })]

    expect(ids(modifiers, 'frame', context({ transport: 'http' }))).toEqual(['whole-only'])
  })
})

describe('matchesModifierScope', () => {
  it('没有 scope 就是不限', () => {
    expect(matchesModifierScope(undefined, context())).toBe(true)
  })

  it('空 scope 对象也不限（两条轴都省略）', () => {
    expect(matchesModifierScope({}, context())).toBe(true)
  })

  it('transports 命中才放行', () => {
    expect(matchesModifierScope({ transports: ['http', 'http-stream'] }, context({ transport: 'http' }))).toBe(true)
    expect(matchesModifierScope({ transports: ['http-stream'] }, context({ transport: 'http' }))).toBe(false)
  })

  it('shapes 命中才放行', () => {
    expect(matchesModifierScope({ shapes: ['whole'] }, context({ transport: 'http' }))).toBe(true)
    expect(matchesModifierScope({ shapes: ['incremental'] }, context({ transport: 'http' }))).toBe(false)
  })
})
