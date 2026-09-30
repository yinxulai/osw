import { and, asc, eq, inArray, isNull, notInArray } from 'drizzle-orm'
import { RequestRewriteRuleSchema, ProviderModelRequestRewriteRuleSchema, type RequestRewriteRule, type ProviderModelRequestRewriteRule } from '@common/schemas'
import { generateId, now } from '@common/utils'
import { duplicateRequestRewriteRuleBindingError, resourceNotFoundError, translateSqliteUniqueViolation } from '../errors'
import { getConfigDb } from './index'
import { providerModelRequestRewriteRules, providerModels, requestRewriteRules } from './config-schema'

function parseRule(row: typeof requestRewriteRules.$inferSelect): RequestRewriteRule { return RequestRewriteRuleSchema.parse({ ...row, match: JSON.parse(row.match), actions: JSON.parse(row.actions), testCases: JSON.parse(row.testCases) }) }
function parseBinding(row: typeof providerModelRequestRewriteRules.$inferSelect): ProviderModelRequestRewriteRule { return ProviderModelRequestRewriteRuleSchema.parse({ ...row, ruleId: row.requestRewriteRuleId }) }

export async function listRequestRewriteRules(includeDeleted = false): Promise<RequestRewriteRule[]> {
  const rows = getConfigDb().select().from(requestRewriteRules).where(includeDeleted ? undefined : isNull(requestRewriteRules.deletedTime)).orderBy(asc(requestRewriteRules.name)).all()
  return rows.map(parseRule)
}
export async function listRequestRewriteRulesByIds(ids: string[]): Promise<RequestRewriteRule[]> {
  if (ids.length === 0) return []
  return getConfigDb().select().from(requestRewriteRules).where(inArray(requestRewriteRules.id, ids)).all().map(parseRule)
}
export async function getRequestRewriteRule(id: string): Promise<RequestRewriteRule | undefined> {
  const row = getConfigDb().select().from(requestRewriteRules).where(eq(requestRewriteRules.id, id)).get()
  return row ? parseRule(row) : undefined
}
export async function createRequestRewriteRule(input: Omit<RequestRewriteRule, 'id' | 'createdTime' | 'updatedTime' | 'deletedTime'>): Promise<RequestRewriteRule> {
  const time = now(); const rule = RequestRewriteRuleSchema.parse({ ...input, id: generateId('rule_'), createdTime: time, updatedTime: time, deletedTime: null })
  getConfigDb().insert(requestRewriteRules).values({ ...rule, match: JSON.stringify(rule.match), actions: JSON.stringify(rule.actions), testCases: JSON.stringify(rule.testCases) }).run(); return rule
}
export async function updateRequestRewriteRule(id: string, updates: Partial<Omit<RequestRewriteRule, 'id' | 'createdTime'>>): Promise<RequestRewriteRule> {
  const existing = await getRequestRewriteRule(id); if (!existing) throw resourceNotFoundError('request rewrite rule', id)
  const rule = RequestRewriteRuleSchema.parse({ ...existing, ...updates, id, updatedTime: now() })
  getConfigDb().update(requestRewriteRules).set({ name: rule.name, description: rule.description, enabled: rule.enabled, scope: rule.scope, schemaVersion: rule.schemaVersion, source: rule.source, match: JSON.stringify(rule.match), actions: JSON.stringify(rule.actions), testCases: JSON.stringify(rule.testCases), updatedTime: rule.updatedTime, deletedTime: rule.deletedTime }).where(eq(requestRewriteRules.id, id)).run(); return rule
}
export async function countProviderModelsUsingRule(ruleId: string): Promise<number> {
  return getConfigDb().select({ providerModelId: providerModelRequestRewriteRules.providerModelId }).from(providerModelRequestRewriteRules).where(and(eq(providerModelRequestRewriteRules.requestRewriteRuleId, ruleId), isNull(providerModelRequestRewriteRules.deletedTime))).all().length
}
export async function deleteRequestRewriteRule(id: string): Promise<{ id: string; affectedProviderModelCount: number }> {
  const affectedProviderModelCount = await countProviderModelsUsingRule(id)
  const updatedTime = now()
  getConfigDb().transaction(tx => {
    tx.update(providerModelRequestRewriteRules).set({ enabled: false, deletedTime: updatedTime, updatedTime }).where(and(eq(providerModelRequestRewriteRules.requestRewriteRuleId, id), isNull(providerModelRequestRewriteRules.deletedTime))).run()
    tx.update(requestRewriteRules).set({ enabled: false, deletedTime: updatedTime, updatedTime }).where(and(eq(requestRewriteRules.id, id), isNull(requestRewriteRules.deletedTime))).run()
  })
  return { id, affectedProviderModelCount }
}
export async function listProviderModelRequestRewriteRules(providerModelId: string): Promise<ProviderModelRequestRewriteRule[]> {
  return getConfigDb().select().from(providerModelRequestRewriteRules).where(and(eq(providerModelRequestRewriteRules.providerModelId, providerModelId), isNull(providerModelRequestRewriteRules.deletedTime))).orderBy(asc(providerModelRequestRewriteRules.priority)).all().map(parseBinding)
}
export async function replaceProviderModelRequestRewriteRuleBindings(providerModelId: string, bindings: Array<Pick<ProviderModelRequestRewriteRule, 'ruleId' | 'priority' | 'enabled'>>): Promise<ProviderModelRequestRewriteRule[]> {
  // 重复的 ruleId 是请求体自己前后矛盾，重复的 priority 会撞上
  // `idx_provider_model_request_rewrite_rule_priority_active`。两条都是用户可修正的输入，
  // 不是服务端故障：用 409 + `DUPLICATE_RESOURCE` 说清楚，别让它变成一句「内部错误」。
  if (new Set(bindings.map(item => item.ruleId)).size !== bindings.length) throw duplicateRequestRewriteRuleBindingError('rule')
  if (new Set(bindings.map(item => item.priority)).size !== bindings.length) throw duplicateRequestRewriteRuleBindingError('priority')
  const time = now(); const db = getConfigDb()
  try {
    db.transaction(tx => {
      const model = tx.select({ id: providerModels.id }).from(providerModels).where(and(eq(providerModels.id, providerModelId), isNull(providerModels.deletedTime))).get()
      if (!model) throw resourceNotFoundError('provider model', providerModelId)
      for (const item of bindings) {
        const rule = tx.select().from(requestRewriteRules).where(and(eq(requestRewriteRules.id, item.ruleId), isNull(requestRewriteRules.deletedTime))).get()
        if (!rule) throw resourceNotFoundError('request rewrite rule', item.ruleId)
      }
      const activeScope = and(eq(providerModelRequestRewriteRules.providerModelId, providerModelId), isNull(providerModelRequestRewriteRules.deletedTime))
      const retainedRuleIds = bindings.map(item => item.ruleId)
      tx.update(providerModelRequestRewriteRules).set({ enabled: false, deletedTime: time, updatedTime: time }).where(retainedRuleIds.length === 0 ? activeScope : and(activeScope, notInArray(providerModelRequestRewriteRules.requestRewriteRuleId, retainedRuleIds))).run()
      for (const item of bindings) {
        tx.insert(providerModelRequestRewriteRules).values({ providerModelId, requestRewriteRuleId: item.ruleId, priority: item.priority, enabled: item.enabled, createdTime: time, updatedTime: time, deletedTime: null }).onConflictDoUpdate({
          target: [providerModelRequestRewriteRules.providerModelId, providerModelRequestRewriteRules.requestRewriteRuleId],
          set: { priority: item.priority, enabled: item.enabled, updatedTime: time, deletedTime: null },
        }).run()
      }
    })
  } catch (error) {
    throw translateSqliteUniqueViolation(error) ?? error
  }
  return listProviderModelRequestRewriteRules(providerModelId)
}
export async function listRulesForProviderModel(providerModelId: string): Promise<RequestRewriteRule[]> {
  try {
    const db = getConfigDb()
    const globalRows = db.select().from(requestRewriteRules).where(and(eq(requestRewriteRules.scope, 'global'), eq(requestRewriteRules.enabled, true), isNull(requestRewriteRules.deletedTime))).orderBy(asc(requestRewriteRules.createdTime)).all()
    const boundRows = db.select({ rule: requestRewriteRules, bindingEnabled: providerModelRequestRewriteRules.enabled }).from(providerModelRequestRewriteRules).innerJoin(requestRewriteRules, eq(providerModelRequestRewriteRules.requestRewriteRuleId, requestRewriteRules.id)).where(and(eq(providerModelRequestRewriteRules.providerModelId, providerModelId), eq(providerModelRequestRewriteRules.enabled, true), isNull(providerModelRequestRewriteRules.deletedTime), eq(requestRewriteRules.enabled, true), isNull(requestRewriteRules.deletedTime))).orderBy(asc(providerModelRequestRewriteRules.priority)).all()
    const databaseRules = [...globalRows.map(parseRule), ...boundRows.map(row => parseRule(row.rule))]
    return databaseRules
  } catch (error) {
    if (error instanceof Error && error.message === 'Config database not initialized') return []
    throw error
  }
}
