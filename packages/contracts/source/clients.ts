/**
 * 本地 Agent 客户端的配置注册表。
 *
 * 这份数据同时被三处使用：
 *
 *   1. 控制台（渲染进程）——列出可管理的客户端、渲染图标与字段；
 *   2. 管理服务端（core）——把客户端声明的配置文件路径解析成真实路径并校验写入目标，
 *      是「只允许读写这些文件」这条边界的唯一依据（管理 API 没有身份校验，见
 *      `apps/docs/specs/security-privacy.md`，因此路径绝不能由调用方随便给）。
 *   3. 备份与版本管理——`files[].path` 就是版本记录要挂靠的对象。
 *
 * 它放在 contracts 而不是 console：core 不允许依赖 console（`check-package-boundaries.mjs`），
 * 而路径解析又必须在 core（只有它拿得到 `os.homedir()` 与进程环境变量）。
 *
 * 组织方式照搬内置供应商目录（`packages/console/source/catalog/providers/`）：**一个客户端一个目录**，
 * 目录里是 `definition.json`（形状见 `./clients/types.ts`）与 `icon.svg`（或 `icon.light.svg` +
 * `icon.dark.svg`）。目录名就是客户端 `key`。
 *
 * 为什么定义是 JSON、而且**定义与图标都放在契约包**、却由控制台去扫图标：
 *
 *   - 定义必须是**静态**的（core 的 Node 侧只 `import`，没有打包器来 glob），所以定义不能靠
 *     `import.meta.glob` 发现。把定义做成「一个目录一份 JSON」后，这里用**静态 import** 逐个引入
 *     （不做 glob），与内置供应商目录「一个目录一份 provider.json」完全同构。
 *   - 图标本身是**渲染进程**才消费的东西，用 `import.meta.glob` 扫描是打包器的能力；契约包被
 *     Node 侧与 Worker 消费，用不了，所以扫描放在控制台（`catalog/clients/index.ts`）。它按 key
 *     把图标与这里的定义合并，图标仍来自同一个客户端目录。
 *   - 目录放在契约包（core 能读）而不是控制台（core 不能依赖），是因为第 2 条用途。
 *
 * 目录里的 `README.md` 记着该客户端的官方文档与来源；改一个客户端只动它自己的目录。
 */

import claudeCodeDefinition from './clients/claude-code/definition.json'
import codexDefinition from './clients/codex/definition.json'
import copilotCliDefinition from './clients/copilot-cli/definition.json'
import deepseekHarnessDefinition from './clients/deepseek-harness/definition.json'
import opencodeDefinition from './clients/opencode/definition.json'
import piDefinition from './clients/pi/definition.json'
import vscodeDefinition from './clients/vscode/definition.json'
import type {
  AgentClientApplyConfig,
  AgentClientDefinition,
  AgentClientFieldDefinition,
  AgentClientFileDefinition,
  AgentClientModelSlot,
  AgentClientTemplateContext,
  AgentClientTemplateValue,
} from './clients/types'

/**
 * 我们写进客户端配置里的 provider 身份。
 *
 * 是**我们自己**在别人配置里的名字，所以它属于契约：core 拿它拼 provider 表项的路径与内容，
 * 控制台拿它拼需要展示的模型名，两边必须说同一个字符串。
 */
export const LOCAL_PROVIDER_ID = 'osw'
export const LOCAL_PROVIDER_NAME = 'OSW'

export type {
  AgentClientApplyConfig,
  AgentClientConfigFormat,
  AgentClientDefinition,
  AgentClientEnvOverride,
  AgentClientFieldDefinition,
  AgentClientFieldRole,
  AgentClientFileDefinition,
  AgentClientFileShape,
  AgentClientModelSlot,
  AgentClientProtocol,
  AgentClientPlatform,
  AgentClientProviderEntryTemplate,
  AgentClientTemplateContext,
  AgentClientTemplateValue,
} from './clients/types'
/**
 * 把一个 `definition.json` 收窄成契约形状。
 *
 * JSON import 的类型是宽化的（`protocol` 是 `string` 而不是联合类型），所以过一道**编译期**断言
 * 把它拧回 `AgentClientDefinition`。刻意只做一次断言而不在这里校验内容：契约包要在浏览器、
 * Node 与 Worker 三处运行，不该为此拖进校验依赖，而每个字段的合法性由
 * `clients.test.ts` 逐条断言——写错一个枚举值会在测试里失败，不是在启动时报错。
 */
