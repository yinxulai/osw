import type { UiCatalogKey } from '@common/i18n/catalogs'
import { ROUTE_RULE_FIELD_KINDS } from '@common/router/route-rules'
import type { SchemaValueType } from '@common/router/types'

/** 规则模式里一条可填的字段路径：路径本身 + 它读到的是什么。 */
export interface RulePathHint {
  path: string
  valueType: SchemaValueType
  /** 说明文案的目录 key；拼装时取自来源表自己的标签。 */
  noteKey?: UiCatalogKey
}

/**
 * 规则模式的字段候选表：就是**规则表自己声明的那几个来源**（`ROUTE_RULE_FIELD_KINDS`）。
 *
 * 这张表不许从图那边借字段。图上的请求体字段是**协议解析出来的**——协议发现节点按它连上的
 * 端口，把那条协议的请求体形状声明给下游（声明表在 `@common/router/request-shape`）。
 * 规则表没有协议解析器、也没有端口，它连这次请求是不是 JSON 都不知道，「请求体里有 `messages`」
 * 「系统提示词在 `system`」这种话它说不出口。把它说不出口的路径列进候选，用户就会照着配出
 * 一条在别的协议上永远取不到值的条件 —— 列出来不等于有这个字段，只等于替它声称有。
 *
 * 说得出的是它自己那张来源表：请求头、请求模型名、请求路径、方法、协议、请求体字段、元信息、
 * 可用逻辑模型 id、自定义路径。其中「请求头名」「请求体字段名」「元信息键」「自定义路径」这些
 * **要自己补名称**（`needsName`）的来源没有一条完整路径可列：前缀后面接什么是调用方的事，
 * 列一行半截路径等于把人送到一半，所以它们只出现在左侧的来源下拉里。
 *
 * 拼装而不是手抄，是因为手抄那一份必然会在某个时刻与声明分叉：来源表里换掉一个前缀，
 * 候选表还留着旧的，用户照着点就配出一条没人认得的路径。图侧 `field-hints.test.ts` 对候选表
 * 的反查是同一个口径：候选表必须跟着声明走，声明改了候选表不改，那条用例当场红掉。
 */
function composeRulePathHints(): RulePathHint[] {
  const hints: RulePathHint[] = []
  const seen = new Set<string>()
  for (const meta of ROUTE_RULE_FIELD_KINDS) {
    if (meta.needsName || !meta.prefix) continue
    if (seen.has(meta.prefix)) continue
    seen.add(meta.prefix)
    // 说明与被比较时的取值类型都取自来源表本身：同一张表、同一句话，两个控件不会各说各的。
    hints.push({ path: meta.prefix, valueType: meta.valueType, noteKey: meta.labelKey })
  }
  return hints
}

export const RULE_PATH_HINTS: readonly RulePathHint[] = composeRulePathHints()

/**
 * 「落点用请求里的字段」那一格的候选。
 *
 * 取到的值会被**直接当成逻辑模型 id** 用，所以对象、布尔这些值在这里没有意义 —— 这条收窄与
 * 图侧逻辑模型选择节点共用同一口径（`panel/field-candidates.ts` 里 `model-select` 只收
 * `string` / `array`）：**相通的是这条口径，不是候选清单**，清单本身仍是规则表自己那几条。
 *
 * 筛掉不等于禁止：候选是提示不是白名单，手写一条来源表之外的路径照样生效。
 */
export const RULE_VARIABLE_PATH_HINTS: readonly RulePathHint[] = RULE_PATH_HINTS.filter(
  hint => hint.valueType === 'string' || hint.valueType === 'array',
)

/**
 * 按关键词过滤候选路径——匹配**行里看得见的两样**：路径与它的说明。
 *
 * 说明文案要本地化，因此说明取值由 `noteOf` 注入（调用方用 `t(hint.noteKey)` 拼好传进来），
 * 过滤本身保持零 React、可单测。关键词空白时原样返回。
 */
export function filterPathHints(hints: readonly RulePathHint[], keyword: string, noteOf: (hint: RulePathHint) => string): readonly RulePathHint[] {
  const normalized = keyword.trim().toLowerCase()
  if (!normalized) return hints
  return hints.filter(hint => hint.path.toLowerCase().includes(normalized) || noteOf(hint).toLowerCase().includes(normalized))
}

