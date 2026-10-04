/**
 * 目录的存储层：把「一条规则」翻译成 `shared_rewrite_rules` 表上的一行，再翻译回来。
 *
 * 这一层是**唯一**写 SQL 的地方（表结构见 `apps/apis/schema.sql`）。它只接受已经校验过的
 * 载荷与已经算好的签名——校验与签名在 `signature.ts`，路由与状态码在 `handler.ts`。
 * 三条职责各在一个文件里，任何一个都不需要知道另外两个在做什么。
 *
 * ## 幂等发布
 *
 * `publish` 用 `INSERT ... ON CONFLICT(id) DO UPDATE`：
 *
 * - 第一次发布 → 插入，`usage_count` 从 0 开始；
 * - 再次发布同一份内容 → **只更新 `updated_time` 与派生的搜索文本**，`usage_count` 与
 *   `created_time` 原样不动。
 *
 * 最后那句「用量与资历不动」是刻意的：一条规则被十个人各发一遍，它的排名不该因此归零或翻倍
 * ——被用的次数是独立于被发布次数的一件事。
 *
 * ## 为什么排序、分页、搜索都在 SQL 里
 *
 * 因为热度的意义就在于「不需要把整张表读进来再算」。`ORDER BY usage_count DESC` 走
 * `idx_shared_rewrite_rules_usage`，`LIKE` 搜索落在派生列上。把规则全拉回内存再排序，
 * 在目录变大之后就是一次全表传输——而那正是目录不该有的形态。
 */

import type { SharedRewriteRule, SharedRewriteRuleListInput, SharedRewriteRulePayload, SharedRewriteRuleSort } from '@common/shared-rewrite-rules'
import type { D1DatabaseLike } from './d1'

/** 表里一行。列名与 `schema.sql` 一一对应。 */
interface RuleRow {
  id: string
  payload: string
  usage_count: number
  created_time: number
  updated_time: number
}

/**
 * 存储接口。**接口而不是直接吃 `D1Database`**：测试塞一个内存实现即可，不必起 D1；
 * 也让「目录依赖存储的哪几个动作」在签名上一眼可见。
 */
export interface SharedRuleStore {
  /** 幂等发布：同签名只留一条，用量与创建时间不因重新发布而改变。返回落库后的那一条。 */
  publish(id: string, payload: SharedRewriteRulePayload, searchText: string, now: number): Promise<SharedRewriteRule>
  /** 按 id 取一条，不存在返回 `null`。 */
  get(id: string): Promise<SharedRewriteRule | null>
  /** 按筛选与排序取一页，外加满足条件的总数。 */
  list(input: SharedRewriteRuleListInput): Promise<{ rules: SharedRewriteRule[]; total: number }>
  /** 用量 +1，并刷新 `updated_time`。返回落库后的那一条；id 不存在返回 `null`。 */
  incrementUsage(id: string, now: number): Promise<SharedRewriteRule | null>
}

function rowToRule(row: RuleRow): SharedRewriteRule {
  return {
    ...(JSON.parse(row.payload) as SharedRewriteRulePayload),
    id: row.id,
    usageCount: row.usage_count,
    createdTime: row.created_time,
    updatedTime: row.updated_time,
  }
}

function orderBy(sort: SharedRewriteRuleSort): string {
  // 两个排序都带 updated_time 作为 tie-breaker：用量/时间相同的行若没有第二把钥匙，
  // 分页就可能在不同请求之间给出不稳定的顺序，翻页时会漏掉或重复。
  return sort === 'recent'
    ? 'ORDER BY updated_time DESC, id DESC'
    : 'ORDER BY usage_count DESC, updated_time DESC, id DESC'
}

export function createSharedRuleStore(db: D1DatabaseLike): SharedRuleStore {
  return {
    async publish(id, payload, searchText, now) {
      await db.prepare(
        `INSERT INTO shared_rewrite_rules (id, payload, search_text, usage_count, created_time, updated_time)
         VALUES (?, ?, ?, 0, ?, ?)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, search_text = excluded.search_text, updated_time = excluded.updated_time`,
      ).bind(id, JSON.stringify(payload), searchText, now, now).run()
      const row = await db.prepare('SELECT * FROM shared_rewrite_rules WHERE id = ?').bind(id).first<RuleRow>()
      if (row === null) throw new Error('shared rule vanished right after publish')
      return rowToRule(row)
    },

    async get(id) {
      const row = await db.prepare('SELECT * FROM shared_rewrite_rules WHERE id = ?').bind(id).first<RuleRow>()
      return row === null ? null : rowToRule(row)
    },

    async list(input) {
      // `LIKE` 的那一段只在有关键词时拼进 SQL：无关键词时不带 `WHERE`，让「列全部」走最直的路。
      const keyword = input.query.trim().toLowerCase().replace(/\s+/g, ' ')
      const where = keyword === '' ? '' : 'WHERE search_text LIKE ?'
      const filterArgs = keyword === '' ? [] : [`%${keyword}%`]

      const totalRow = await db.prepare(`SELECT COUNT(*) AS count FROM shared_rewrite_rules ${where}`)
        .bind(...filterArgs).first<{ count: number }>()

      const rows = await db.prepare(
        `SELECT * FROM shared_rewrite_rules ${where} ${orderBy(input.sort)} LIMIT ? OFFSET ?`,
      ).bind(...filterArgs, input.limit, input.offset).all<RuleRow>()

      return { rules: rows.results.map(rowToRule), total: totalRow?.count ?? 0 }
    },

    async incrementUsage(id, now) {
      // 先 `UPDATE` 再读回：`usage_count = usage_count + 1` 是一条原子自增，不经过先读后写的
      // 竞态窗口。返回受影响行数为 0 说明这个 id 根本不存在，据此回 404 而不是静默成功。
      const result = await db.prepare(
        'UPDATE shared_rewrite_rules SET usage_count = usage_count + 1, updated_time = ? WHERE id = ?',
      ).bind(now, id).run() as { meta?: { changes?: number } } | undefined
      if ((result?.meta?.changes ?? 0) === 0) return null
      const row = await db.prepare('SELECT * FROM shared_rewrite_rules WHERE id = ?').bind(id).first<RuleRow>()
      return row === null ? null : rowToRule(row)
    },
  }
}
