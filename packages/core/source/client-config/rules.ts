/**
 * 「把某个客户端的配置指到本地服务」这一步的**执行器**。
 *
 * 数据不在这里：每个客户端要改哪些键、provider 表项长什么样，都是注册表里
 * `AgentClientDefinition.apply` 的一部分（`@common/clients`）。这里只做三件事——
 *
 *   1. 把注册表里的**模板**（`{ base_url: '{{baseUrl}}' }` 这种纯数据）展开成真正的值；
 *   2. 把角色翻译成要写进配置的字符串；
 *   3. 与注册表对账（`rules.test.ts`）：注册表里的每个键要么有角色、要么被显式放过。
 *
 * 为什么值得这样拆：这一层原先自己攥着一份逐客户端配方，与注册表并行维护；注册表加了一个
 * 会读到真实厂商的键（模型别名是重灾区）而配方忘了登记，就没人发现。现在两边是同一份数据。
 */

import {
  AGENT_CLIENT_DEFINITIONS,
  expandAgentClientTemplate,
  expandLocalProviderTemplate,
  findAgentClientApplyConfig,
  type AgentClientApplyConfig,
  type AgentClientFieldRole,
  type AgentClientTemplateContext,
} from '@common/clients'
import { currentLocalProviderIdentity } from './environment'

/**
 * 这套 provider 身份本轮要用的实际值。
 *
 * **不是常量**：开发环境与正式环境在同一台机器上必须写不同的 provider 名，否则后写的那次会
 * 覆盖前一次（见 `./environment.ts`）。所有涉及身份的展开都从这里取。
 */
export type ClientApplyIdentity = ReturnType<typeof currentLocalProviderIdentity>

/** 见 `AgentClientFieldRole`：注册表字段在自动填充时的角色。 */
export type ClientFieldRole = AgentClientFieldRole

/** 写一次配置需要的实值。 */
export interface ClientApplyContext {
  baseUrl: string
  apiKey: string
  model: string
  /** 已回落到主模型的小模型。 */
  smallModel: string
}

export interface ClientApplyRule {
  /** 注册表 `fields[].key` → 要写什么。没列出的 key 不写。 */
  roles: Record<string, ClientFieldRole>
  /** 明确放过、但确实属于这个客户端的键（有意的「不碰」清单）。 */
  ignored: string[]
  /** provider 表项的路径与结构；路径里的占位符由展开时的身份替换。 */
  providerEntry?: {
    path: string
    build: (context: ClientApplyContext, identity: ClientApplyIdentity) => Record<string, unknown>
  }
  /** 模型字段的值前缀**模板**（如 `{{providerId}}/`）；展开时按身份替换。 */
  modelPrefix?: string
}

/** 模板展开用的实值：配方里的占位符与它一一对应。 */
function templateContext(context: ClientApplyContext, identity: ClientApplyIdentity): AgentClientTemplateContext {
  return {
    baseUrl: context.baseUrl,
    apiKey: context.apiKey,
    model: context.model,
    smallModel: context.smallModel,
    providerId: identity.id,
    providerName: identity.name,
  }
}

/** 注册表里的配置 → 运行期的配方：唯一的翻译就是「模板变成展开函数」。 */
function toRule(config: AgentClientApplyConfig): ClientApplyRule {
  const rule: ClientApplyRule = { roles: config.roles, ignored: config.ignored }
  if (config.modelPrefix !== undefined) rule.modelPrefix = config.modelPrefix
  if (config.providerEntry) {
    const { path, template } = config.providerEntry
    rule.providerEntry = {
      path,
      build: (context, identity) => expandAgentClientTemplate(template, templateContext(context, identity)) as Record<string, unknown>,
    }
  }
  return rule
}

const RULES: Record<string, ClientApplyRule> = Object.fromEntries(
  AGENT_CLIENT_DEFINITIONS.filter(definition => definition.apply !== undefined).map(
    definition => [definition.key, toRule(definition.apply!)] as const,
  ),
)

export function getClientApplyRule(clientKey: string): ClientApplyRule | null {
  return RULES[clientKey] ?? null
}

/** 该函数只用于测试与诊断：列出所有配了配方的客户端。 */
export function getClientApplyRuleKeys(): string[] {
  return Object.keys(RULES)
}

/**
 * 一个键最终要写什么值。
 *
 * 返回 `null` 表示**这个键本次不写**（例如小模型没填、角色是 `providerEntry` 由表项路径承载）。
 * `identity` 省略时取当前环境的身份（见 `./environment.ts`）——开发环境因此写的是 `osw-dev`。
 */
export function resolveFieldValue(role: ClientFieldRole, context: ClientApplyContext, rule: ClientApplyRule, identity: ClientApplyIdentity = currentLocalProviderIdentity()): string | boolean | null {
  switch (role) {
    case 'baseUrl':
      return context.baseUrl
    case 'apiKey':
      return context.apiKey
    case 'model':
      return `${resolveModelPrefix(rule, identity)}${context.model}`
    case 'smallModel':
      return `${resolveModelPrefix(rule, identity)}${context.smallModel}`
    case 'provider':
      return identity.id
    case 'flagTrue':
      return true
    case 'providerEntry':
      return null
  }
}

/** 模型字段的值前缀：配方里是模板，按身份展开（OpenCode 开发环境落成 `osw-dev/`）。 */
export function resolveModelPrefix(rule: ClientApplyRule, identity: ClientApplyIdentity = currentLocalProviderIdentity()): string {
  if (rule.modelPrefix === undefined) return ''
  return expandLocalProviderTemplate(rule.modelPrefix, identity)
}

/**
 * provider 表项在某个客户端上使用的具体路径。
 *
 * 路径本身也是模板：多数客户端用 `{{providerId}}` 当键（`model_providers.osw`），但
 * 「条目数组」形状的客户端（VS Code 的 `chatLanguageModels.json`）**以 `name` 字段当标识**，
 * 所以它的路径写 `{{providerName}}`（`OSW`），必须与模板里那个 `name` 字面相等才会命中同一条。
 * 两个占位符都换掉，两种写法因此都能用——也因此必须**一起**按同一套身份展开，否则路径与内容会
 * 指向两条不同的表项。
 */
export function concreteProviderEntryPath(rule: ClientApplyRule, identity: ClientApplyIdentity = currentLocalProviderIdentity()): string | null {
  if (!rule.providerEntry) return null
  return expandLocalProviderTemplate(rule.providerEntry.path, identity)
}

/**
 * 反向解析模型字段：把 `osw/xxx` 还原成 `xxx`。
 *
 * 一键生效要「沿用用户已经选好的模型名」，而读回来的值是带前缀的（OpenCode 只认
 * `provider/model`），不脱掉前缀再写回去就会变成 `osw/osw/xxx`。
 */
export function stripModelPrefix(rule: ClientApplyRule, value: string, identity: ClientApplyIdentity = currentLocalProviderIdentity()): string {
  const prefix = resolveModelPrefix(rule, identity)
  if (!prefix || !value.startsWith(prefix)) return value
  return value.slice(prefix.length)
}

/** 直接把注册表里的配置取出来（测试用：校验模板本身，而不是展开之后的函数）。 */
export function getClientApplyConfig(clientKey: string): AgentClientApplyConfig | null {
  return findAgentClientApplyConfig(clientKey)
}
