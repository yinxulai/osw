import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { runRouteRules } from '@common/router/route-rule-engine'
import { RouteRuleSetSchema } from '@common/router/route-rules'
import { RouteContextInputSchema } from '@common/router/schemas'
import { listRouteRuleSetVersions, readRouteRuleSetVersion, resolveRouteRuleSet, saveRouteRuleSetVersion } from '@server/database/route-rule-store'
import { HttpRouter } from '@server/http-router'
import type { ManagementHandler } from '../../core/response'
import { sendSuccess } from '../../core/response'

/**
 * 路由规则表的读写与试跑接口。
 *
 * 与图那一组**形状一致**：读当前生效的、列版本、读指定版本、保存为新版本。
 * 两组的共同点是「各自只碰自己表里的行、各算各的版本号」，谁也不影响对方。
 */

const SaveRouteRuleSetSchema = z.object({
  ruleSet: RouteRuleSetSchema,
  /** 版本名；留空即空串（版本的身份是记录 id，不用名字占位）。 */
  name: z.string().max(60).optional(),
  /** 版本说明；留空表示不写。 */
  description: z.string().max(200).optional(),
})

const RouteRuleSetVersionSchema = z.object({
  /** 要读哪一版：传它的**记录 id**，不是版本号。 */
  id: z.string().min(1),
})

const RunRouteRulesSchema = z.object({
  ruleSet: RouteRuleSetSchema,
  inputPayload: RouteContextInputSchema,
})

export const routerRuleRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/router/rules', handleGetRouteRuleSet)
  .post('/api/router/rules/versions', handleListRouteRuleSetVersions)
  .post('/api/router/rules/version', handleGetRouteRuleSetVersion)
  .post('/api/router/rules/save', handleSaveRouteRuleSet)
  .post('/api/router/rules/run', handleRunRouteRules)

/**
 * 当前生效的规则表；一版都没保存过时是内建默认表（版本号为 `UNSAVED_ROUTE_RULE_VERSION`）。
 *
 * 与图侧同义：返回的永远是「代理此刻会执行的那一份」。
 */
async function handleGetRouteRuleSet(_req: IncomingMessage, res: ServerResponse, _body: unknown): Promise<void> {
  sendSuccess(res, await resolveRouteRuleSet())
}

async function handleListRouteRuleSetVersions(_req: IncomingMessage, res: ServerResponse, _body: unknown): Promise<void> {
  sendSuccess(res, await listRouteRuleSetVersions())
}

/** 按记录 id 读规则表；那一版不存在时 `data` 为 `null`。 */
async function handleGetRouteRuleSetVersion(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = RouteRuleSetVersionSchema.parse(body)
  sendSuccess(res, await readRouteRuleSetVersion(input.id))
}

/**
 * 保存为新版本，它立即对代理生效。
 *
 * 名字与说明与图侧完全同义：两者都只是人类注记、不参与判定，留空即空串；
 * 内容与最新版一致时不生成新版本，这两项也一并丢弃。
 */
async function handleSaveRouteRuleSet(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = SaveRouteRuleSetSchema.parse(body)
  sendSuccess(res, await saveRouteRuleSetVersion(input.ruleSet, input.name, input.description))
}

/**
 * 规则表的试跑。
 *
 * 规则表本身是纯计算（渲染进程也跑得动），但仍然放在服务端，与图的试跑（`run.ts`）同一个形状：
 * 「判定路由」全仓只有这一个执行者。渲染进程再复制一份判定，就等于给同一条规则准备了两种解释，
 * 而两种解释分叉时，试运行的结果会与真实请求不一致 —— 那时用户只会怀疑自己的规则写错了。
 * 入参里的逻辑模型快照由调用方给（`RouteContextInputSchema`），与控制台展示的是同一份。
 */
async function handleRunRouteRules(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = RunRouteRulesSchema.parse(body)
  sendSuccess(res, runRouteRules(input.ruleSet, input.inputPayload))
}
