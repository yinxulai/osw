/**
 * 共享重写规则目录的 HTTP 层（`/v1/rules/*`）。
 *
 * 与遥测端点（`source/index.ts`）**共用同一个 Worker、同一个域名、同一套日志与状态码约定**，
 * 但是两件独立的事：遥测是「收下一批就转发走」的追加流，目录是「一份可以被读、被写、被计数」
 * 的小型存储。所以它们是两条路由、两个 handler，只在入口处汇合。
 *
 * ## 四条路径
 *
 * | 路径 | 动作 | 幂等 | 计数 |
 * | --- | --- | --- | --- |
 * | `POST /v1/rules/list` | 按热度或时间取一页 | 是 | 不动 |
 * | `POST /v1/rules/get` | 取一条 | 是 | 不动 |
 * | `POST /v1/rules/publish` | 发布（或重新发布）一条 | 是 | 不动 |
 * | `POST /v1/rules/use` | 用一条 | 是 | +1 |
 *
 * 全部是 `POST`：带正文的查询也是查询，但它在这里统一成一种方法，客户端与服务端之间就少一条
 * 「哪些是 GET、哪些是 POST」的约定。四条路径都被同一份 schema 校验，没有一条能吃原始 HTTP。
 *
 * ## 「用一次」才计数，列表不算
 *
 * 浏览与搜索**不动**计数：那样一条规则只要被刷到就会涨分，热度会变成「谁被刷得多」。
 * 只有真正的「把它拷进我的规则库」才 +1——那正是「使用量排名」里「使用」二字的意思。
 *
 * ## 缺配置时的样子
 *
 * 与遥测的 `not_configured` 同源：没绑定 D1 就是一次明确的 500，日志里点名缺的是
 * `SHARED_RULES_DB`。**绝不退化成一个空目录**——一个看起来正常、却永远空的目录会让客户端
 * 以为「还没人发布过」，而那与「这个部署根本没接数据库」是两件完全不同的事。
 */

import {
  SHARED_REWRITE_RULES_MAX_REQUEST_BYTES,
  SharedRewriteRuleGetInputSchema,
  SharedRewriteRuleListInputSchema,
  SharedRewriteRulePublishInputSchema,
  SharedRewriteRuleUseInputSchema,
  sharedRewriteRuleDisabledReason,
} from '@common/shared-rewrite-rules'
import { logOutcome } from '../log'
import type { D1DatabaseLike } from './d1'
import { searchTextOf, signatureOf } from './signature'
import { createSharedRuleStore, type SharedRuleStore } from './store'

/** 目录的绑定：只有一项，就是它自己的库。 */
export interface SharedRulesEnv {
  SHARED_RULES_DB?: D1DatabaseLike
}

/** 造一个存储。默认用 D1；测试换成内存实现（见 `handler.test.ts`）。 */
export type StoreFactory = (db: D1DatabaseLike) => SharedRuleStore

/** 好让 `index.ts` 把两类绑定合成一个 Worker 环境。 */
export type RegistryHandler = (request: Request, path: string, env: SharedRulesEnv, now?: number) => Promise<Response>

/**
 * 造一个目录 handler。
 *
 * 与遥测 handler 一样是工厂：测试要换的是**存储**（塞一个内存实现），不是整条链路。
 * 部署时用文件末尾那个默认实例。
 */