function defineClient(definition: unknown): AgentClientDefinition {
  return definition as AgentClientDefinition
}

/**
 * 内置客户端清单。`order` 降序排列（大的在前），同权重按 key 兜底，保证排序稳定。
 *
 * 每个客户端一条，各自住在 `./clients/<key>/definition.json`。这里只做汇总。**新增一个客户端
 * 必须在这里补一行 import**——定义是静态引入的（没有打包器来 glob），漏了就是真的没被登记。
 */
const AGENT_CLIENT_DEFINITIONS_UNSORTED: AgentClientDefinition[] = [
  defineClient(claudeCodeDefinition),
  defineClient(codexDefinition),
  defineClient(vscodeDefinition),
  defineClient(opencodeDefinition),
  defineClient(copilotCliDefinition),
  defineClient(piDefinition),
  defineClient(deepseekHarnessDefinition),
]

export const AGENT_CLIENT_DEFINITIONS: AgentClientDefinition[] = [...AGENT_CLIENT_DEFINITIONS_UNSORTED].sort(
  (left, right) => (right.order - left.order !== 0 ? right.order - left.order : left.key.localeCompare(right.key)),
)

export const AGENT_CLIENT_DEFINITION_BY_KEY: Record<string, AgentClientDefinition> = Object.fromEntries(
  AGENT_CLIENT_DEFINITIONS.map(client => [client.key, client] as const),
)

/** 按 key 取客户端；未知 key 返回 `undefined`（调用方自己决定是报错还是忽略）。 */
export function findAgentClient(clientKey: string): AgentClientDefinition | undefined {
  return AGENT_CLIENT_DEFINITION_BY_KEY[clientKey]
}

/** 按 key + 声明路径取文件定义；路径必须与该客户端声明的某一条**完全一致**。 */
export function findAgentClientFile(clientKey: string, filePath: string): AgentClientFileDefinition | undefined {
  return findAgentClient(clientKey)?.files.find(file => file.path === filePath)
}

/** 某个设置项实际归属的文件（没有写 `file` 时落在第一个文件上）。 */
export function agentClientFieldFile(client: AgentClientDefinition, field: AgentClientFieldDefinition): string {
  return field.file ?? client.files[0]?.path ?? ''
}

/** 某个文件上承载的设置项。 */
export function agentClientFieldsOfFile(client: AgentClientDefinition, filePath: string): AgentClientFieldDefinition[] {
  return client.fields.filter(field => agentClientFieldFile(client, field) === filePath)
}

/**
 * 这个 key 认不认识。
 *
 * 消费方拿到的 key 可能来自配置文件、历史版本或更早的版本（客户端被重命名/移除），
 * 所以调用方需要一条「不抛错地问一句」的路，而不是先 `find` 再判 `undefined`。
 */
export function isKnownAgentClient(clientKey: string): boolean {
  return Object.prototype.hasOwnProperty.call(AGENT_CLIENT_DEFINITION_BY_KEY, clientKey)
}

/** 某个客户端的重写配方；没配方返回 `null`（界面据此给出「只能手改」）。 */
export function findAgentClientApplyConfig(clientKey: string): AgentClientApplyConfig | null {
  return AGENT_CLIENT_DEFINITION_BY_KEY[clientKey]?.apply ?? null
}

/** 有配方的客户端 key（即「哪些客户端能自动填充」）。 */
export function agentClientApplyConfigKeys(): string[] {
  return AGENT_CLIENT_DEFINITIONS.filter(client => client.apply !== undefined).map(client => client.key)
}

