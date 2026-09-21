import { z } from 'zod'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { RequestRewriteRuleSchema, ProviderModelRequestRewriteRuleSchema, TransportKindSchema } from '@common/schemas'
import { createRequestRewriteRule, deleteRequestRewriteRule, getRequestRewriteRule, listProviderModelRequestRewriteRules, listRequestRewriteRules, replaceProviderModelRequestRewriteRuleBindings, updateRequestRewriteRule } from '@server/database/request-rewrite-rule-store'
import { applyRequestRewriteRules } from '@server/proxy/request-rewrite/request-rewrite-engine'
import { HttpRouter } from '@server/http-router'
import { reportTelemetryEvent } from '@server/telemetry'
import type { ManagementHandler } from '../../core/response'
import { sendError, sendSuccess } from '../../core/response'

const IdSchema = z.object({ id: z.string().min(1) })
const ModelSchema = z.object({ providerModelId: z.string().min(1) })
const RuleInput = RequestRewriteRuleSchema.omit({ id: true, createdTime: true, updatedTime: true, deletedTime: true })
const UpdateSchema = RequestRewriteRuleSchema.partial().required({ id: true })
const BindingsSchema = z.object({ providerModelId: z.string().min(1), bindings: z.array(ProviderModelRequestRewriteRuleSchema.pick({ ruleId: true, priority: true, enabled: true })).max(50) })
const TestSchema = z.object({ rule: RequestRewriteRuleSchema, testCase: z.object({ stage: z.enum(['request', 'response']), body: z.string(), headers: z.string(), clientProtocol: z.string(), upstreamProtocol: z.string(), transport: TransportKindSchema }) })
export const requestRewriteRuleRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/request-rewrite-rule/list', async (_req, res) => sendSuccess(res, await listRequestRewriteRules()))
  .post('/api/request-rewrite-rule/get', async (_req, res, body) => { const result = await getRequestRewriteRule(IdSchema.parse(body).id); if (!result) return sendError(res, 'NOT_FOUND', 'Request rewrite rule not found', 404); sendSuccess(res, result) })
  .post('/api/request-rewrite-rule/create', handleCreateRequestRewriteRule)
  .post('/api/request-rewrite-rule/update', async (_req, res, body) => { const input = UpdateSchema.parse(body); const { id, ...updates } = input; sendSuccess(res, await updateRequestRewriteRule(id, updates)) })
  .post('/api/request-rewrite-rule/delete', async (_req, res, body) => { const { id } = IdSchema.parse(body); sendSuccess(res, await deleteRequestRewriteRule(id)) })
  .post('/api/request-rewrite-rule/test', async (_req, res, body) => {
    const input = TestSchema.parse(body)
    const parsedBody = JSON.parse(input.testCase.body) as object
    const parsedHeaders = JSON.parse(input.testCase.headers) as Record<string, string | string[] | undefined>
    // 试跑入参是传输形态本身（与落库的用例字段同名），引擎只认 `transport`，直接透传。
    const result = applyRequestRewriteRules(Buffer.from(JSON.stringify(parsedBody)), parsedHeaders, [input.rule], { stage: input.testCase.stage, clientProtocol: input.testCase.clientProtocol as Parameters<typeof applyRequestRewriteRules>[3]['clientProtocol'], upstreamProtocol: input.testCase.upstreamProtocol as Parameters<typeof applyRequestRewriteRules>[3]['upstreamProtocol'], transport: input.testCase.transport })
    sendSuccess(res, { ...result, body: result.body.toString('utf8') })
  })
  .post('/api/request-rewrite-rule/bindings', async (_req, res, body) => sendSuccess(res, await listProviderModelRequestRewriteRules(ModelSchema.parse(body).providerModelId)))
  .post('/api/request-rewrite-rule/replace-bindings', async (_req, res, body) => { const input = BindingsSchema.parse(body); sendSuccess(res, await replaceProviderModelRequestRewriteRuleBindings(input.providerModelId, input.bindings)) })

async function handleCreateRequestRewriteRule(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = RuleInput.parse(body)
  const rule = await createRequestRewriteRule(input)
  // 规则的来源在库里是三档（`user` / `builtin` / `imported`），契约里只有两档：
  // 这个属性要回答的是「内建模板有人用吗」，用户自建的与导入的都归自定义（契约注释）。
  reportTelemetryEvent({ name: 'rewrite_rule_created', kind: input.source === 'builtin' ? 'builtin' : 'custom' })
  sendSuccess(res, rule)
}
