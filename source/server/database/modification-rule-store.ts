import { and, asc, eq, isNull } from 'drizzle-orm'
import { ModificationRuleSchema, ProviderModelModificationRuleSchema, type ModificationRule, type ProviderModelModificationRule } from '@common/schemas'
import { generateId, now } from '@common/utils'
import { getDb } from './index'
import { providerModelRequestModificationRules, providerModels, requestModificationRules } from './schema'

function parseRule(row: typeof requestModificationRules.$inferSelect): ModificationRule { return ModificationRuleSchema.parse({ ...row, match: JSON.parse(row.match), actions: JSON.parse(row.actions), testCases: JSON.parse(row.testCases) }) }
function parseBinding(row: typeof providerModelRequestModificationRules.$inferSelect): ProviderModelModificationRule { return ProviderModelModificationRuleSchema.parse({ ...row, ruleId: row.requestModificationRuleId }) }

export async function listModificationRules(includeDeleted = false): Promise<ModificationRule[]> {
  const rows = getDb().select().from(requestModificationRules).where(includeDeleted ? undefined : isNull(requestModificationRules.deletedTime)).orderBy(asc(requestModificationRules.name)).all()
  return rows.map(parseRule)
}
export async function getModificationRule(id: string): Promise<ModificationRule | undefined> {
  const row = getDb().select().from(requestModificationRules).where(eq(requestModificationRules.id, id)).get()
  return row ? parseRule(row) : undefined
}
export async function createModificationRule(input: Omit<ModificationRule, 'id' | 'createdTime' | 'updatedTime' | 'deletedTime'>): Promise<ModificationRule> {
  const time = now(); const rule = ModificationRuleSchema.parse({ ...input, id: generateId('rule_'), createdTime: time, updatedTime: time, deletedTime: null })
  getDb().insert(requestModificationRules).values({ ...rule, match: JSON.stringify(rule.match), actions: JSON.stringify(rule.actions), testCases: JSON.stringify(rule.testCases) }).run(); return rule
}
export async function updateModificationRule(id: string, updates: Partial<Omit<ModificationRule, 'id' | 'createdTime'>>): Promise<ModificationRule> {
  const existing = await getModificationRule(id); if (!existing) throw new Error(`modification rule not found: ${id}`)
  const rule = ModificationRuleSchema.parse({ ...existing, ...updates, id, updatedTime: now() })
  getDb().update(requestModificationRules).set({ name: rule.name, description: rule.description, enabled: rule.enabled, scope: rule.scope, schemaVersion: rule.schemaVersion, source: rule.source, match: JSON.stringify(rule.match), actions: JSON.stringify(rule.actions), testCases: JSON.stringify(rule.testCases), updatedTime: rule.updatedTime, deletedTime: rule.deletedTime }).where(eq(requestModificationRules.id, id)).run(); return rule
}
export async function countProviderModelsUsingRule(ruleId: string): Promise<number> {
  return getDb().select({ providerModelId: providerModelRequestModificationRules.providerModelId }).from(providerModelRequestModificationRules).where(eq(providerModelRequestModificationRules.requestModificationRuleId, ruleId)).all().length
}
export async function deleteModificationRule(id: string): Promise<{ id: string; affectedProviderModelCount: number }> {
  const affectedProviderModelCount = await countProviderModelsUsingRule(id)
  const updatedTime = now()
  getDb().transaction(tx => {
    tx.delete(providerModelRequestModificationRules).where(eq(providerModelRequestModificationRules.requestModificationRuleId, id)).run()
    tx.update(requestModificationRules).set({ enabled: false, deletedTime: updatedTime, updatedTime }).where(eq(requestModificationRules.id, id)).run()
  })
  return { id, affectedProviderModelCount }
}
export async function listProviderModelModificationRules(providerModelId: string): Promise<ProviderModelModificationRule[]> {
  return getDb().select().from(providerModelRequestModificationRules).where(eq(providerModelRequestModificationRules.providerModelId, providerModelId)).orderBy(asc(providerModelRequestModificationRules.priority)).all().map(parseBinding)
}
export async function replaceProviderModelModificationRuleBindings(providerModelId: string, bindings: Array<Pick<ProviderModelModificationRule, 'ruleId' | 'priority' | 'enabled'>>): Promise<ProviderModelModificationRule[]> {
  if (new Set(bindings.map(item => item.ruleId)).size !== bindings.length || new Set(bindings.map(item => item.priority)).size !== bindings.length) throw new Error('规则绑定或优先级重复')
  const time = now(); const db = getDb()
  db.transaction(tx => { const model = tx.select({ id: providerModels.id }).from(providerModels).where(and(eq(providerModels.id, providerModelId), isNull(providerModels.deletedTime))).get(); if (!model) throw new Error(`provider model not found: ${providerModelId}`); for (const item of bindings) { const rule = tx.select().from(requestModificationRules).where(and(eq(requestModificationRules.id, item.ruleId), isNull(requestModificationRules.deletedTime))).get(); if (!rule) throw new Error(`request modification rule not found: ${item.ruleId}`) }; tx.delete(providerModelRequestModificationRules).where(eq(providerModelRequestModificationRules.providerModelId, providerModelId)).run(); for (const item of bindings) tx.insert(providerModelRequestModificationRules).values({ providerModelId, requestModificationRuleId: item.ruleId, priority: item.priority, enabled: item.enabled, createdTime: time, updatedTime: time }).run() })
  return listProviderModelModificationRules(providerModelId)
}
export async function listRulesForProviderModel(providerModelId: string): Promise<ModificationRule[]> {
  try {
    const db = getDb()
    const globalRows = db.select().from(requestModificationRules).where(and(eq(requestModificationRules.scope, 'global'), eq(requestModificationRules.enabled, true), isNull(requestModificationRules.deletedTime))).orderBy(asc(requestModificationRules.createdTime)).all()
    const boundRows = db.select({ rule: requestModificationRules, bindingEnabled: providerModelRequestModificationRules.enabled }).from(providerModelRequestModificationRules).innerJoin(requestModificationRules, eq(providerModelRequestModificationRules.requestModificationRuleId, requestModificationRules.id)).where(and(eq(providerModelRequestModificationRules.providerModelId, providerModelId), eq(providerModelRequestModificationRules.enabled, true), eq(requestModificationRules.enabled, true), isNull(requestModificationRules.deletedTime))).orderBy(asc(providerModelRequestModificationRules.priority)).all()
    const databaseRules = [...globalRows.map(parseRule), ...boundRows.map(row => parseRule(row.rule))]
    return databaseRules
  } catch (error) {
    if (error instanceof Error && error.message === 'Database not initialized') return []
    throw error
  }
}
