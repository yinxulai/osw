import { z } from 'zod'
import { ModificationRuleSchema, ProviderModelModificationRuleSchema } from '@common/schemas'
import { createModificationRule, deleteModificationRule, getModificationRule, listModificationRules, listProviderModelModificationRules, replaceProviderModelModificationRuleBindings, updateModificationRule } from '../database/modification-rule-store'
import type { ManagementHandler } from './response'
import { sendError, sendSuccess } from './response'

const IdSchema = z.object({ id: z.string().min(1) })
const ModelSchema = z.object({ providerModelId: z.string().min(1) })
const RuleInput = ModificationRuleSchema.omit({ id: true, createdTime: true, updatedTime: true, deletedTime: true })
const UpdateSchema = ModificationRuleSchema.partial().required({ id: true })
const BindingsSchema = z.object({ providerModelId: z.string().min(1), bindings: z.array(ProviderModelModificationRuleSchema.pick({ ruleId: true, priority: true, enabled: true })).max(50) })
export const modificationRuleRoutes: Record<string, ManagementHandler> = {
  '/api/modification-rule/list': async (_req, res) => sendSuccess(res, await listModificationRules()),
  '/api/modification-rule/get': async (_req, res, body) => { const result = await getModificationRule(IdSchema.parse(body).id); if (!result) return sendError(res, 'NOT_FOUND', '修改规则不存在', 404); sendSuccess(res, result) },
  '/api/modification-rule/create': async (_req, res, body) => sendSuccess(res, await createModificationRule(RuleInput.parse(body))),
  '/api/modification-rule/update': async (_req, res, body) => { const input = UpdateSchema.parse(body); const { id, ...updates } = input; sendSuccess(res, await updateModificationRule(id, updates)) },
  '/api/modification-rule/delete': async (_req, res, body) => { const { id } = IdSchema.parse(body); sendSuccess(res, await deleteModificationRule(id)) },
  '/api/modification-rule/bindings': async (_req, res, body) => sendSuccess(res, await listProviderModelModificationRules(ModelSchema.parse(body).providerModelId)),
  '/api/modification-rule/replace-bindings': async (_req, res, body) => { const input = BindingsSchema.parse(body); sendSuccess(res, await replaceProviderModelModificationRuleBindings(input.providerModelId, input.bindings)) },
}
