import { z } from 'zod'
import { RequestRewriteRuleSchema, ProviderModelRequestRewriteRuleSchema } from '@common/schemas'
import { createRequestRewriteRule, deleteRequestRewriteRule, getRequestRewriteRule, listProviderModelRequestRewriteRules, listRequestRewriteRules, replaceProviderModelRequestRewriteRuleBindings, updateRequestRewriteRule } from '../database/modification-rule-store'
import { applyModificationRules } from '../proxy/modification-engine'
import type { ManagementHandler } from './response'
import { sendError, sendSuccess } from './response'

const IdSchema = z.object({ id: z.string().min(1) })
const ModelSchema = z.object({ providerModelId: z.string().min(1) })
const RuleInput = RequestRewriteRuleSchema.omit({ id: true, createdTime: true, updatedTime: true, deletedTime: true })
const UpdateSchema = RequestRewriteRuleSchema.partial().required({ id: true })
const BindingsSchema = z.object({ providerModelId: z.string().min(1), bindings: z.array(ProviderModelRequestRewriteRuleSchema.pick({ ruleId: true, priority: true, enabled: true })).max(50) })
const TestSchema = z.object({ rule: RequestRewriteRuleSchema, testCase: z.object({ stage: z.enum(['request', 'response']), body: z.string().max(2 * 1024 * 1024), headers: z.string().max(64 * 1024), clientProtocol: z.string(), upstreamProtocol: z.string(), logicalModelId: z.string(), providerModelId: z.string(), path: z.string(), streaming: z.boolean() }) })
export const requestRewriteRuleRoutes: Record<string, ManagementHandler> = {
  '/api/request-rewrite-rule/list': async (_req, res) => sendSuccess(res, await listRequestRewriteRules()),
  '/api/request-rewrite-rule/get': async (_req, res, body) => { const result = await getRequestRewriteRule(IdSchema.parse(body).id); if (!result) return sendError(res, 'NOT_FOUND', '修改规则不存在', 404); sendSuccess(res, result) },
  '/api/request-rewrite-rule/create': async (_req, res, body) => sendSuccess(res, await createRequestRewriteRule(RuleInput.parse(body))),
  '/api/request-rewrite-rule/update': async (_req, res, body) => { const input = UpdateSchema.parse(body); const { id, ...updates } = input; sendSuccess(res, await updateRequestRewriteRule(id, updates)) },
  '/api/request-rewrite-rule/delete': async (_req, res, body) => { const { id } = IdSchema.parse(body); sendSuccess(res, await deleteRequestRewriteRule(id)) },
  '/api/request-rewrite-rule/test': async (_req, res, body) => {
    const input = TestSchema.parse(body)
    const parsedBody = JSON.parse(input.testCase.body) as object
    const parsedHeaders = JSON.parse(input.testCase.headers) as Record<string, string | string[] | undefined>
    const result = applyModificationRules(Buffer.from(JSON.stringify(parsedBody)), parsedHeaders, [input.rule], { stage: input.testCase.stage, clientProtocol: input.testCase.clientProtocol as Parameters<typeof applyModificationRules>[3]['clientProtocol'], upstreamProtocol: input.testCase.upstreamProtocol as Parameters<typeof applyModificationRules>[3]['upstreamProtocol'], logicalModelId: input.testCase.logicalModelId, providerModelId: input.testCase.providerModelId, path: input.testCase.path, streaming: input.testCase.streaming })
    sendSuccess(res, { ...result, body: result.body.toString('utf8') })
  },
  '/api/request-rewrite-rule/bindings': async (_req, res, body) => sendSuccess(res, await listProviderModelRequestRewriteRules(ModelSchema.parse(body).providerModelId)),
  '/api/request-rewrite-rule/replace-bindings': async (_req, res, body) => { const input = BindingsSchema.parse(body); sendSuccess(res, await replaceProviderModelRequestRewriteRuleBindings(input.providerModelId, input.bindings)) },
}
