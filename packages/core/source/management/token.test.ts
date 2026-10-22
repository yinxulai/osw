import { describe, expect, it } from 'vitest'
import { MANAGEMENT_TOKEN_HEADER, generateManagementToken } from './token'

/*
 * 只测生成器。凭证已经没有“存取”这回事了：生成归宿主，落盘与清理归 `token-file.ts`，
 * 本模块只负责随机性、长度与请求头名。所以这里能断言的只有「它长什么样」与「两次不一样」。
 */

describe('generateManagementToken', () => {
  it('生成 32 字节的 base64url：43 个字符', () => {
    // 长度是硬约束：43 字符 = 256 bit，且 base64url 不需要转义就能放进头部与 JSON 字符串。
    expect(generateManagementToken()).toHaveLength(43)
  })

  it('只由 base64url 字符组成', () => {
    // 含 `+` `/` `=` 的话，塞进 `x-osw-token` 或 JSON 字符串都要额外编码，
    // 而那时出问题的位置离这里很远。
    expect(generateManagementToken()).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('每次都不同', () => {
    // 同一个值出现两次就说明熵源没接上（例如恒回一个固定字符串），
    // 而那会让「页面猜不到」这个前提直接失效。
    const tokens = new Set(Array.from({ length: 64 }, () => generateManagementToken()))
    expect(tokens.size).toBe(64)
  })

  it('头部名带前缀，避免与别的 X-* 头撞车', () => {
    expect(MANAGEMENT_TOKEN_HEADER).toBe('x-osw-token')
  })
})
