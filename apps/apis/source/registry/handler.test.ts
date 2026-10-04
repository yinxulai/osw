import { describe, expect, it, vi } from 'vitest'
import type { SharedRewriteRule, SharedRewriteRuleListInput, SharedRewriteRulePayload } from '@common/shared-rewrite-rules'
import { SHARED_REWRITE_RULES_PATH } from '@common/shared-rewrite-rules'
import { createRegistryHandler } from './handler'
import type { D1DatabaseLike } from './d1'
import type { SharedRuleStore } from './store'

const NOW = 1_700_000_000_000

/**
 * 内存存储：与真实 D1 实现同一份接口（`SharedRuleStore`）。
 *
 * 这几条用例要验的是**目录这一层的行为**——路由、方法、配置、校验、以及「发布幂等、用一次
 * 计数 +1」——而不是 SQL 本身。SQL 是存储层的事（真跑起来要靠 D1）。把存储换成这个，用例就
 * 与表结构解耦：改 schema 不会动它们。
 */
function createMemoryStore() {
  const rows = new Map<string, SharedRewriteRule>()
  const store: SharedRuleStore = {
    async publish(id, payload, _searchText, now) {
      const existing = rows.get(id)
      const rule: SharedRewriteRule = existing
        ? { ...payload, id, usageCount: existing.usageCount, createdTime: existing.createdTime, updatedTime: now }
        : { ...payload, id, usageCount: 0, createdTime: now, updatedTime: now }
      rows.set(id, rule)
      return rule
    },
    async get(id) {
      return rows.get(id) ?? null
    },
    async list(input: SharedRewriteRuleListInput) {
      const all = [...rows.values()]
      const sorted = all.sort((left, right) =>
        input.sort === 'recent' ? right.updatedTime - left.updatedTime : right.usageCount - left.usageCount)
      return { rules: sorted.slice(input.offset, input.offset + input.limit), total: all.length }
    },
    async incrementUsage(id, now) {
      const existing = rows.get(id)
      if (existing === undefined) return null
      const rule = { ...existing, usageCount: existing.usageCount + 1, updatedTime: now }
      rows.set(id, rule)
      return rule
    },
  }
  return { store, rows }
}

/** 一个不会被调用的 D1 占位；handler 只检查它是不是 `undefined`。 */
const DB_STUB = {} as D1DatabaseLike

interface CallOptions {
  action: string
  body?: unknown
  method?: string
  contentType?: string | null
}

async function call(handler: ReturnType<typeof createRegistryHandler>, options: CallOptions): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {}
  const contentType = options.contentType === undefined ? 'application/json' : options.contentType
  if (contentType !== null) headers['content-type'] = contentType
  const method = options.method ?? 'POST'
  const request = new Request(`https://api.osw.yinxulai.com${SHARED_REWRITE_RULES_PATH}/${options.action}`, {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(options.body ?? {}) : undefined,
  })
  const response = await handler(request, `${SHARED_REWRITE_RULES_PATH}/${options.action}`, { SHARED_RULES_DB: DB_STUB }, NOW)
  return { status: response.status, body: await response.json() }
}

function payload(overrides: Partial<SharedRewriteRulePayload> = {}): SharedRewriteRulePayload {
  return {
    name: 'Example rule',
    description: '',
    scope: 'model',
    schemaVersion: 1,
    match: { clientProtocols: [], upstreamProtocols: [] },
    actions: [{ type: 'header-set', name: 'User-Agent', value: 'OSW', stage: 'request' }],
    testCases: [],
    ...overrides,
  }
}

function handlerWith(store: SharedRuleStore) {
  return createRegistryHandler(() => store)
}

