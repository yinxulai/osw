import type { Protocol, RouteMode, TransportKind } from '@common/schemas'
import { readLandingModelIds, readRouteDecision, runWorkflow } from '@common/router/engine'
import { runRouteRules, type RouteRuleStep } from '@common/router/route-rule-engine'
import type { RouteContextInput, WorkflowRequestPayload, WorkflowRunResult, WorkflowTrace } from '@common/router/types'
import { listLogicalModels } from '@server/database/logical-model-store'
import { resolveRouteRuleSet } from '@server/database/route-rule-store'
import { resolveRouterGraph } from '@server/database/router-graph-store'
import { getSettings } from '@server/database/settings-store'
import { reportWorkflowTrace } from '@server/telemetry/events'
import { createRouteCapabilities } from '../capabilities/route-capabilities'
import type { HeaderMap } from '../contracts'

/**
 * 一次请求的路由求解：读生效模式 → 读那一份定义 → 算出落点。
 *
 * 这是「智能路由接入代理」的**唯一**交接面。代理入口不解释图也不解释规则表：
 * 入口负责把请求摊成两种模式都能读的形状（路径、方法、头、体），定义负责算出落点逻辑模型，
 * 之后照旧交给规划器与执行器。模式只在这一处分流，往下游看到的都是同一份 `RouteResolution`，
 * 规划、执行、请求日志因此一行都不用知道今天生效的是哪种模式。
 */

export interface RouteResolutionInput {
  /** 归一化后的客户端请求：定义能读到的就是这些。 */
  readonly request: WorkflowRequestPayload
  /** 客户端协议。端点匹配时就已经确定，不再让定义去猜。 */
  readonly clientProtocol: Protocol
  /** 客户端跳的传输形态（**事实**）：入口按接口封装描述解析出来，不由请求头临时猜。 */
  readonly transport: TransportKind
  /** 本次运行的追踪 id，直接沿用交换 id，让定义与请求日志指向同一个交换。 */
  readonly traceId: string
}

/** 两种模式共有的求解结果：调用方只需要看到这些就能继续往下走。 */
interface RouteResolutionBase {
  /** 选出的落点逻辑模型，按优先级排列；没有落点时为空数组。 */
  readonly logicalModelIds: string[]
  /** 最终认定的协议；定义没给出结论时退回入口匹配到的协议。 */
  readonly protocol: Protocol
  /** 最终认定的客户端跳传输形态；同样退回入口给出的事实。 */
  readonly transport: TransportKind
  /** 本次实际生效的模式。**它是事实，不是配置回读**：日志里报的就是刚刚真正跑的那一种。 */
  readonly mode: RouteMode
  /** 生效定义的版本号（图或规则表）；`0` 表示还没有人保存过，用的是内建默认。 */
  readonly definitionVersion: number
}

/** 工作流编排求解出的结果：带图的停止原因与节点轨迹。 */
export interface WorkflowRouteResolution extends RouteResolutionBase {
  readonly mode: 'workflow'
  /** 图停下来时的原因，用于日志。 */
  readonly stopReason: WorkflowRunResult['stopReason']
  /** 完整的节点轨迹，用于排查「为什么落点不是我预期的那个」。 */
  readonly trace: WorkflowTrace[]
}

/** 路由规则求解出的结果：带逐条规则的判定经过。 */
export interface RuleRouteResolution extends RouteResolutionBase {
  readonly mode: 'rules'
  /** `rule` 表示某条规则胜出，`fallback` 表示走了兜底。 */
  readonly stopReason: 'rule' | 'fallback'
  /** 逐条规则的判定经过，用于排查「为什么是这条」。 */
  readonly steps: RouteRuleStep[]
}

export type RouteResolution = WorkflowRouteResolution | RuleRouteResolution

/**
 * 求解一次请求的路由。
 *
 * 模式从设置里读：它是「哪一份定义生效」的唯一下场，两个模式的定义只在自己被选中时才被读取 ——
 * 没生效的那一份既不会参与求解，也不会把内建默认表（图）白白生成一遍。
 */
