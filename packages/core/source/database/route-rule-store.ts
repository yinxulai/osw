import { desc, eq } from 'drizzle-orm'
import { generateId, now } from '@common/utils'
import {
  createDefaultRouteRuleSet,
  isSameRouteRuleSet,
  MAX_ROUTE_RULE_VERSIONS,
  RouteRuleSetSchema,
  UNSAVED_ROUTE_RULE_VERSION,
} from '@common/router/route-rules'
import type { RouteRuleSet, RouteRuleSetSaveResult, RouteRuleSetVersionSummary, RouteRuleSnapshot } from '@common/router/route-rules'
import { getConfigDb } from './index'
import { routeRuleSets, type RouteRuleSetRow } from './config-schema'
import { listLogicalModels } from './logical-model-store'

/**
 * 路由规则表只有一份真相，放在自己的 `route_rule_sets` 表里，一行一版、版本号单调递增。
 *
 * 规则表的生命周期与图**是同一套**：列表上改的是「正在编的这一份」，按下「保存」才生成一个
 * 可回滚的新版本，代理读的永远是「最近保存的那一版」；一版都没保存过时用内建默认表现场跑。
 * 让两边一致不是对称癖：一张按顺序读的清单同样会经过「拖到别的位置、条件还没填完、落点要换一换」
 * 这些中间状态，而列表上正在编的与正在生效的如果能是同一份，任何一个中间状态都直接落到线上请求上，
 * 用户连「我刚才那下算不算数」都没有一个自己按下去的时刻可以参照。
 *
 * **为什么不再和图共用 `workflows` 表**：两种定义挤在一个行空间里，`id` 就没法自证是图还是表，
 * 读一行要先问「它是谁」，版本号也只能靠 `type` 隔开。分开之后每张表各管各的，
 * 行里的 `id` 就是它的身份，云模式里单独分享一张规则表也只是搬几行出去的事。
 *
 * **一版都不删**：每一版都是用户可以回滚回去的历史。版本列表本来只展示最近若干版
 * （`MAX_ROUTE_RULE_VERSIONS`），超出部分不再列出即可，不需要真的把行删掉。
 */

/** 读取时的版本上限：列表只展示最近这么多版，更旧的留在库里。 */
export { MAX_ROUTE_RULE_VERSIONS }

type RouteRuleRecord = {
  id: string
  version: number
  name: string
  description: string
  ruleSet: RouteRuleSet
  updatedTime: number
}

function parseRow(row: RouteRuleSetRow): RouteRuleSet | null {
  let definition: unknown
  try {
    definition = JSON.parse(row.definition) as unknown
  } catch {
    return null
  }
  const parsed = RouteRuleSetSchema.safeParse(definition)
  return parsed.success ? parsed.data : null
}

function toSummary(record: RouteRuleRecord): RouteRuleSetVersionSummary {
  return {
    id: record.id,
    version: record.version,
    name: record.name,
    description: record.description,
    savedAt: record.updatedTime,
    ruleCount: record.ruleSet.rules.length,
  }
}

function toSnapshot(record: RouteRuleRecord): RouteRuleSnapshot {
  return { ruleSet: record.ruleSet, id: record.id, version: record.version, savedAt: record.updatedTime }
}

/** 全部行，版本号新的在前。 */
function listRows(): RouteRuleSetRow[] {
  return getConfigDb().select().from(routeRuleSets).orderBy(desc(routeRuleSets.version), desc(routeRuleSets.updatedTime)).all()
}

/** 记录 id 取一行。 */
function getRow(id: string): RouteRuleSetRow | undefined {
  return getConfigDb().select().from(routeRuleSets).where(eq(routeRuleSets.id, id)).get()
}

function toRecord(row: RouteRuleSetRow): RouteRuleRecord | null {
  const ruleSet = parseRow(row)
  if (!ruleSet) return null
  return {
    id: row.id,
    version: row.version,
    name: row.name,
    description: row.description,
    ruleSet,
    updatedTime: Number(row.updatedTime),
  }
}

/** 全部已保存版本，新的在前，最多列出 `MAX_ROUTE_RULE_VERSIONS` 版。损坏的版本直接跳过。 */
export async function listRouteRuleSetVersions(): Promise<RouteRuleSetVersionSummary[]> {
  const summaries: RouteRuleSetVersionSummary[] = []
  for (const row of listRows()) {
    const record = toRecord(row)
    if (record) summaries.push(toSummary(record))
    if (summaries.length >= MAX_ROUTE_RULE_VERSIONS) break
  }
  return summaries
}

