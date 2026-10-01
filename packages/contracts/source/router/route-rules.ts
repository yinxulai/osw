import { z } from 'zod'

import type { UiCatalogKey } from '@common/i18n/catalogs'
import { ConditionRuleSchema } from './schemas'
import { createPresetModelPool, resolveLandingModelIds } from './presets'
import type { RuntimeLogicalModel, SchemaValueType } from './types'

/**
 * 路由规则表：智能路由的第二种形态。
 *
 * 与工作流图**完全独立**：两者各自是一份真相、各自有自己的编辑器，
 * 同一时刻由 `settings.routeMode` 决定代理执行哪一份（见 `@common/schemas` 的 `RouteModeSchema`）。
 * 独立性还体现在存储上：两者共用 `workflows` 表但一行一版、版本号各算各的，
 * 所以回滚一版图不会碰到规则表，反过来也一样。
 * 把规则表做成图的另一种投影会让两边都难以解释 —— 图能做循环与脚本，规则表不能，
 * 于是「这张图能不能用规则改」永远需要一个说得清的判据，而用户并不想知道那个判据。
 *
 * 生命周期两个模式也是同一套：**改完显式保存成一个新版本**。
 * 一张按顺序读的清单同样会有「改到一半」的时刻（拖到别的位置、条件还没填完、落点要换一换），
 * 而这些中间状态一次都不该落到代理身上；版本能力让「列表上正在编的」与「正在生效的」
 * 有一个用户自己按下去的分界点，也给了规则表回滚到上一版的机会。
 *
 * 规则表刻意不复用图的任何结构，只复用**判定语言**（`ConditionRule`）与**字段语义**
 * （`request.headers.<名字>` 按头名大小写不敏感解析，见 `engine.ts`）：
 * 条件的写法与判定结果在两个模式里必须一一对应，否则「同一个条件换个模式就变了个意思」。
 */

export const ROUTE_RULE_SET_VERSION = 1

/**
 * 「一版都没保存过」占用的版本号。
 *
 * 读当前生效的规则表时用它表示这份表是内建默认表、不来自任何已保存版本（真实版本号从 1 开始），
 * 因此拿到它不能去读历史版本，也不能把这张表当成「用户存下来的」；
 * 代理解析结果里的 `definitionVersion` 用它区分两者。
 */
export const UNSAVED_ROUTE_RULE_VERSION = 0

/**
 * 规则条数上限。
 *
 * 规则表按顺序线性匹配，条数直接决定每次请求的判定成本；上限同时也是编辑器的刹车 ——
 * 真需要几百条规则时，该优化的是判定条件本身，而不是继续往表里加行。
 */
export const MAX_ROUTE_RULES = 50

/**
 * 保留的规则表版本上限：超出后把最旧的版本软删除，它只是不再出现在版本列表里。
 *
 * 与图的 30 版同一个口径：规则表一版只有几十行，留得住，但也没必要无限堆。
 */
export const MAX_ROUTE_RULE_VERSIONS = 30

/** 「落点用请求里的模型名」默认读的字段：三种协议的请求模型名都在这一处。 */
export const ROUTE_RULE_DEFAULT_VARIABLE_PATH = 'request.body.model'

/**
 * 内置规则落库时使用的稳定名称。
 *
 * 名称本身不参与路由判定，但它是预设内容的一部分，所以不能随界面语言变化：
 * 否则同一份预设会在不同语言下生成两个不同的规则表，`isSameRouteRuleSet` 与保存去重都会失效。
 * 控制台按 `id + name` 识别这些原文并在渲染层本地化。
 */
export const BUILTIN_ROUTE_RULE_NAMES = {
  'rule-model-direct': '请求模型是逻辑模型就直连',
  'rule-client-cursor': 'Cursor 客户端',
  'rule-client-claude-cli': 'Claude CLI 客户端',
  'rule-model-claude': 'Claude 模型',
  'rule-model-openai': 'GPT / o 系列模型',
  'rule-protocol-anthropic': 'Anthropic Messages 请求',
  'rule-protocol-responses': 'OpenAI Responses 请求',
} as const

export type BuiltinRouteRuleId = keyof typeof BUILTIN_ROUTE_RULE_NAMES

