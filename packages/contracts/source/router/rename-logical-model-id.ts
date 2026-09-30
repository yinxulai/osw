import type { RouteRuleSet } from './route-rules'
import type { ConditionRule, WorkflowGraph, WorkflowNodeModel } from './types'

/**
 * 逻辑模型 id 改名时，把路由定义里「按 id 指向它」的地方一起改写。
 *
 * 定义（工作流图 / 规则表）对逻辑模型的引用只有两种会写死 id：
 *
 *   1. **结构化引用**：逻辑模型选择节点与规则落点上的 `modelIds` / `fallbackModelIds` /
 *      `logicalModelIds`；
 *   2. **字面量条件**：条件规则用固定值（`valueSource !== 'field'`）时，`value` 恰好等于这个
 *      id，表达「请求模型就是某个具体逻辑模型」。
 *
 * 这两处必须跟着 id 一起走：id 是唯一身份，改名之后它们若不改，落点就指向一个不存在的
 * 逻辑模型，路由会静默退化成兜底。反过来，用 `request.body.model in logicalModels[*].modelId`
 * 这类**字段比较**写的条件不需要动 —— 它比的是运行时列表，id 改了自然跟上。
 *
 * 刻意不改写的东西：
 *   - **脚本节点里的字符串**：那是任意 JavaScript，不求出值就无法判断哪个字符串是逻辑模型 id，
 *     猜错比不改更糟。脚本里写死的 id 需要用户自己改；
 *   - **历史请求记录**：那是观测数据、是不可变事实，记录的是「当时发生了什么」。
 *
 * 本模块只做纯函数改写，不认识数据库；落库与事务由 `logical-model-store` 负责。
 */

function rewriteModelIds(ids: string[], from: string, to: string): string[] {
  return ids.some(id => id === from) ? ids.map(id => (id === from ? to : id)) : ids
}

function rewriteCondition<T extends ConditionRule>(condition: T, from: string, to: string): T {
  // `field` 来源比的是运行时取值，与 id 字面量无关。
  if (condition.valueSource === 'field') return condition
  if (condition.value !== from) return condition
  return { ...condition, value: to }
}

function rewriteConditions<T extends ConditionRule>(conditions: T[], from: string, to: string): T[] {
  let changed = false
  const next = conditions.map(condition => {
    const rewritten = rewriteCondition(condition, from, to)
    if (rewritten !== condition) changed = true
    return rewritten
  })
  return changed ? next : conditions
}

function rewriteNode(node: WorkflowNodeModel, from: string, to: string): WorkflowNodeModel {
  if (node.kind === 'model-select') {
    const modelIds = rewriteModelIds(node.modelIds, from, to)
    const fallbackModelIds = rewriteModelIds(node.fallbackModelIds, from, to)
    if (modelIds === node.modelIds && fallbackModelIds === node.fallbackModelIds) return node
    return { ...node, modelIds, fallbackModelIds }
  }
  if (node.kind === 'condition') {
    let changed = false
    const cases = node.cases.map(entry => {
      const conditions = rewriteConditions(entry.conditions, from, to)
      if (conditions === entry.conditions) return entry
      changed = true
      return { ...entry, conditions }
    })
    return changed ? { ...node, cases } : node
  }
  return node
}

/**
 * 把工作流图里指向 `from` 的逻辑模型引用改成 `to`。
 *
 * 没有任何引用时原样返回同一个对象（引用相等），调用方可以据此跳过写库。
 */
export function renameLogicalModelIdInGraph(graph: WorkflowGraph, from: string, to: string): WorkflowGraph {
  let changed = false
  const nodes = graph.nodes.map(node => {
    const next = rewriteNode(node, from, to)
    if (next !== node) changed = true
    return next
  })
  return changed ? { ...graph, nodes } : graph
}

/**
 * 把规则表里指向 `from` 的逻辑模型引用改成 `to`。
 *
 * 覆盖表级兜底落点、每条规则落点上的固定列表，以及固定值条件。
 * 没有任何引用时原样返回同一个对象（引用相等）。
 */
export function renameLogicalModelIdInRuleSet(ruleSet: RouteRuleSet, from: string, to: string): RouteRuleSet {
  let changed = false
  const fallbackModelIds = rewriteModelIds(ruleSet.fallbackModelIds, from, to)
  if (fallbackModelIds !== ruleSet.fallbackModelIds) changed = true
  const rules = ruleSet.rules.map(rule => {
    const logicalModelIds = rewriteModelIds(rule.landing.logicalModelIds, from, to)
    const conditions = rewriteConditions(rule.conditions, from, to)
    if (logicalModelIds === rule.landing.logicalModelIds && conditions === rule.conditions) return rule
    changed = true
    return {
      ...rule,
      conditions,
      landing: logicalModelIds === rule.landing.logicalModelIds ? rule.landing : { ...rule.landing, logicalModelIds },
    }
  })
  return changed ? { ...ruleSet, rules, fallbackModelIds } : ruleSet
}
