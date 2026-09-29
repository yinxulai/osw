import { createRouteContextInput, evaluateConditionGroup, normalizeModelIds, resolveConditionField, resolveLogicalModelIds, type ConditionRuleEvaluation } from './engine'
import type { RouteRule, RouteRuleSet } from './route-rules'
import type { ConditionLogicalOperator, RouteContextInput, RouteDecision, RuntimeLogicalModel, WorkflowProtocol } from './types'

/**
 * 规则表的执行器：从上往下逐条匹配，第一条命中且给得出落点的规则胜出，都不命中就走兜底。
 *
 * 「顺序即优先级」是这里唯一的结构化控制流，没有跳转、没有循环、没有回边 ——
 * 这正是规则模式存在的理由：简单场景下用户要的是「一眼读完全部语义」，
 * 而不是为同一条判定在画布上接三根线。
 *
 * 判定语言与图**完全共用**（`evaluateConditionGroup` / `resolveConditionField`）：
 * 同一个条件写在规则表里与写在条件节点上，结果必须一模一样，否则两个模式就没法互相解释。
 */

/** 一条规则里某条条件的判定明细。 */
export type RouteRuleConditionStep = ConditionRuleEvaluation

/** 一条规则这一次的判定结果；未启用的规则也会出现在步骤里（如实说明「它被跳过了」）。 */
export interface RouteRuleStep {
  ruleId: string
  ruleName: string
  enabled: boolean
  /** 条件是否整体成立。未启用时恒为 `false`。 */
  matched: boolean
  /** 命中后该规则给出的落点；未命中（或命中但给不出落点）时为空数组。 */
  logicalModelIds: string[]
  /** 判定依据：逐条条件的取值与结果，按配置顺序 */
  conditions: RouteRuleConditionStep[]
}

/**
 * 规则表的运行结果。
 *
 * 与图侧不同的是这里不带节点轨迹：规则表没有节点，能解释「为什么是这条」的东西
 * 就是每条规则的条件取值（`steps`），再套一层节点轨迹只会把同一件事说第二遍。
 */
export interface RouteRuleRunResult {
  /** 胜出的规则 id；没有任何规则胜出（走了兜底）时为 `null` */
  matchedRuleId: string | null
  /** 最终落点逻辑模型，按优先级排列 */
  logicalModelIds: string[]
  /** 落点是否来自兜底 */
  fallback: boolean
  /** 每条规则的判定经过，供测试运行核对 */
  steps: RouteRuleStep[]
  /** 这次请求的协议（调用方声明的那一个；没声明就是 `unknown`） */
  protocol: WorkflowProtocol
  /** 客户端跳的传输形态 */
  transport: RouteDecision['transport']
  /** 停下来时的原因：`rule` 表示某条规则胜出，`fallback` 表示走了兜底 */
  stopReason: 'rule' | 'fallback'
}

/** 规则命中后给出的落点：`fixed` 取指定列表，`variable` 把字段取值当逻辑模型（先按 id 认、再按名称认）。 */
function resolveRuleLandingModelIds(rule: RouteRule, payload: Record<string, unknown>, logicalModels: RuntimeLogicalModel[]): string[] {
  if (rule.landing.source !== 'variable') {
    return normalizeModelIds(rule.landing.logicalModelIds)
  }

  const path = rule.landing.variablePath.trim()
  if (!path) return []
  // 取值走与条件同一套字段解析：`request.headers.<名字>` 在这里同样大小写不敏感，
  // 否则同一条路径在条件里读得到、在落点上读不到，用户没法自己解释。
  // 读到什么当落点则按「先 id、再名称」翻译（见 `resolveLogicalModelIds`）：
  // 条件用 `logicalModels[*].name` 命中时，落点取的通常就是同一个字段。
  return resolveLogicalModelIds(resolveConditionField(payload, path), logicalModels)
}

/**
 * 判定一组条件。
 *
 * **空条件恒成立**：规则表允许「一条规则不写条件」，它的意思就是「无条件命中」——
 * 那正是「前面都不匹配就落这里」在规则表里的写法。图的 `and`/`or` 语义在这里不适用，
 * 因为「零个条件的 or」不该被解释成「永不命中」。
 */
function evaluateRuleConditions(conditions: RouteRule['conditions'], logicalOperator: ConditionLogicalOperator, payload: Record<string, unknown>): { matched: boolean; conditions: RouteRuleConditionStep[] } {
  if (conditions.length === 0) return { matched: true, conditions: [] }
  return evaluateConditionGroup(conditions, logicalOperator, payload)
}

export function runRouteRules(ruleSet: RouteRuleSet, inputPayload: RouteContextInput): RouteRuleRunResult {
  const envelope = createRouteContextInput(inputPayload)
  const payload = envelope.payload
  const route = payload.route as RouteDecision
  const steps: RouteRuleStep[] = []

  for (const rule of ruleSet.rules) {
    if (!rule.enabled) {
      steps.push({ ruleId: rule.id, ruleName: rule.name, enabled: false, matched: false, logicalModelIds: [], conditions: [] })
      continue
    }

    const evaluation = evaluateRuleConditions(rule.conditions, rule.logicalOperator, payload)
    if (!evaluation.matched) {
      steps.push({ ruleId: rule.id, ruleName: rule.name, enabled: true, matched: false, logicalModelIds: [], conditions: evaluation.conditions })
      continue
    }

    const logicalModelIds = resolveRuleLandingModelIds(rule, payload, envelope.context.logicalModels)
    steps.push({ ruleId: rule.id, ruleName: rule.name, enabled: true, matched: true, logicalModelIds, conditions: evaluation.conditions })
    // 命中却给不出落点：这条规则的解释是「它不成立」，继续往下匹配，而不是在这里再兜一层。
    // 因此它不算胜出，步骤里保留 `matched: true` + 空落点，测试运行才解释得清「为什么没落到这儿」。
    if (logicalModelIds.length === 0) continue

    return {
      matchedRuleId: rule.id,
      logicalModelIds,
      fallback: false,
      steps,
      protocol: route.protocol,
      transport: route.transport,
      stopReason: 'rule',
    }
  }

  return {
    matchedRuleId: null,
    logicalModelIds: normalizeModelIds(ruleSet.fallbackModelIds),
    fallback: true,
    steps,
    protocol: route.protocol,
    transport: route.transport,
    stopReason: 'fallback',
  }
}