/**
 * 表单上要用户填的模型槽位，固定「主模型在前、小模型在后」。
 *
 * 从配方**推**出来，而不是写死「永远两行」：配方里没有 `smallModel` 的客户端就只该出现一行；
 * 而 Claude Code 那五个都映射到同一个值的模型别名，只该合成**一行**输入——
 * 用户要决定的是「用哪个模型」，不是「有五个键要各填一遍」。
 */
export function agentClientModelSlots(config: AgentClientApplyConfig): AgentClientModelSlot[] {
  const roles = new Set(Object.values(config.roles))
  return (['model', 'smallModel'] as const).filter(role => roles.has(role))
}

/**
 * 某个槽位在已回读的字段里的当前值。
 *
 * 一个槽位可能对应多个键（Claude Code 的主模型有五个别名），取**声明顺序里第一个有值的**：
 * 顺序即优先级，与写入时「所有别名写同一个值」这件事同源。
 */
export function resolveAgentClientSlotValue(config: AgentClientApplyConfig, detected: Record<string, string>, role: AgentClientModelSlot): string {
  for (const fieldKey of Object.keys(config.roles)) {
    if (config.roles[fieldKey] !== role) continue
    const value = detected[fieldKey]
    if (value !== undefined && value.trim() !== '') return stripAgentClientModelPrefix(config, value)
  }
  return ''
}

/**
 * 脱掉模型值上的 provider 前缀（`osw/gpt-5` → `gpt-5`）。
 *
 * 回填输入框时必须还原文：OpenCode 只认 `provider/model`，把读回来的整串再写回去会变成
 * `osw/osw/gpt-5`。
 */
export function stripAgentClientModelPrefix(config: AgentClientApplyConfig, value: string): string {
  const prefix = config.modelPrefix
  if (prefix === undefined || prefix === '' || !value.startsWith(prefix)) return value
  return value.slice(prefix.length)
}

/** provider 表项在该客户端上的具体路径（把 `{{providerId}}` / `{{providerName}}` 换成真实值）。 */
export function concreteAgentClientProviderEntryPath(config: AgentClientApplyConfig): string | null {
  if (!config.providerEntry) return null
  return config.providerEntry.path.replaceAll('{{providerId}}', LOCAL_PROVIDER_ID).replaceAll('{{providerName}}', LOCAL_PROVIDER_NAME)
}

const TEMPLATE_PLACEHOLDER = /\{\{(\w+)\}\}/g

function templatePlaceholderValue(context: AgentClientTemplateContext, name: string): string {
  switch (name) {
    case 'baseUrl':
      return context.baseUrl
    case 'apiKey':
      return context.apiKey
    case 'model':
      return context.model
    case 'smallModel':
      return context.smallModel
    case 'providerId':
      return context.providerId
    case 'providerName':
      return context.providerName
    default:
      // 拼错的占位符（`{{baseURL}}`）静默留成字面量的话，会直接写进用户的配置文件里。
      throw new Error(`Unknown agent client template placeholder: {{${name}}}`)
  }
}

/**
 * 展开模板：把键与值里的 `{{占位符}}` 换成实值，对象与数组递归。
 *
 * 键也要替换——OpenCode 的 provider 表项用**模型名当键**（`models: { '{{model}}': {} }`），
 * 只换值的话它的模型列表永远是空的。
 */
export function expandAgentClientTemplate(value: AgentClientTemplateValue, context: AgentClientTemplateContext): AgentClientTemplateValue {
  if (typeof value === 'string') {
    return value.replace(TEMPLATE_PLACEHOLDER, (_match, name: string) => templatePlaceholderValue(context, name))
  }
  if (Array.isArray(value)) return value.map(item => expandAgentClientTemplate(item, context))
  if (value !== null && typeof value === 'object') {
    const expanded: Record<string, AgentClientTemplateValue> = {}
    for (const [key, item] of Object.entries(value)) {
      const expandedKey = expandAgentClientTemplate(key, context)
      expanded[String(expandedKey)] = expandAgentClientTemplate(item, context)
    }
    return expanded
  }
  return value
}
