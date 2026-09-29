import {
  BUILTIN_ROUTE_RULE_NAMES,
  createDefaultRouteRuleSet,
  ROUTE_RULE_DEFAULT_VARIABLE_PATH,
  ROUTE_RULE_SET_VERSION,
  type BuiltinRouteRuleId,
  type RouteRule,
  type RouteRuleCondition,
  type RouteRuleSet,
} from './route-rules'
import { createPresetModelPool, resolveLandingModelIds } from './presets'
import type { ConditionOperator, RuntimeLogicalModel } from './types'

/**
 * 规则表的内置预设：图侧 `ROUTER_POLICY_PRESETS` 在另一种模式里的对应物。
 *
 * 存在的理由与图侧一样 —— 给用户一个**能直接跑通的起点**，而不是一张只有默认表的清单让他自己从头改。
 * 差别来自两种模式的表达力：规则表没有循环、脚本、LLM 判定，所以预设只能是「读某个字段、按它分流」
 * 这一种骨架的不同取值；能选的字段也**只能是规则表自己那张来源表**（`ROUTE_RULE_FIELD_KINDS`）
 * 里读得到的路径 —— 列一个规则模式保证不了取到值的字段，套用后就是一个永远不命中的分支。
 *
 * 三个通用预设（按客户端来源 / 按请求模型名 / 按协议）刻意各占一种判定依据，且都只用一条条件：
 * 规则表的编辑器是**行内展开**的，一条规则拆成多条件反而让人一眼看不出「这条在读什么」。
 * 同类型的拼法只留一个，需要变体时在列表上改比多一个菜单项更好用。
 *
 * 与图侧完全一致的两条约束：
 *
 * 1. **落点在生成时定好**（`createPresetModelPool` / `resolveLandingModelIds`）：
 *    套用即能跑，不会一上手就报「没有可用逻辑模型」。
 * 2. **规则 id 固定**：菜单高亮哪一项靠 `isSameRouteRuleSet` 逐字节比 JSON（不含随机 id），
 *    用 `createRouteRule()` 那套随机 id 生成的话，每次生成都不一样，「当前套的是哪个预设」永远匹配不上。
 *
 * 预设生成的**内容**（条件取值、落点）会随保存落进数据库、被代理直接执行，属于用户数据；
 * 规则名是预设内容的稳定原文，也不能随语言变化，否则完整比对与保存去重会把同一预设认成两份。
 * 控制台按固定 `id + name` 识别这些规则，并在渲染层完成名称本地化。
 */

/** 内置规则预设的标识符集合。展示文案不在这里，而在渲染层的 `pages/router/rules/rules-preset-text.ts`。 */
export type RouterRulePresetId = 'model-direct' | 'client-source' | 'model-prefix' | 'protocol-routing'

export interface RouterRulePreset {
  id: RouterRulePresetId
  /** 是否是系统内建的默认规则表（列表第一项，可在任何时刻一键选回）。 */
  isDefault: boolean
  /** 生成预设规则表；落点逻辑模型由传入的当前逻辑模型列表定好，保证套用后即可运行。 */
  createRuleSet: (models: RuntimeLogicalModel[]) => RouteRuleSet
}

/** 条件一律是「字面值比较」：规则表按顺序读，比较值来自另一个字段会让「这条在读什么」需要两跳。 */
function literalCondition(fieldPath: string, operator: ConditionOperator, value: string): RouteRuleCondition {
  return {
    fieldPath,
    valueType: 'string',
    operator,
    valueSource: 'literal',
    valueFieldPath: '',
    value,
  }
}

/** 固定落点的内置规则：名称从稳定原文表派生，展示层再按界面语言翻译。 */
function fixedRule(id: BuiltinRouteRuleId, conditions: RouteRuleCondition[], logicalModelIds: string[]): RouteRule {
  return {
    id,
    name: BUILTIN_ROUTE_RULE_NAMES[id],
    enabled: true,
    logicalOperator: 'and',
    conditions,
    landing: { source: 'fixed', logicalModelIds, variablePath: ROUTE_RULE_DEFAULT_VARIABLE_PATH },
  }
}

/**
 * 客户端来源分流：`user-agent` 里出现客户端标识就落到对应逻辑模型，认不出的来源走兜底。
 *
 * 规则表只读一个头（没有图的「遍历所有头值」），所以这里认的是 `request.headers.user-agent`；
 * 客户端标识换成别自建的头名时，把条件里的来源改成「请求头」再填头名即可。
 */