/**
 * 规则的落点：命中后把哪些逻辑模型交给调度器。
 *
 * 与图里的逻辑模型选择节点同义（`fixed` 取指定列表，`variable` 把字段取值当逻辑模型 id），
 * 因为「请求哪个模型就直连哪个模型」是两种模式共同的第一需求，不能只有图能表达。
 * 与节点不同的一点：这里**没有**规则级兜底列表 ——
 * 一条规则命中却给不出落点时，它的语义是「这条不成立」，继续往下匹配，
 * 而不是在规则内部再兜一层。少一层嵌套，顺序读下来就是全部语义。
 */
export const RouteRuleLandingSchema = z.object({
  source: z.enum(['fixed', 'variable']),
  /** `fixed` 的落点逻辑模型，按优先级排列 */
  logicalModelIds: z.array(z.string().min(1)).default([]),
  /** `variable` 的取值字段 */
  variablePath: z.string().default(ROUTE_RULE_DEFAULT_VARIABLE_PATH),
})

export const RouteRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  enabled: z.boolean(),
  /** 多条条件之间的组合方式 */
  logicalOperator: z.enum(['and', 'or']),
  /**
   * 命中条件。
   *
   * 允许空数组：空条件表示「无条件命中」，这是「前面都不匹配就落这里」的合法写法。
   */
  conditions: z.array(ConditionRuleSchema),
  landing: RouteRuleLandingSchema,
})

/**
 * 规则表本体。
 *
 * `fallbackModelIds` 是表级的兜底落点：所有规则都不命中（或都不给落点）时用它，
 * 它是整张表唯一一条不在规则列表里的落点，因此也没有条件可配 —— 顺序即优先级，
 * 兜底的意思就是「顺序上排在所有规则之后」。
 */
export const RouteRuleSetSchema = z.object({
  version: z.literal(ROUTE_RULE_SET_VERSION),
  rules: z.array(RouteRuleSchema).max(MAX_ROUTE_RULES),
  fallbackModelIds: z.array(z.string().min(1)).default([]),
})

export type RouteRuleLanding = z.infer<typeof RouteRuleLandingSchema>
export type RouteRuleCondition = z.infer<typeof ConditionRuleSchema>
export type RouteRule = z.infer<typeof RouteRuleSchema>
export type RouteRuleSet = z.infer<typeof RouteRuleSetSchema>

/** 当前生效的规则表：代理运行时读的就是这一份（一版都没保存过时是内建默认表）。 */
export interface RouteRuleSnapshot {
  ruleSet: RouteRuleSet
  /** 这一版的记录 id；内建默认表不属于任何已保存版本，为 `null` */
  id: string | null
  /** 展示用的版本号；内建默认表固定为 `UNSAVED_ROUTE_RULE_VERSION` */
  version: number
  /** 保存时间（epoch 毫秒）；内建默认表没有保存时间，为 0 */
  savedAt: number
}

/**
 * 已保存的规则表版本摘要。
 *
 * 与图一样只带摘要不带正文：一版规则表有几十行条件，列 30 版会把列表接口撑成几百 KB，
 * 而列表里真正要显示的只有「第几版 / 什么时候 / 几条规则」。
 */
export interface RouteRuleSetVersionSummary {
  /** **数据记录 id**：这一版的身份，读/恢复某一版时传它 */
  id: string
  /** 展示用的版本号（v1、v2 …），单调递增，只用来在界面上标「第几版」 */
  version: number
  /** 用户给这一版起的名字；没起名时是空字符串 */
  name: string
  /** 这次保存给版本写的说明；没写时是空字符串 */
  description: string
  /** 保存时间（epoch 毫秒） */
  savedAt: number
  /** 该版本的规则条数，用于列表摘要 */
  ruleCount: number
}

/** 保存的结果；内容与最新版本一致时 `created` 为假、版本号沿用最新那个。 */
export interface RouteRuleSetSaveResult extends RouteRuleSetVersionSummary {
  created: boolean
}

// ========== 字段来源 ==========
//
// 规则条件读的是**请求本身**，不需要先在画布上把上游接起来，所以这里不按「上游有哪些节点」
// 生成候选路径（图侧的 `field-hints.ts` 就是那么做的），而是列一张固定的短表：
// 简单场景要用的字段一共就这几个，全部摆出来比让人先去接线更接近「简单好用」。

