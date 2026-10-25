import { describe, expect, it } from 'vitest'
import type { ApiKey, ApiKeyUsageRecency } from '@common/schemas'
import { buildApiKeyRows } from './rows'

/*
 * Key 列表与活跃度的拼接。
 *
 * 两份数据来自两个库，最容易被忽略的是「对不上」：一把刚签发、一次都没用过的 Key 在观测库里
 * 根本没有记录。这时候必须显示「从未使用」而不是整行消失——那是用户在新建之后看到的第一个画面。
 * 反过来，活跃度里可能还留着一把已删除 Key 的记录，它也不该多造出一行。
 */

function keyOf(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'ak_1',
    name: 'Alpha',
    enabled: true,
    keyReference: 'ref_1',
    expiresTime: null,
    createdTime: 1_000,
    updatedTime: 1_000,
    deletedTime: null,
    ...overrides,
  }
}

function recencyOf(overrides: Partial<ApiKeyUsageRecency> = {}): ApiKeyUsageRecency {
  return { apiKeyId: 'ak_1', lastUsedTime: 5_000, recentRequests: 12, ...overrides }
}

function mapOf(...rows: ApiKeyUsageRecency[]): Map<string, ApiKeyUsageRecency> {
  return new Map(rows.map(row => [row.apiKeyId, row]))
}

describe('buildApiKeyRows', () => {
  it('把活跃度挂到对应的 Key 上', () => {
    const [row] = buildApiKeyRows([keyOf()], mapOf(recencyOf()), 10_000)
    expect(row.lastUsedTime).toBe(5_000)
    expect(row.recentRequests).toBe(12)
  })

  it('从未使用过的 Key 仍然在列表里，读作「从未使用」与 0 次', () => {
    const rows = buildApiKeyRows([keyOf({ id: 'ak_new' })], mapOf(recencyOf()), 10_000)
    expect(rows).toHaveLength(1)
    expect(rows[0].lastUsedTime).toBeNull()
    expect(rows[0].recentRequests).toBe(0)
  })

  it('活跃度里残留的已删除 Key 不会凭空多出一行', () => {
    const rows = buildApiKeyRows([keyOf()], mapOf(recencyOf(), recencyOf({ apiKeyId: 'ak_gone' })), 10_000)
    expect(rows.map(row => row.id)).toEqual(['ak_1'])
  })

  it('列表顺序保持配置库给的原序（排序是界面的事，不是拼接的事）', () => {
    const rows = buildApiKeyRows(
      [keyOf({ id: 'ak_b' }), keyOf({ id: 'ak_a' })],
      mapOf(recencyOf({ apiKeyId: 'ak_a' }), recencyOf({ apiKeyId: 'ak_b' })),
      10_000,
    )
    expect(rows.map(row => row.id)).toEqual(['ak_b', 'ak_a'])
  })

  it('状态按传入的「现在」推导：过了过期时间就是已过期，哪怕它仍然启用', () => {
    const [expired] = buildApiKeyRows([keyOf({ expiresTime: 9_000 })], mapOf(), 10_000)
    expect(expired.status).toBe('expired')
    const [disabled] = buildApiKeyRows([keyOf({ enabled: false })], mapOf(), 10_000)
    expect(disabled.status).toBe('disabled')
    const [enabled] = buildApiKeyRows([keyOf()], mapOf(), 10_000)
    expect(enabled.status).toBe('enabled')
  })
})