export async function resolveRoute(input: RouteResolutionInput): Promise<RouteResolution> {
  const settings = await getSettings()
  return settings.routeMode === 'rules' ? resolveByRules(input) : resolveByWorkflow(input)
}

/** 工作流编排：读当前生效的图 → 组装上下文 → 跑图 → 取落点。 */
async function resolveByWorkflow(input: RouteResolutionInput): Promise<WorkflowRouteResolution> {
  const [snapshot, logicalModels] = await Promise.all([resolveRouterGraph(), listLogicalModels()])

  const routeContext = {
    request: input.request,
    // 主进程的逻辑模型天然满足 `RuntimeLogicalModel`（多出来的字段没人读），直接交进去。
    logicalModels,
    metadata: { traceId: input.traceId },
    protocol: input.clientProtocol,
    transport: input.transport,
  } satisfies RouteContextInput

  // 脚本沙箱与提示词调用要主进程的资源：图在代理里跑，能力就必须在这里注入，
  // 否则图上真配了这两种节点，运行时只会得到一句「能力未注入」。
  const result = await runWorkflow(snapshot.graph, routeContext, { capabilities: createRouteCapabilities() })
  reportWorkflowTrace(result.trace)

  // 决策以图为准：读到什么就回什么，读不到（还没走到写决策的节点）才退回入口的事实。
  const decision = readRouteDecision(result.outputPayload)
  const discovered = decision?.protocol
  // 图判定为 `unknown` 说明协议发现节点没猜出来；此时入口匹配到的协议更可信。
  const protocol: Protocol = discovered && discovered !== 'unknown' ? discovered : input.clientProtocol

  return {
    mode: 'workflow',
    logicalModelIds: readLandingModelIds(result.outputPayload),
    protocol,
    transport: decision?.transport ?? input.transport,
    definitionVersion: snapshot.version,
    stopReason: result.stopReason,
    trace: result.trace,
  }
}

/**
 * 路由规则：读当前生效的规则表 → 从上往下匹配 → 取落点。
 *
 * 不需要注入任何能力：规则表只能读请求与做判定，没有脚本、没有提示词调用 ——
 * 这正是它比图轻的地方，也是它没有能力可以缺失的地方。
 */
async function resolveByRules(input: RouteResolutionInput): Promise<RuleRouteResolution> {
  const [snapshot, logicalModels] = await Promise.all([resolveRouteRuleSet(), listLogicalModels()])

  const result = runRouteRules(snapshot.ruleSet, {
    request: input.request,
    logicalModels,
    metadata: { traceId: input.traceId },
    protocol: input.clientProtocol,
    transport: input.transport,
  } satisfies RouteContextInput)

  return {
    mode: 'rules',
    logicalModelIds: result.logicalModelIds,
    // 规则表不猜协议：它读到的 `route.protocol` 就是入口声明的那一个，只有真拿到 `unknown` 才退回入口。
    protocol: result.protocol !== 'unknown' ? result.protocol : input.clientProtocol,
    transport: result.transport,
    definitionVersion: snapshot.version,
    stopReason: result.stopReason,
    steps: result.steps,
  }
}

/** 把 Node 的多值头字典压成图里用的单值字典（同名头按 `,` 合并，口径与引擎的归一化一致）。 */
export function toRouteHeaders(headers: HeaderMap): Record<string, string> {
  const flattened: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    flattened[name] = Array.isArray(value) ? value.join(',') : value
  }
  return flattened
}

/**
 * 请求体解析成对象供图读取。
 *
 * 不是 JSON 体时给空对象而不是原文：图的字段路径是按「请求体是对象」写的，
 * 给字符串只会让条件判定全部落到「字段不存在」上，与给空对象的结果一样，
 * 却要让每个读体字段的节点各自兜底一次。空体同理。
 */
export function parseRouteBody(body: Buffer): Record<string, unknown> {
  if (body.length === 0) return {}
  try {
    const parsed: unknown = JSON.parse(body.toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}