/** 条件取值的一个来源：一个来源 + 一段名称，拼成条件上的 `fieldPath`。 */
export type RouteRuleFieldKind =
  /** 请求头；头名由用户填，引擎按大小写不敏感解析 */
  | 'header'
  /** 请求模型名：三种协议的请求模型名都在 `request.body.model` */
  | 'model'
  /** 请求体里的任意字段（不做协议归一化，读的就是客户端发来的原样结构） */
  | 'body'
  | 'path'
  | 'method'
  /** 这次请求命中的协议 */
  | 'protocol'
  /** 这次请求的传输形态（http / http-stream / websocket）：入口就定下了，规则只能读 */
  | 'transport'
  /** 当前可用的逻辑模型 id 列表 */
  | 'logicalModelIds'
  /** 调用方自带的元信息 */
  | 'metadata'
  /** 以上都不合适时直接写路径 */
  | 'custom'

export interface RouteRuleFieldKindMeta {
  kind: RouteRuleFieldKind
  /** 该来源拼出的路径前缀；`custom` 为空串（整条路径都是用户写的） */
  prefix: string
  /** 该来源取到的值类型，用来收窄可用的操作符 */
  valueType: SchemaValueType
  labelKey: UiCatalogKey
  /** 是否需要用户再补一段名称（头名 / 体字段 / 元信息键 / 自定义路径） */
  needsName: boolean
  /** 名称输入框的占位提示 */
  namePlaceholderKey?: UiCatalogKey
}

/**
 * 条件可用的字段来源，**顺序即下拉顺序**：最常写的排前面。
 *
 * 这张表是规则模式对「能读什么」的全部声称：没列在这里的路径只能用 `custom` 手写，
 * 手写的路径一样生效（引擎读的是 `fieldPath`），只是编辑器不替它保证类型与操作符。
 */
export const ROUTE_RULE_FIELD_KINDS: readonly RouteRuleFieldKindMeta[] = [
  { kind: 'header', prefix: 'request.headers.', valueType: 'string', labelKey: 'router.rules.field.header', needsName: true, namePlaceholderKey: 'router.rules.field.headerPlaceholder' },
  { kind: 'model', prefix: ROUTE_RULE_DEFAULT_VARIABLE_PATH, valueType: 'string', labelKey: 'router.rules.field.model', needsName: false },
  { kind: 'path', prefix: 'request.path', valueType: 'string', labelKey: 'router.rules.field.path', needsName: false },
  { kind: 'method', prefix: 'request.method', valueType: 'string', labelKey: 'router.rules.field.method', needsName: false },
  { kind: 'protocol', prefix: 'route.protocol', valueType: 'string', labelKey: 'router.rules.field.protocol', needsName: false },
  { kind: 'transport', prefix: 'route.transport', valueType: 'string', labelKey: 'router.rules.field.transport', needsName: false },
  { kind: 'body', prefix: 'request.body.', valueType: 'unknown', labelKey: 'router.rules.field.body', needsName: true, namePlaceholderKey: 'router.rules.field.bodyPlaceholder' },
  { kind: 'metadata', prefix: 'metadata.', valueType: 'unknown', labelKey: 'router.rules.field.metadata', needsName: true, namePlaceholderKey: 'router.rules.field.metadataPlaceholder' },
  { kind: 'logicalModelIds', prefix: 'logicalModels[*].modelId', valueType: 'string', labelKey: 'router.rules.field.logicalModelIds', needsName: false },
  { kind: 'custom', prefix: '', valueType: 'unknown', labelKey: 'router.rules.field.custom', needsName: true, namePlaceholderKey: 'router.rules.field.customPlaceholder' },
]

export interface RouteRuleFieldSpec {
  kind: RouteRuleFieldKind
  /** `needsName` 的来源必填；其余来源忽略它 */
  name: string
}

const CUSTOM_FIELD_KIND_META = ROUTE_RULE_FIELD_KINDS[ROUTE_RULE_FIELD_KINDS.length - 1] as RouteRuleFieldKindMeta

/** 取某个来源的元信息；未知来源退化成 `custom`，旧数据不会把界面打崩。 */
export function routeRuleFieldKindMeta(kind: RouteRuleFieldKind): RouteRuleFieldKindMeta {
  return ROUTE_RULE_FIELD_KINDS.find(item => item.kind === kind) ?? CUSTOM_FIELD_KIND_META
}

