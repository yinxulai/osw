import { describe, expect, it } from 'vitest'
import { abbreviateIdentifier, requestIdentityOf } from './request-identity'

/**
 * 「这条请求的编号」写谁。
 *
 * 规则只有一条：拿得到上游的标识就用上游的，拿不到才用本地 `req_`。
 * 本地 id 只在本进程有意义，用户拿它去问上游时对方一无所知。
 */
describe('requestIdentityOf', () => {
  it('prefers the id the upstream assigned to this attempt', () => {
    expect(requestIdentityOf({ upstreamRequestId: 'msg_01ABC' }, 'req_local')).toEqual({
      value: 'msg_01ABC',
      fromUpstream: true,
    })
  })

  it('falls back to the local id when the upstream never sent one', () => {
    // 不能留空：这串编号还是「查看运行日志」的关联键。
    expect(requestIdentityOf({ upstreamRequestId: null }, 'req_local')).toEqual({
      value: 'req_local',
      fromUpstream: false,
    })
  })

  it('falls back when no attempt exists at all', () => {
    // 还没选中落点、或请求在路由阶段就失败：一次尝试都没有。
    expect(requestIdentityOf(null, 'req_local')).toEqual({ value: 'req_local', fromUpstream: false })
  })

  it('treats a blank header value as missing', () => {
    // 有些上游会回一个空字符串的 `x-request-id`；展示一枚空编号比本地 id 更糟。
    expect(requestIdentityOf({ upstreamRequestId: '   ' }, 'req_local')).toEqual({
      value: 'req_local',
      fromUpstream: false,
    })
  })

  it('trims what the upstream sent', () => {
    expect(requestIdentityOf({ upstreamRequestId: ' abc-1 ' }, 'req_local').value).toBe('abc-1')
  })
})

/**
 * 长编号的省略展示。
 *
 * 只影响「看到的」，不影响「复制的」：复制值始终是原文，省略号纯粹为了排版。
 */
describe('abbreviateIdentifier', () => {
  it('leaves short ids untouched', () => {
    expect(abbreviateIdentifier('msg_01ABC')).toBe('msg_01ABC')
    expect(abbreviateIdentifier('req_2f1c8a9d')).toBe('req_2f1c8a9d')
  })

  it('keeps the head and the tail once it overflows', () => {
    const long = '021793429283122f3d3e58bfdffea9769710a7767b276c34eec1a'
    expect(abbreviateIdentifier(long)).toBe('02179342…c34eec1a')
  })

  it('does not abbreviate at the threshold', () => {
    // 刚好装得下时省不出几个字符，加个省略号只是多一处噪声。
    const atLimit = 'a'.repeat(20)
    expect(abbreviateIdentifier(atLimit)).toBe(atLimit)
    expect(abbreviateIdentifier(`${atLimit}a`)).toBe(`${'a'.repeat(8)}…${'a'.repeat(8)}`)
  })
})
