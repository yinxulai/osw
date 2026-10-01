/**
 * 协议转换的请求上下文：命名空间工具名的双向映射表。
 *
 * Responses 的 `tools` 里可以有 `type: "namespace"` 的**工具组**，组内工具用
 * `(namespace, name)` 两个字段共同寻址（见 `apps/docs/references/openai-responses.md` 的
 * `Namespace object` 与 `function_call.namespace`）。Chat Completions 与 Anthropic
 * 都没有命名空间维度，只有一维的工具名，因此要支持这组工具就必须「展平」——
 * 但展平只有在能**还原**回 `(namespace, name)` 时才成立，否则客户端收到
 * `name: "crm__lookup"` 会认不出这是它声明的哪个工具。
 *
 * 还原不靠在字符串里编码分隔符（工具名原生就可能含分隔符，拆字符串必然出错），
 * 而是靠这张**只存在于本次尝试内存里的表**：请求转换时登记，响应转换时查询。
 * 于是展平名怎么取都不影响正确性——撞名就换后缀，超长就截断——
 * 只要登记完查得回来，`(namespace, name)` 就不会丢。
 *
 * 生命周期：每次上游尝试一个实例（见 `attempt-executor.ts`）。请求转换先跑、
 * 响应转换后跑，两者共享同一个实例，因此不需要任何跨请求的全局状态。
 */

/**
 * 工具名在目标协议里的约束：Chat Completions 要求 `a-z A-Z 0-9 _ -`，最长 64
 * （见 `apps/docs/references/openai-completions.md` 的 `FunctionDefinition.name`）。
 * 命名空间目前只出现在 Responses 方向，因此取这条约束就够。
 */
const TARGET_NAME_MAX_LENGTH = 64
const ILLEGAL_NAME_CHARACTERS = /[^A-Za-z0-9_-]/g

/** 展平名里的命名空间分隔符；只用来生成可读的名字，不承担还原职责。 */
const NAMESPACE_SEPARATOR = '__'

/** 一个命名空间工具的原始坐标。 */
export interface NamespacedToolIdentity {
  readonly namespace: string
  readonly name: string
}

function toTargetNamePart(value: string): string {
  return value.replace(ILLEGAL_NAME_CHARACTERS, '_')
}

/**
 * 把任意字符串归一化成目标协议合法的**独立**名字：字符集同上，并截断到 64 字符。
 *
 * 这跟 `flatten` 不同：它不承担还原职责，所以只能用在「客户端看不到回显」的字段上，
 * 目前是 `response_format.json_schema.name`（两侧约束相同，且响应不回显这个名字）。
 * 工具名一律走 `reserve` / `flatten`，因为客户端必须能认出自己声明的名字。
 */
export function toTargetName(value: string): string {
  return toTargetNamePart(value).slice(0, TARGET_NAME_MAX_LENGTH)
}

/**
 * 记忆一次尝试里「命名空间工具 ↔ 目标协议工具名」的对应关系。
 *
 * 无状态转换器（纯函数 + 流式状态机）不持有请求上下文，所以上下文由调用方持有并透传：
 * 请求转换往里**写**，响应转换往里**查**。表里没有的名字（非命名空间工具、或模型臆造的名字）
 * 查询返回 `undefined`，调用方按原样输出即可。
 *
 * 查询有两个方向，分别服务「上游看到什么」与「客户端看到什么」：
 * - `locate`：客户端给的名字 → 上游看到的目标名（请求侧的 `tool_choice`）；
 * - `restore`：上游回来的目标名 → 客户端声明的 `(namespace, name)`（响应侧的工具调用项）。
 */
export class ToolNameRegistry {
  /** 已被占用的目标协议工具名。顶层（非命名空间）工具也在这里占位，避免被展平结果抢占。 */
  private readonly taken = new Set<string>()
  /** 顶层（非命名空间）工具名，用于识别「这个名字本来就该原样下发」。 */
  private readonly topLevel = new Set<string>()
  /** `(namespace, name)` → 展平名。二级 Map 避免用字符串拼 key 时的分隔符假设。 */
  private readonly flattened = new Map<string, Map<string, string>>()
  /** 展平名 → 原始坐标，供响应侧还原。 */
  private readonly identities = new Map<string, NamespacedToolIdentity>()
  /** 原始工具名 → 登记过的展平名，供 `locate` 消歧。 */
  private readonly origins = new Map<string, Set<string>>()

  /**
   * 占住一个顶层工具名：它本来就在目标协议里合法且必须原样保留，
   * 所以展平结果必须绕开它，而不是反过来。重复占位无副作用。
   */
  reserve(name: string): void {
    if (!name) return
    this.taken.add(name)
    this.topLevel.add(name)
  }

  /**
   * 把 `(namespace, name)` 展平成目标协议合法且唯一的工具名。
   * 同一组入参稳定返回同一个名字（幂等），因此同一请求里多次出现的工具调用不会各自算出不同的名字。
   */
  flatten(namespace: string, name: string): string {
    const cached = this.flattened.get(namespace)?.get(name)
    if (cached !== undefined) return cached

    const base = `${toTargetNamePart(namespace)}${NAMESPACE_SEPARATOR}${toTargetNamePart(name)}`
      .slice(0, TARGET_NAME_MAX_LENGTH)
    let candidate = base
    // 只可能跟「顶层工具名」或「更早登记的展平名」撞上；撞了换后缀，截断时给后缀留位置。
    for (let ordinal = 2; this.taken.has(candidate); ordinal += 1) {
      const suffix = `${NAMESPACE_SEPARATOR}${ordinal}`
      candidate = base.slice(0, TARGET_NAME_MAX_LENGTH - suffix.length) + suffix
    }

    this.taken.add(candidate)
    let group = this.flattened.get(namespace)
    if (!group) {
      group = new Map()
      this.flattened.set(namespace, group)
    }
    group.set(name, candidate)
    this.identities.set(candidate, { namespace, name })
    let candidates = this.origins.get(name)
    if (!candidates) {
      candidates = new Set()
      this.origins.set(name, candidates)
    }
    candidates.add(candidate)
    return candidate
  }

  /**
   * 展平名的反向查询：只有本请求登记过的命名空间工具才查得到。
   * 返回 `undefined` 表示「这个工具名不属于任何命名空间」，调用方原样输出。
   */
  restore(flattenedName: string): NamespacedToolIdentity | undefined {
    return this.identities.get(flattenedName)
  }

  /**
   * 原始工具名的正向查询：把客户端的名字换成它在上游看到的目标协议名字。
   *
   * 请求侧的 `tools` 里能带上 `namespace` 字段，所以展平时不需要猜；但 `tool_choice` 是客户端
   * 按**它自己声明的名字**写的（`ToolChoiceFunction` / `ToolChoiceCustom` 都只有 `name`，
   * 没有 `namespace`），上游却只认展平名，所以要在这里补上这一步。
   *
   * 只有「这个名字不是顶层工具名，且唯一对应一个展平名」时才敢换：
   * - 顶层工具名必须原样下发，哪怕它和某个组内工具重名；
   * - 多个命名空间里的同名工具无法只从 `name` 一个字段消歧。
   * 任何不确定的情况都返回 `undefined`，调用方原样下发——宁可让上游报「未知工具」也不猜错工具。
   */
  locate(name: string): string | undefined {
    if (!name || this.topLevel.has(name)) return undefined
    const candidates = this.origins.get(name)
    if (!candidates || candidates.size !== 1) return undefined
    return candidates.values().next().value
  }
}
