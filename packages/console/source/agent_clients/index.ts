/**
 * Agent 客户端注册表。
 *
 * 与 `../providers` 同构：每个客户端一个子目录，目录里放 `agent.json`（描述 + 配置文件
 * 路径 + 字段 schema）和图标（`icon.svg`，或 `icon.light.svg` / `icon.dark.svg`）。
 * 新增/删除一个客户端只需增删目录，`index.ts` 会自动扫描，不必改动。
 *
 * 这份数据是为**备份与自动管理**准备的：`configDir` / `files[].path` 用来定位该工具的
 * 配置文件，`files[].format` 决定读写时用哪套解析，`fields[]` 是该配置文件里需要识别或
 * 改写的键（即该工具的 schema 片段）。本模块只描述形状，不做任何文件 IO。
 */

export type AgentClientIconTheme = 'light' | 'dark'

/** 客户端原生使用的上游协议。不确定时不填，避免编造。 */
export type AgentClientProtocol = 'anthropic-messages' | 'openai-responses' | 'openai-completions' | 'gemini'

/** 配置文件的格式，决定读写时用哪套解析/序列化。 */
export type AgentClientConfigFormat = 'json' | 'jsonc' | 'toml' | 'yaml' | 'env'

/** 一个配置文件里的可寻址设置项，即该工具 schema 的一段。 */
export interface AgentClientFieldDefinition {
  /** 语义名：model / provider / effort / small … */
  key: string
  /** 配置文件里的键路径（点号分隔；`<id>` 表示动态键）。 */
  path: string
  /** 值类型。 */
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array'
  /** 作用说明。 */
  description: string
}

/** 该客户端的一个配置文件。备份/自动管理据此定位与解析。 */
export interface AgentClientFileDefinition {
  /** 主目录相对路径，以 `~/` 开头（`~` 由消费者展开为真实主目录）。 */
  path: string
  /** 文件格式。 */
  format: AgentClientConfigFormat
  /** 该文件的**目录**可被这个环境变量覆盖（如 `DSH_HOME`、`XDG_CONFIG_HOME`）。 */
  envVar?: string
  /** 该文件在工具里的作用。 */
  purpose: string
}

export interface AgentClientDefinition {
  key: string
  name: string
  aliases?: string[]
  /**
   * 展示权重：**数值大的排前面**。
   *
   * 仅用于客户端之间的排序（与 `providers` 的 `order` 同义）。
   */
  order: number
  /** 官网。用于「看文档 / 装工具」这类跳转。 */
  websiteUrl?: string
  /** 一句话描述这个客户端。 */
  description: string
  /** 原生协议；不确定时缺省。 */
  protocol?: AgentClientProtocol
  /** 主目录下的配置目录。备份时按目录归档。 */
  configDir: string
  /** 该客户端的配置文件清单。 */
  files: AgentClientFileDefinition[]
  /** 需要识别/改写的设置项。 */
  fields: AgentClientFieldDefinition[]
  iconUrls: Record<AgentClientIconTheme, string>
}

type AgentClientConfig = Omit<AgentClientDefinition, 'iconUrls'>

const clientConfigModules = import.meta.glob('./*/agent.json', {
  eager: true,
  import: 'default',
}) as Record<string, AgentClientConfig>

const clientLightIconModules = import.meta.glob('./*/icon.light.svg', {
  eager: true,
  import: 'default',
}) as Record<string, string>

const clientDarkIconModules = import.meta.glob('./*/icon.dark.svg', {
  eager: true,
  import: 'default',
}) as Record<string, string>

const clientLegacySvgModules = import.meta.glob('./*/icon.svg', {
  eager: true,
  import: 'default',
}) as Record<string, string>

function getClientKeyFromPath(path: string): string {
  const segments = path.split('/')
  return segments[1] ?? ''
}

const configsByKey = Object.fromEntries(
  Object.entries(clientConfigModules).map(([path, config]) => [getClientKeyFromPath(path), config] as const),
)

const lightIconsByKey = Object.fromEntries(
  Object.entries(clientLightIconModules).map(([path, url]) => [getClientKeyFromPath(path), url] as const),
)

const darkIconsByKey = Object.fromEntries(
  Object.entries(clientDarkIconModules).map(([path, url]) => [getClientKeyFromPath(path), url] as const),
)

/** 单张 `icon.svg`：两种主题共用。 */
const legacyIconsByKey = Object.fromEntries(
  Object.entries(clientLegacySvgModules).map(([path, url]) => [getClientKeyFromPath(path), url] as const),
)

export const AGENT_CLIENT_DEFINITIONS: AgentClientDefinition[] = Object.keys(configsByKey)
  // 顺序由 `agent.json` 的 `order` 决定（大的在前），同权重按 key 兜底，保证排序稳定。
  .sort((left, right) => {
    const byOrder = (configsByKey[right]?.order ?? 0) - (configsByKey[left]?.order ?? 0)
    return byOrder !== 0 ? byOrder : left.localeCompare(right)
  })
  .map((key) => {
    const config = configsByKey[key]
    const legacyIconUrl = legacyIconsByKey[key]
    const lightIconUrl = lightIconsByKey[key] ?? legacyIconUrl
    const darkIconUrl = darkIconsByKey[key] ?? lightIconUrl

    if (!config || !lightIconUrl || !darkIconUrl) {
      throw new Error(`Agent client assets are incomplete for "${key}". Expected agent.json plus icon.svg (or icon.light.svg/icon.dark.svg).`)
    }

    return {
      ...config,
      iconUrls: {
        light: lightIconUrl,
        dark: darkIconUrl,
      },
    }
  })

export const AGENT_CLIENT_DEFINITION_BY_KEY: Record<string, AgentClientDefinition> = Object.fromEntries(
  AGENT_CLIENT_DEFINITIONS.map(client => [client.key, client] as const),
)

export const AGENT_CLIENT_ICON_URL_BY_KEY: Record<string, Record<AgentClientIconTheme, string>> = Object.fromEntries(
  AGENT_CLIENT_DEFINITIONS.map(client => [client.key, client.iconUrls] as const),
)