export function createRegistryHandler(createStore: StoreFactory = createSharedRuleStore): RegistryHandler {
  return async function handle(request, path, env, now = Date.now()) {
    if (request.method !== 'POST') return methodNotAllowed('POST')

    if (env.SHARED_RULES_DB === undefined) {
      // 全目录唯一的 500，原因也只有一个：D1 没绑上。点名缺的是哪一项，是这一行存在的全部意义。
      logOutcome(500, 'not_configured', { missing: 'SHARED_RULES_DB' })
      return json(500, { ok: false, error: 'not_configured' })
    }
    const store = createStore(env.SHARED_RULES_DB)

    const contentType = request.headers.get('content-type')
    if (contentType === null || !contentType.toLowerCase().startsWith('application/json')) {
      logOutcome(415, 'unsupported_media_type', { content_type: contentType ?? '<none>' })
      return json(415, { ok: false, error: 'unsupported_media_type' })
    }

    const text = await request.text()
    const size = byteLength(text)
    if (size > SHARED_REWRITE_RULES_MAX_REQUEST_BYTES) {
      logOutcome(413, 'payload_too_large', { bytes: size, limit: SHARED_REWRITE_RULES_MAX_REQUEST_BYTES })
      return json(413, { ok: false, error: 'payload_too_large' })
    }

    const payload = parseJson(text)
    if (payload === null) {
      logOutcome(400, 'invalid_json', { bytes: size })
      return json(400, { ok: false, error: 'invalid_json' })
    }

    const action = path.slice(path.lastIndexOf('/') + 1)
    switch (action) {
      case 'list': return listRules(store, payload)
      case 'get': return getRule(store, payload)
      case 'publish': return publishRule(store, payload, now)
      case 'use': return useRule(store, payload, now)
      default: {
        logOutcome(404, 'not_found', { path })
        return json(404, { ok: false, error: 'not_found' })
      }
    }
  }
}

async function listRules(store: SharedRuleStore, body: unknown): Promise<Response> {
  const parsed = SharedRewriteRuleListInputSchema.safeParse(body)
  if (!parsed.success) return invalidPayload(parsed.error.issues[0])
  const { rules, total } = await store.list(parsed.data)
  return json(200, { ok: true, rules, total, limit: parsed.data.limit, offset: parsed.data.offset })
}

async function getRule(store: SharedRuleStore, body: unknown): Promise<Response> {
  const parsed = SharedRewriteRuleGetInputSchema.safeParse(body)
  if (!parsed.success) return invalidPayload(parsed.error.issues[0])
  const rule = await store.get(parsed.data.id)
  if (rule === null) {
    logOutcome(404, 'rule_not_found', { id: parsed.data.id })
    return json(404, { ok: false, error: 'rule_not_found' })
  }
  return json(200, { ok: true, rule })
}

async function publishRule(store: SharedRuleStore, body: unknown, now: number): Promise<Response> {
  const parsed = SharedRewriteRulePublishInputSchema.safeParse(body)
  if (!parsed.success) return invalidPayload(parsed.error.issues[0])

  // 响应阶段在这里挡一道，与本机保存 / 试跑用同一道闸门（见契约的 `sharedRewriteRuleDisabledReason`）：
  // 能发布却装不回来的规则比目录里没有这条规则更糟。
  const disabled = sharedRewriteRuleDisabledReason(parsed.data.rule)
  if (disabled !== null) {
    logOutcome(400, 'response_stage_disabled', {})
    return json(400, { ok: false, error: 'response_stage_disabled', message: disabled })
  }

  const { id, payload } = await signatureOf(parsed.data.rule)
  const rule = await store.publish(id, payload, searchTextOf(payload), now)
  // 2xx 也留一行：发布是**低频写**（不是遥测那种按安装数增长的流），值得在日志里看得见，
  // 而且它回答了运维唯一想知道的那件事——目录在真的被人写。
  console.log(`[apis] status=200 action=publish id=${id}`)
  return json(200, { ok: true, rule })
}

async function useRule(store: SharedRuleStore, body: unknown, now: number): Promise<Response> {
  const parsed = SharedRewriteRuleUseInputSchema.safeParse(body)
  if (!parsed.success) return invalidPayload(parsed.error.issues[0])
  const rule = await store.incrementUsage(parsed.data.id, now)
  if (rule === null) {
    logOutcome(404, 'rule_not_found', { id: parsed.data.id })
    return json(404, { ok: false, error: 'rule_not_found' })
  }
  return json(200, { ok: true, rule })
}

/** 一条校验问题的形状（取 `safeParse` 失败时的首条 issue）。 */
interface ValidationIssue {
  path: (string | number)[]
  message: string
}

function invalidPayload(issue: ValidationIssue | undefined): Response {
  const detail = `${issue?.path.join('.') || '<root>'}: ${issue?.message ?? 'invalid'}`
  logOutcome(400, 'invalid_payload', { issue: detail })
  return json(400, { ok: false, error: 'invalid_payload' })
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function methodNotAllowed(allow: string): Response {
  logOutcome(405, 'method_not_allowed', { allow })
  return new Response(null, { status: 405, headers: { allow } })
}