/** 来源 + 名称 → 条件上的 `fieldPath`。 */
export function toRouteRuleFieldPath(spec: RouteRuleFieldSpec): string {
  const meta = routeRuleFieldKindMeta(spec.kind)
  return `${meta.prefix}${meta.needsName ? spec.name.trim() : ''}`
}

/**
 * `fieldPath` → 来源 + 名称。
 *
 * 先认「整条路径就是字段」的那几种，再认带前缀的几种，最后落到 `custom` ——
 * 手写路径也必须能在编辑器里原样打开，否则改一个字符就得整条重写。
 */
export function parseRouteRuleFieldPath(fieldPath: string): RouteRuleFieldSpec {
  const path = fieldPath.trim()
  for (const meta of ROUTE_RULE_FIELD_KINDS) {
    if (meta.needsName) continue
    if (path === meta.prefix) return { kind: meta.kind, name: '' }
  }
  for (const meta of ROUTE_RULE_FIELD_KINDS) {
    if (!meta.needsName || !meta.prefix) continue
    if (path.startsWith(meta.prefix)) return { kind: meta.kind, name: path.slice(meta.prefix.length) }
  }
  return { kind: 'custom', name: path }
}

/** 某个字段来源取到的值类型；`custom` 与请求体字段都认不准，给 `unknown`（不收窄操作符）。 */
export function routeRuleFieldValueType(fieldPath: string): SchemaValueType {
  return routeRuleFieldKindMeta(parseRouteRuleFieldPath(fieldPath).kind).valueType
}

// ========== 默认表与工厂 ==========

/** 新建一条规则：字段与条件直接摆最常见的那条（按 UA 分流），改个值就能用。 */
export function createRouteRule(landingModelIds: string[] = []): RouteRule {
  return {
    id: `rule-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    name: '',
    enabled: true,
    logicalOperator: 'and',
    conditions: [createRouteRuleCondition()],
    landing: { source: 'fixed', logicalModelIds: [...landingModelIds], variablePath: ROUTE_RULE_DEFAULT_VARIABLE_PATH },
  }
}

/**
 * 新建一条规则条件。
 *
 * 默认值给「按 UA 分流」而不是图侧那种「方法等于 POST」：后者几乎对所有代理请求都成立，
 * 新加一条规则就立刻抢走全部流量，用户还得先反应过来是默认值闯的祸。
 */
export function createRouteRuleCondition(): RouteRuleCondition {
  return {
    fieldPath: 'request.headers.user-agent',
    valueType: 'string',
    operator: 'contains',
    valueSource: 'literal',
    valueFieldPath: '',
    value: 'Cursor',
  }
}

/**
 * 内建默认规则表：请求模型是逻辑模型就直连它，否则落到默认逻辑模型。
 *
 * 它与内建默认策略（`createDefaultPolicyGraph`）**行为等价**，因为这两种模式要回答的第一个问题
 * 是同一个。等价让「切换模式」在默认状态下不改变任何行为，用户才有底气去试另一种模式。
 *
 * 写法上只用了一条规则 + 一次字段比较：命中条件就是「请求里的模型名在逻辑模型 id 列表里」，
 * 落点直接取同一个字段 —— 「同一个事实读两遍」这件事在规则表里是显式的，
 * 不像图里要靠一条连线把变量取值接到落点上。
 */
export function createDefaultRouteRuleSet(models: RuntimeLogicalModel[]): RouteRuleSet {
  const pool = createPresetModelPool(models)
  return {
    version: ROUTE_RULE_SET_VERSION,
    rules: [
      {
        id: 'rule-model-direct',
        name: BUILTIN_ROUTE_RULE_NAMES['rule-model-direct'],
        enabled: true,
        logicalOperator: 'and',
        conditions: [
          {
            fieldPath: ROUTE_RULE_DEFAULT_VARIABLE_PATH,
            valueType: 'string',
            operator: 'in',
            valueSource: 'field',
            valueFieldPath: 'logicalModels[*].modelId',
          },
        ],
        landing: {
          source: 'variable',
          logicalModelIds: [],
          variablePath: ROUTE_RULE_DEFAULT_VARIABLE_PATH,
        },
      },
    ],
    fallbackModelIds: resolveLandingModelIds(pool, null),
  }
}

/** 规则表是否完全一致：版本号相同、规则逐条相同（顺序也算）、兜底相同。 */
export function isSameRouteRuleSet(left: RouteRuleSet, right: RouteRuleSet): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
