import { and, asc, eq, isNull } from 'drizzle-orm'
import { ModificationRuleSchema, ProviderModelModificationRuleSchema, type ModificationRule, type ProviderModelModificationRule } from '@common/schemas'
import { generateId, now } from '@common/utils'
import { getDb } from './index'
import { modificationRules, providerModelModificationRules, providerModels } from './schema'

function parseRule(row: typeof modificationRules.$inferSelect): ModificationRule { return ModificationRuleSchema.parse({ ...row, match: JSON.parse(row.match), actions: JSON.parse(row.actions) }) }
function parseBinding(row: typeof providerModelModificationRules.$inferSelect): ProviderModelModificationRule { return ProviderModelModificationRuleSchema.parse(row) }

export async function listModificationRules(includeDeleted = false): Promise<ModificationRule[]> {
  const rows = getDb().select().from(modificationRules).where(includeDeleted ? undefined : isNull(modificationRules.deletedTime)).orderBy(asc(modificationRules.name)).all()
  return rows.map(parseRule)
}
export async function getModificationRule(id: string): Promise<ModificationRule | undefined> {
  const row = getDb().select().from(modificationRules).where(eq(modificationRules.id, id)).get()
  return row ? parseRule(row) : undefined
}
export async function createModificationRule(input: Omit<ModificationRule, 'id' | 'createdTime' | 'updatedTime' | 'deletedTime'>): Promise<ModificationRule> {
  const time = now(); const rule = ModificationRuleSchema.parse({ ...input, id: generateId('rule_'), createdTime: time, updatedTime: time, deletedTime: null })
  getDb().insert(modificationRules).values({ ...rule, match: JSON.stringify(rule.match), actions: JSON.stringify(rule.actions) }).run(); return rule
}
export async function updateModificationRule(id: string, updates: Partial<Omit<ModificationRule, 'id' | 'createdTime'>>): Promise<ModificationRule> {
  const existing = await getModificationRule(id); if (!existing) throw new Error(`modification rule not found: ${id}`)
  const rule = ModificationRuleSchema.parse({ ...existing, ...updates, id, updatedTime: now() })
  getDb().update(modificationRules).set({ name: rule.name, description: rule.description, enabled: rule.enabled, stage: rule.stage, schemaVersion: rule.schemaVersion, source: rule.source, match: JSON.stringify(rule.match), actions: JSON.stringify(rule.actions), updatedTime: rule.updatedTime, deletedTime: rule.deletedTime }).where(eq(modificationRules.id, id)).run(); return rule
}
export async function countProviderModelsUsingRule(ruleId: string): Promise<number> {
  return getDb().select({ providerModelId: providerModelModificationRules.providerModelId }).from(providerModelModificationRules).where(eq(providerModelModificationRules.ruleId, ruleId)).all().length
}
export async function deleteModificationRule(id: string): Promise<{ id: string; affectedProviderModelCount: number }> {
  const affectedProviderModelCount = await countProviderModelsUsingRule(id)
  const updatedTime = now()
  getDb().update(modificationRules).set({ enabled: false, deletedTime: updatedTime, updatedTime }).where(eq(modificationRules.id, id)).run()
  return { id, affectedProviderModelCount }
}
export async function listProviderModelModificationRules(providerModelId: string): Promise<ProviderModelModificationRule[]> {
  return getDb().select().from(providerModelModificationRules).where(eq(providerModelModificationRules.providerModelId, providerModelId)).orderBy(asc(providerModelModificationRules.priority)).all().map(parseBinding)
}
export async function replaceProviderModelModificationRuleBindings(providerModelId: string, bindings: Array<Pick<ProviderModelModificationRule, 'ruleId' | 'priority' | 'enabled'>>): Promise<ProviderModelModificationRule[]> {
  if (new Set(bindings.map(item => item.ruleId)).size !== bindings.length || new Set(bindings.map(item => item.priority)).size !== bindings.length) throw new Error('规则绑定或优先级重复')
  const time = now(); const db = getDb()
  db.transaction(tx => { const model = tx.select({ id: providerModels.id }).from(providerModels).where(and(eq(providerModels.id, providerModelId), isNull(providerModels.deletedTime))).get(); if (!model) throw new Error(`provider model not found: ${providerModelId}`); for (const item of bindings) { const rule = tx.select().from(modificationRules).where(and(eq(modificationRules.id, item.ruleId), isNull(modificationRules.deletedTime))).get(); if (!rule) throw new Error(`modification rule not found: ${item.ruleId}`) }; tx.delete(providerModelModificationRules).where(eq(providerModelModificationRules.providerModelId, providerModelId)).run(); for (const item of bindings) tx.insert(providerModelModificationRules).values({ providerModelId, ruleId: item.ruleId, priority: item.priority, enabled: item.enabled, createdTime: time, updatedTime: time }).run() })
  return listProviderModelModificationRules(providerModelId)
}
export async function listRulesForProviderModel(providerModelId: string): Promise<ModificationRule[]> {
  try {
    const rows = getDb().select({ rule: modificationRules }).from(providerModelModificationRules).innerJoin(modificationRules, eq(providerModelModificationRules.ruleId, modificationRules.id)).where(and(eq(providerModelModificationRules.providerModelId, providerModelId), eq(providerModelModificationRules.enabled, true))).orderBy(asc(providerModelModificationRules.priority)).all()
    return rows.map(row => parseRule(row.rule))
  } catch (error) {
    if (error instanceof Error && error.message === 'Database not initialized') return []
    throw error
  }
}
