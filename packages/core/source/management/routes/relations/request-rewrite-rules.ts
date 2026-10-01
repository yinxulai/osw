import { z } from 'zod'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { RequestRewriteRuleSchema, ProviderModelRequestRewriteRuleSchema, TransportKindSchema } from '@common/schemas'
import { RESPONSE_REWRITE_ENABLED } from '@common/features'
import { createRequestRewriteRule, deleteRequestRewriteRule, getRequestRewriteRule, listProviderModelRequestRewriteRules, listRequestRewriteRules, replaceProviderModelRequestRewriteRuleBindings, updateRequestRewriteRule } from '@server/database/request-rewrite-rule-store'
import { applyRequestRewriteRules } from '@server/proxy/request-rewrite/request-rewrite-engine'
import { bodyDeliveryShape } from '@server/proxy/contracts'
import { HttpRouter } from '@server/http-router'
import { reportTelemetryEvent } from '@server/telemetry'
import type { ManagementHandler } from '../../core/response'
import { sendError, sendSuccess } from '../../core/response'

/**
 * 响应阶段整段受 `RESPONSE_REWRITE_ENABLED` 闸门控制（见 `@common/features`）。写入口与试跑口
 * 都在这里挡一道，与渲染层「不列出响应」形成双保险：界面藏起一个选项，请求仍可能由脚本、
 * 旧数据或第三方客户端带进来——只靠界面藏，等于把闸门交给调用方自觉。
 *
 * 返回一句可照做的理由（给 400 用），或 `null` 表示放行。
 */
interface DisabledResponseStageInput {
  actions?: readonly { stage: string }[]
  testCases?: readonly { stage: string }[]
}

function disabledResponseStageReason(input: DisabledResponseStageInput): string | null {
  if (RESPONSE_REWRITE_ENABLED) return null
  if (input.actions?.some(action => action.stage === 'response')) return 'Response-stage actions are disabled: streaming responses cannot be rewritten yet'
  if (input.testCases?.some(testCase => testCase.stage === 'response')) return 'Response-stage test cases are disabled: streaming responses cannot be rewritten yet'
  return null
}

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
  .post('/api/request-rewrite-rule/update', async (_req, res, body) => {
    const input = UpdateSchema.parse(body)
    const disabled = disabledResponseStageReason(input)
    if (disabled) return sendError(res, 'RESPONSE_REWRITE_DISABLED', disabled, 400)
    const { id, ...updates } = input
    sendSuccess(res, await updateRequestRewriteRule(id, updates))
  })
  .post('/api/request-rewrite-rule/delete', async (_req, res, body) => { const { id } = IdSchema.parse(body); sendSuccess(res, await deleteRequestRewriteRule(id)) })
  .post('/api/request-rewrite-rule/test', async (_req, res, body) => {
    const input = TestSchema.parse(body)
    const disabled = disabledResponseStageReason({ actions: input.rule.actions, testCases: [input.testCase] })
    if (disabled) return sendError(res, 'RESPONSE_REWRITE_DISABLED', disabled, 400)
    const parsedBody = JSON.parse(input.testCase.body) as object
    const parsedHeaders = JSON.parse(input.testCase.headers) as Record<string, string | string[] | undefined>
    // 试跑入参是传输形态本身（与落库的用例字段同名），引擎认的是**交付形态**，
    // 因此在这里换算一次：用例里存的是「客户端跳的 transport」，而规则能不能动手
    // 取决于「手里有没有一整份正文」（见 `BodyDeliveryShape`）。
    //
    // 换算之前先挡掉**未实现**的形态：WebSocket 是双向多轮，正文既不是一整份也不是向下分帧。
    // 如果这里放着往下走，`bodyDeliveryShape('websocket')` 会给出一个形态，试跑就会一本正经地
    // 报「改造成功了 N 条」——而真实入口对同一个请求回的是 501。两处对同一份输入给出两个答案，
    // 比试跑直接失败更糟：它会让用户以为规则在 WS 上生效了。
    if (input.testCase.transport === 'websocket') {
      return sendError(res, 'TRANSPORT_NOT_IMPLEMENTED', 'WebSocket transport is not implemented: its request/response cannot be rewritten', 400)
    }
    const result = applyRequestRewriteRules(Buffer.from(JSON.stringify(parsedBody)), parsedHeaders, [input.rule], { stage: input.testCase.stage, clientProtocol: input.testCase.clientProtocol as Parameters<typeof applyRequestRewriteRules>[3]['clientProtocol'], upstreamProtocol: input.testCase.upstreamProtocol as Parameters<typeof applyRequestRewriteRules>[3]['upstreamProtocol'], shape: bodyDeliveryShape(input.testCase.transport) })
    sendSuccess(res, { ...result, body: result.body.toString('utf8') })
  })
  .post('/api/request-rewrite-rule/bindings', async (_req, res, body) => sendSuccess(res, await listProviderModelRequestRewriteRules(ModelSchema.parse(body).providerModelId)))
  .post('/api/request-rewrite-rule/replace-bindings', async (_req, res, body) => { const input = BindingsSchema.parse(body); sendSuccess(res, await replaceProviderModelRequestRewriteRuleBindings(input.providerModelId, input.bindings)) })

async function handleCreateRequestRewriteRule(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = RuleInput.parse(body)
  const disabled = disabledResponseStageReason(input)
  if (disabled) return sendError(res, 'RESPONSE_REWRITE_DISABLED', disabled, 400)
  const rule = await createRequestRewriteRule(input)
  // 规则的来源在库里是三档（`user` / `builtin` / `imported`），契约里只有两档：
  // 这个属性要回答的是「内建模板有人用吗」，用户自建的与导入的都归自定义（契约注释）。
  reportTelemetryEvent({ name: 'rewrite_rule_created', kind: input.source === 'builtin' ? 'builtin' : 'custom' })
  sendSuccess(res, rule)
}
