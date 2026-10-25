import { describe, expect, it } from 'vitest'
import type { ApiKey, ApiKeyStat } from '@common/schemas'
import type { AppTranslator } from '@/i18n/provider'
import { buildApiKeyUsageRows } from './api-key-usage-rows'

/*
 * 「额度花在谁身上」这张表的命名口径。
 *
 * Key 是**软删除**：删掉之后行还在、名字也还在，统计里的历史用量依然指向它。
 * 所以这里最重要的是两条不能混为一谈的事：
 *
 * 1. 未跟踪（`apiKeyId === null`）—— 请求当时根本没带 Key，没有名字可言。
 * 2. 已删除 —— 有名字，只是那把 Key 现在不在活跃列表里。
 *
 * 早期实现把第 2 种退化成了「已删除的 Key」这句占位文案，等于把历史事实丢掉了。
 */

const labels: Record<string, string> = {
  'apiKeys.label.anonymous': '未跟踪',
  'apiKeys.label.unknown': '已删除的 Key',
}

/** 只需要 `t` 的翻译目录，其余 API 不在这个纯函数的射程内。 */
const t = ((key: string) => labels[key] ?? key) as unknown as AppTranslator

function stat(overrides: Partial<ApiKeyStat> & Pick<ApiKeyStat, 'apiKeyId'>): ApiKeyStat {
  return {
    requests: 10,
    success: 9,
    failed: 1,
    totalTokens: 1_000,
    avgLatencyMs: 120,
    ...overrides,
  }
}

function key(overrides: Partial<ApiKey> & Pick<ApiKey, 'id' | 'name'>): ApiKey {
  return {
    enabled: true,
    keyReference: 'key_ref',
    expiresTime: null,
    createdTime: 1,
    updatedTime: 1,
    deletedTime: null,
    ...overrides,
  }
}

describe('buildApiKeyUsageRows', () => {
  it('未跟踪的行没有名字，也不带删除标记', () => {
    const [row] = buildApiKeyUsageRows([stat({ apiKeyId: null })], [], t)
    expect(row.name).toBe('未跟踪')
    expect(row.deleted).toBe(false)
  })

  it('活跃 Key 按 id 反查出当前名字', () => {
    const keys = [key({ id: 'ak_1', name: '笔记本上的 Cursor' })]
    const [row] = buildApiKeyUsageRows([stat({ apiKeyId: 'ak_1' })], keys, t)
    expect(row.name).toBe('笔记本上的 Cursor')
    expect(row.deleted).toBe(false)
  })

  it('软删除的 Key 保留真实名字，只标出已删除', () => {
    const keys = [key({ id: 'ak_gone', name: '旧笔记本', deletedTime: 1_700_000_000_000 })]
    const [row] = buildApiKeyUsageRows([stat({ apiKeyId: 'ak_gone' })], keys, t)
    expect(row.name).toBe('旧笔记本')
    expect(row.deleted).toBe(true)
  })

  it('记录指向的 Key 真的不存在时才退回占位文案', () => {
    const [row] = buildApiKeyUsageRows([stat({ apiKeyId: 'ak_missing' })], [], t)
    expect(row.name).toBe('已删除的 Key')
    expect(row.deleted).toBe(false)
  })

  it('没有样本时两个比率为 null，不是 0', () => {
    const [row] = buildApiKeyUsageRows([stat({ apiKeyId: null, requests: 0, success: 0 })], [], t)
    expect(row.successRate).toBeNull()
    expect(row.avgLatencyMs).toBeNull()
  })
})