export function createClientSourceRuleSet(models: RuntimeLogicalModel[]): RouteRuleSet {
  const pool = createPresetModelPool(models)
  return {
    version: ROUTE_RULE_SET_VERSION,
    rules: [
      fixedRule('rule-client-cursor', [literalCondition('request.headers.user-agent', 'contains', 'Cursor')], resolveLandingModelIds(pool, 0)),
      fixedRule('rule-client-claude-cli', [literalCondition('request.headers.user-agent', 'contains', 'claude-cli')], resolveLandingModelIds(pool, 1)),
    ],
    fallbackModelIds: resolveLandingModelIds(pool, null),
  }
}

/**
 * 请求模型名分流：按模型名前缀把请求分到不同逻辑模型。
 *
 * 用「匹配正则」而不是「等于 / 开头是」：模型名后面跟着版本号与日期后缀（`gpt-4o-mini-2024-07-18`、
 * `claude-3-5-sonnet-20241022`），正则不锚定尾部，前缀对上就算命中；两个前缀里都写 `^`
 * 是为了不让 `my-gpt-wrapper` 这种名字被误判成 OpenAI 的模型。
 *
 * 它读的是请求里的模型名（`request.body.model`）而不是「可用逻辑模型 id 列表」：
 * 分流要回答的是「客户端这次点名要什么」，与本次有哪些逻辑模型可用无关。
 */
export function createModelPrefixRuleSet(models: RuntimeLogicalModel[]): RouteRuleSet {
  const pool = createPresetModelPool(models)
  return {
    version: ROUTE_RULE_SET_VERSION,
    rules: [
      fixedRule('rule-model-claude', [literalCondition('request.body.model', 'regex', '^claude')], resolveLandingModelIds(pool, 0)),
      fixedRule('rule-model-openai', [literalCondition('request.body.model', 'regex', '^(gpt|o[1-9])')], resolveLandingModelIds(pool, 1)),
    ],
    fallbackModelIds: resolveLandingModelIds(pool, null),
  }
}

/**
 * 协议分流：按这次请求命中的协议落到不同逻辑模型。
 *
 * `route.protocol` 是入口就认出来的**一手事实**（引擎写进 payload，规则表只能读），
 * 所以这条预设不需要任何解析动作：同一个模型在不同协议下表现不一致时，它能直接把协议与上游对齐。
 * 三条协议分支只列两条，`unknown`（认不出协议）落进兜底 —— 认不出协议时按最保守的那条走。
 */
export function createProtocolRoutingRuleSet(models: RuntimeLogicalModel[]): RouteRuleSet {
  const pool = createPresetModelPool(models)
  return {
    version: ROUTE_RULE_SET_VERSION,
    rules: [
      fixedRule('rule-protocol-anthropic', [literalCondition('route.protocol', 'equals', 'anthropic-messages')], resolveLandingModelIds(pool, 0)),
      fixedRule('rule-protocol-responses', [literalCondition('route.protocol', 'equals', 'openai-responses')], resolveLandingModelIds(pool, 1)),
    ],
    fallbackModelIds: resolveLandingModelIds(pool, null),
  }
}

/**
 * 规则预设清单：第一个是内建默认规则表，其余三个各演示一种判定依据。
 *
 * 默认预设就是 `createDefaultRouteRuleSet`（与内建默认策略行为等价，见 `route-rules.ts`）——
 * 不在这里另写一份，是因为「一版都没保存过时代理跑的那张表」与「菜单里选回默认」必须是同一个函数，
 * 否则两条路径迟早漂移成两个东西。
 */
export const ROUTER_RULE_PRESETS: RouterRulePreset[] = [
  {
    id: 'model-direct',
    isDefault: true,
    createRuleSet: createDefaultRouteRuleSet,
  },
  {
    id: 'client-source',
    isDefault: false,
    createRuleSet: createClientSourceRuleSet,
  },
  {
    id: 'model-prefix',
    isDefault: false,
    createRuleSet: createModelPrefixRuleSet,
  },
  {
    id: 'protocol-routing',
    isDefault: false,
    createRuleSet: createProtocolRoutingRuleSet,
  },
]

export function findRulePreset(id: string): RouterRulePreset | undefined {
  return ROUTER_RULE_PRESETS.find(preset => preset.id === id)
}