/**
 * 最近保存的**可解析**那一版；一版都没保存过时返回 `null`。
 *
 * 这里刻意从头遍历而不是只取最新一行：一行损坏的规则表不应该让代理悄悄退回内建默认表，
 * 也不应该让列表里刚保存的那一版凭空消失。版本号仍然取真实的最新行（见 `saveRouteRuleSetVersion`），
 * 损坏的那一版只是读不出来。
 */
export async function readRouteRuleSnapshot(): Promise<RouteRuleSnapshot | null> {
  for (const row of listRows()) {
    const record = toRecord(row)
    if (record) return toSnapshot(record)
  }
  return null
}

/**
 * 按**记录 id** 读一版；id 不存在或内容损坏时返回 `null`。
 *
 * 认 id 而不是认版本号：本机数到第几版，在别人的库里对不上。云模式里分享/导入过来的一版
 * 只能靠 id 定位，版本号只是本地的展示编号。
 */
export async function readRouteRuleSetVersion(id: string): Promise<RouteRuleSnapshot | null> {
  const row = getRow(id)
  if (!row) return null
  const record = toRecord(row)
  return record ? toSnapshot(record) : null
}

/** 按版本号读一版；版本不存在或内容损坏时返回 `null`。给「恢复第几版」这类按展示编号来的入口用。 */
export async function readRouteRuleSetVersionByNumber(version: number): Promise<RouteRuleSnapshot | null> {
  const row = getConfigDb().select().from(routeRuleSets).where(eq(routeRuleSets.version, version)).get()
  if (!row) return null
  const record = toRecord(row)
  return record ? toSnapshot(record) : null
}

/**
 * 当前**生效**的规则表。
 *
 * 一版都没保存过时，用内建默认表当场生成一份（落点按当前逻辑模型定好）：
 * 「开箱可用」与「用户保存的表」因此走的是同一条执行路径。
 * 版本号留 `UNSAVED_ROUTE_RULE_VERSION` 表示这份表不来自任何已保存版本。
 */
export async function resolveRouteRuleSet(): Promise<RouteRuleSnapshot> {
  const saved = await readRouteRuleSnapshot()
  if (saved) return saved

  const ruleSet = createDefaultRouteRuleSet(await listLogicalModels())
  return { ruleSet, id: null, version: UNSAVED_ROUTE_RULE_VERSION, savedAt: 0 }
}

/**
 * 保存一版规则表。
 *
 * 内容与最新版本完全一致时不再新增版本，把最新版本号原样回给调用方：
 * 「保存」的语义是「留下一个可回滚的版本」，内容没变还存一版只会把版本列表灌满噪音。
 * 此时用户这次填的名字与说明也一并丢弃 —— 它们描述的是「这一次改动」，而这次并没有改动可描述。
 *
 * 名字与说明都是注记，可以留空（落库即空串）：**一版的身份是它的记录 id，版本号只是展示编号**。
 */
export async function saveRouteRuleSetVersion(ruleSet: RouteRuleSet, name: string | undefined, description: string | undefined): Promise<RouteRuleSetSaveResult> {
  const next = RouteRuleSetSchema.parse(ruleSet)
  // 版本号取自**原始最新行**（不看内容能不能解析）：展示编号的唯一要求是单调递增，
  // 一行读不出内容的历史数据不该把号码再发一次。内容比对则用可解析的最新一版，
  // 读不出来的那些行不参与「这次有没有改动」的判断。
  const latestRow = listRows()[0]
  const latest = latestRow ? toRecord(latestRow) : null
  if (latest && isSameRouteRuleSet(latest.ruleSet, next)) {
    return { ...toSummary(latest), created: false }
  }

  const time = now()
  const record: RouteRuleRecord = {
    id: generateId('route_'),
    version: latestRow ? latestRow.version + 1 : 1,
    name: name?.trim() ?? '',
    description: description?.trim() ?? '',
    ruleSet: next,
    updatedTime: time,
  }
  getConfigDb().insert(routeRuleSets).values({
    id: record.id,
    version: record.version,
    name: record.name,
    description: record.description,
    definition: JSON.stringify(next),
    createdTime: time,
    updatedTime: time,
  }).run()
  return { ...toSummary(record), created: true }
}
