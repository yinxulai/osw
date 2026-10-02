/**
 * 内置 Agent 客户端注册表的**表示层**。
 *
 * 定义本身（key / name / 配置文件路径 / 字段 schema）住在 `@common/clients`，因为管理服务端
 * 也要用它来解析与校验配置文件路径；控制台这一层只补上打包器才能处理的**图标**——
 * `import.meta.glob` 是 Vite 的能力，契约包（Node 侧与 Worker 也在消费）用不了。
 *
 * 图标与定义同住在一个**客户端目录**里：`packages/contracts/source/clients/<key>/`，目录里是
 * `definition.json` + `icon.svg`（或分开的 `icon.light.svg` / `icon.dark.svg`）。定义由
 * `@common/clients` 静态引入，图标由这里按 key 扫出来——同一个目录，只是发现方式不同。
 */
import { AGENT_CLIENT_DEFINITIONS as AGENT_CLIENT_BASE_DEFINITIONS, type AgentClientDefinition } from '@common/clients'

export type {
  AgentClientConfigFormat,
  AgentClientDefinition,
  AgentClientEnvOverride,
  AgentClientFieldDefinition,
  AgentClientFileDefinition,
  AgentClientProtocol,
} from '@common/clients'

export { findAgentClient, findAgentClientFile, agentClientFieldFile, agentClientFieldsOfFile, isKnownAgentClient } from '@common/clients'

export type AgentClientIconTheme = 'light' | 'dark'

export interface AgentClientEntry extends AgentClientDefinition {
  /** 两套主题各自的图标地址（构建期由打包器解析成资源 URL）。 */
  iconUrls: Record<AgentClientIconTheme, string>
}

// 图标与定义同住在契约包的客户端目录里（`@common/clients/<key>/icon*.svg`）；这里退四层到
// `packages/` 再进契约包。定义是静态 import、不能 glob，图标却能——因为它是渲染进程才消费的
// 资源，而 `import.meta.glob` 正是打包器的能力。
const lightIcons = import.meta.glob('../../../../contracts/source/clients/*/icon.light.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const darkIcons = import.meta.glob('../../../../contracts/source/clients/*/icon.dark.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const sharedIcons = import.meta.glob('../../../../contracts/source/clients/*/icon.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

/** `.../clients/claude-code/icon.light.svg` → `claude-code`。 */
function clientKeyOfModulePath(modulePath: string): string {
  const segments = modulePath.split('/')
  return segments[segments.length - 2] ?? ''
}

function buildIconUrls(): Map<string, Record<AgentClientIconTheme, string>> {
  const urls = new Map<string, Record<AgentClientIconTheme, string>>()

  // 先铺单图版本，再让分主题的图覆盖——两种写法都支持，不必要求所有人画两张图。
  for (const [modulePath, url] of Object.entries(sharedIcons)) {
    urls.set(clientKeyOfModulePath(modulePath), { light: url, dark: url })
  }
  for (const [modulePath, url] of Object.entries(lightIcons)) {
    const key = clientKeyOfModulePath(modulePath)
    urls.set(key, { light: url, dark: urls.get(key)?.dark ?? '' })
  }
  for (const [modulePath, url] of Object.entries(darkIcons)) {
    const key = clientKeyOfModulePath(modulePath)
    urls.set(key, { light: urls.get(key)?.light ?? '', dark: url })
  }

  return urls
}

const ICON_URLS = buildIconUrls()

/**
 * 契约定义 + 图标。
 *
 * 图标缺失**直接抛错**而不是给一个占位图：注册表是有序界面（客户端选择器）的数据源，
 * 静默降级只会让某个客户端在某次改动后悄悄少一张图，而没人知道为什么。
 */
export const AGENT_CLIENT_DEFINITIONS: readonly AgentClientEntry[] = AGENT_CLIENT_BASE_DEFINITIONS.map(definition => {
  const iconUrls = ICON_URLS.get(definition.key)
  if (!iconUrls?.light || !iconUrls.dark) {
    throw new Error(`Agent client "${definition.key}" is missing an icon (expected packages/contracts/source/clients/${definition.key}/icon.svg)`)
  }
  return { ...definition, iconUrls }
})

export const AGENT_CLIENT_DEFINITION_BY_KEY: Record<string, AgentClientEntry> = Object.fromEntries(
  AGENT_CLIENT_DEFINITIONS.map(entry => [entry.key, entry]),
)

export const AGENT_CLIENT_ICON_URL_BY_KEY: Record<string, Record<AgentClientIconTheme, string>> = Object.fromEntries(
  AGENT_CLIENT_DEFINITIONS.map(entry => [entry.key, entry.iconUrls]),
)