describe('registry handler — routing & method', () => {
  it('非 POST 一律 405，并在 allow 头里回 POST', async () => {
    const { store } = createMemoryStore()
    const handler = handlerWith(store)
    const request = new Request(`https://api.osw.yinxulai.com${SHARED_REWRITE_RULES_PATH}/list`, { method: 'GET' })
    const response = await handler(request, `${SHARED_REWRITE_RULES_PATH}/list`, { SHARED_RULES_DB: DB_STUB })
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
  })

  it('未知子路径回 404', async () => {
    const { store } = createMemoryStore()
    const result = await call(handlerWith(store), { action: 'nope' })
    expect(result.status).toBe(404)
    expect(result.body.error).toBe('not_found')
  })

  it('非 JSON 的 Content-Type 回 415', async () => {
    const { store } = createMemoryStore()
    const result = await call(handlerWith(store), { action: 'list', contentType: 'text/plain' })
    expect(result.status).toBe(415)
  })

  it('缺 Content-Type 回 415', async () => {
    const { store } = createMemoryStore()
    const result = await call(handlerWith(store), { action: 'list', contentType: null })
    expect(result.status).toBe(415)
  })

  it('非法 JSON 回 400', async () => {
    const { store } = createMemoryStore()
    const handler = handlerWith(store)
    const request = new Request(`https://api.osw.yinxulai.com${SHARED_REWRITE_RULES_PATH}/list`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    const response = await handler(request, `${SHARED_REWRITE_RULES_PATH}/list`, { SHARED_RULES_DB: DB_STUB })
    expect(response.status).toBe(400)
    expect((await response.json() as { error: string }).error).toBe('invalid_json')
  })
})

describe('registry handler — not_configured', () => {
  it('缺 D1 绑定时回 500 not_configured，并点名缺的是哪一项', async () => {
    const { store } = createMemoryStore()
    const handler = handlerWith(store)
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    const request = new Request(`https://api.osw.yinxulai.com${SHARED_REWRITE_RULES_PATH}/list`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    const response = await handler(request, `${SHARED_REWRITE_RULES_PATH}/list`, {})
    expect(response.status).toBe(500)
    expect((await response.json() as { error: string }).error).toBe('not_configured')
    expect(warn.mock.calls.flat().join(' ')).toContain('SHARED_RULES_DB')
    warn.mockRestore()
  })
})

describe('registry handler — publish is idempotent', () => {
  it('发布一条后可以被取回', async () => {
    const { store } = createMemoryStore()
    const handler = handlerWith(store)
    const published = await call(handler, { action: 'publish', body: { rule: payload() } })
    expect(published.status).toBe(200)

    const id = published.body.rule.id as string
    const fetched = await call(handler, { action: 'get', body: { id } })
    expect(fetched.status).toBe(200)
    expect(fetched.body.rule.name).toBe('Example rule')
  })

  it('同一份内容发布两次只留一条，且用量不被清零', async () => {
    const { store, rows } = createMemoryStore()
    const handler = handlerWith(store)
    const first = await call(handler, { action: 'publish', body: { rule: payload() } })
    const id = first.body.rule.id as string

    await call(handler, { action: 'use', body: { id } })
    const republished = await call(handler, { action: 'publish', body: { rule: payload() } })

    expect(republished.body.rule.id).toBe(id)
    expect(rows.size).toBe(1)
    expect(republished.body.rule.usageCount).toBe(1)
  })

  it('响应阶段的动作被拒绝，不入库', async () => {
    const { store, rows } = createMemoryStore()
    const result = await call(handlerWith(store), {
      action: 'publish',
      body: { rule: payload({ actions: [{ type: 'header-set', name: 'A', value: 'B', stage: 'response' }] }) },
    })
    expect(result.status).toBe(400)
    expect(result.body.error).toBe('response_stage_disabled')
    expect(rows.size).toBe(0)
  })
})

describe('registry handler — ranking', () => {
  it('用一次计数 +1', async () => {
    const { store } = createMemoryStore()
    const handler = handlerWith(store)
    const published = await call(handler, { action: 'publish', body: { rule: payload() } })
    const id = published.body.rule.id as string

    const used = await call(handler, { action: 'use', body: { id } })
    expect(used.status).toBe(200)
    expect(used.body.rule.usageCount).toBe(1)

    const again = await call(handler, { action: 'use', body: { id } })
    expect(again.body.rule.usageCount).toBe(2)
  })

  it('用一条不存在的规则回 404', async () => {
    const { store } = createMemoryStore()
    const result = await call(handlerWith(store), { action: 'use', body: { id: 'sha256:missing' } })
    expect(result.status).toBe(404)
    expect(result.body.error).toBe('rule_not_found')
  })

  it('列表默认按热度排序', async () => {
    const { store } = createMemoryStore()
    const handler = handlerWith(store)
    const cold = await call(handler, { action: 'publish', body: { rule: payload({ name: 'Cold' }) } })
    const hot = await call(handler, { action: 'publish', body: { rule: payload({ name: 'Hot' }) } })
    await call(handler, { action: 'use', body: { id: hot.body.rule.id } })

    const listed = await call(handler, { action: 'list', body: {} })
    expect(listed.status).toBe(200)
    expect(listed.body.rules[0].name).toBe('Hot')
    expect(listed.body.rules[1].name).toBe('Cold')
    expect(listed.body.total).toBe(2)
    expect(listed.body.limit).toBe(30)
    expect(cold.body.rule.id).toBeTruthy()
  })

  it('取一条不存在回 404', async () => {
    const { store } = createMemoryStore()
    const result = await call(handlerWith(store), { action: 'get', body: { id: 'sha256:none' } })
    expect(result.status).toBe(404)
    expect(result.body.error).toBe('rule_not_found')
  })

  it('非法列表参数回 400', async () => {
    const { store } = createMemoryStore()
    const result = await call(handlerWith(store), { action: 'list', body: { limit: 1000 } })
    expect(result.status).toBe(400)
    expect(result.body.error).toBe('invalid_payload')
  })

  it('非法发布载荷回 400', async () => {
    const { store } = createMemoryStore()
    const result = await call(handlerWith(store), { action: 'publish', body: { rule: { name: '', actions: [] } } })
    expect(result.status).toBe(400)
    expect(result.body.error).toBe('invalid_payload')
  })
})
