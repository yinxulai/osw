/**
 * 本地 Agent 客户端的配置注册表。
 *
 * 这份数据同时被三处使用：
 *
 *   1. 控制台（渲染进程）——列出可管理的客户端、渲染图标与字段；
 *   2. 管理服务端（core）——把客户端声明的配置文件路径解析成真实路径并校验写入目标，
 *      是「只允许读写这些文件」这条边界的唯一依据（管理 API 没有身份校验，见
 *      `docs/product/security-privacy.md`，因此路径绝不能由调用方随便给）。
 *   3. 备份与版本管理——`files[].path` 就是版本记录要挂靠的对象。
 *
 * 它放在 contracts 而不是 console：core 不允许依赖 console（`check-package-boundaries.mjs`），
 * 而路径解析又必须在 core（只有它拿得到 `os.homedir()` 与进程环境变量）。契约包只描述形状，
 * 不依赖 Node，所以这里只写字符串与枚举，不做任何 IO。
 *
 * 图标不在本文件里：`import.meta.glob` 是打包器的能力，契约包（也会被 core 的 Node 侧与
 * Worker 消费）用不了。图标留在控制台的 `catalog/clients/<key>/icon.svg`。
 */

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
  /**
   * 这个字段属于哪个文件（注册表里的 `files[].path`）。
   *
   * 缺省时归属**第一个文件**，因为绝大多数客户端只有一份配置文件带设置项。
   * 必须写死的场合是「一份客户端的设置项分散在两个文件里」——Gemini CLI 的模型在
   * settings.json，而地址与密钥在 `.env`；不写 `file` 的话，改 `.env` 时会连带往它里面写 `model`，
   * 写出一个工具根本不读的键。
   */
  file?: string
  /** 值类型。 */
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array'
  /** 作用说明。 */
  description: string
}

/** 覆盖某个文件所在**目录**的环境变量。 */
export interface AgentClientEnvOverride {
  /** 环境变量名，如 `DSH_HOME`、`XDG_CONFIG_HOME`。 */
  name: string
  /**
   * 它替换掉的 `~/` 相对前缀。
   *
   * 必须写死这一层，不能只记变量名：同样是 XDG，`XDG_CONFIG_HOME` 替换的是 `~/.config`，
   * 而 `XDG_DATA_HOME` 替换的是 `~/.local/share`（两层）——只替换一层就会把 Auth 文件
   * 指到 `$XDG_DATA_HOME/opencode/auth.json`，而 XDG 规范里那个 `share` 是不带的。
   */
  replaces: string
}

/** 该客户端的一个配置文件。备份/自动管理据此定位与解析。 */
export interface AgentClientFileDefinition {
  /** 主目录相对路径，以 `~/` 开头（`~` 由消费者展开为真实主目录）。 */
  path: string
  /** 文件格式。 */
  format: AgentClientConfigFormat
  /** 该文件的**目录**可被这个环境变量覆盖（如 `DSH_HOME`、`XDG_CONFIG_HOME`）。 */
  envVar?: AgentClientEnvOverride
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
   * 仅用于客户端之间的排序（与内置供应商的 `order` 同义）。
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
}

/**
 * 内置客户端清单。`order` 降序排列（大的在前），同权重按 key 兜底，保证排序稳定。
 *
 * 路径与字段取自 yetone/magpie 各 `internal/agent/<client>.go` 的权威实现，见
 * `packages/console/source/catalog/clients/README.md`。
 */
const AGENT_CLIENT_DEFINITIONS_UNSORTED: AgentClientDefinition[] = [
  {
    key: 'claude-code',
    name: 'Claude Code',
    aliases: ['claude', 'cc'],
    order: 100,
    websiteUrl: 'https://www.anthropic.com/claude-code',
    description: "Anthropic's terminal coding agent. Talks the Anthropic Messages API; its endpoint, token and model all live in the `env` block of settings.json.",
    protocol: 'anthropic-messages',
    configDir: '~/.claude',
    files: [
      {
        path: '~/.claude/settings.json',
        format: 'json',
        purpose: 'Main config: `env` (endpoint/token/models) and the top-level `model`.',
      },
      {
        path: '~/.claude/.credentials.json',
        format: 'json',
        purpose: 'Claude account OAuth credentials.',
      },
    ],
    fields: [
      { key: 'model', path: 'model', type: 'string', description: 'Default model.' },
      { key: 'baseUrl', path: 'env.ANTHROPIC_BASE_URL', type: 'string', description: 'Anthropic API base URL.' },
      { key: 'authToken', path: 'env.ANTHROPIC_AUTH_TOKEN', type: 'string', description: 'Token presented to the base URL.' },
      { key: 'mainModel', path: 'env.ANTHROPIC_MODEL', type: 'string', description: 'Main model while routed through a custom base URL.' },
      { key: 'opus', path: 'env.ANTHROPIC_DEFAULT_OPUS_MODEL', type: 'string', description: 'Model the `opus` alias resolves to.' },
      { key: 'sonnet', path: 'env.ANTHROPIC_DEFAULT_SONNET_MODEL', type: 'string', description: 'Model the `sonnet` alias resolves to.' },
      { key: 'haiku', path: 'env.ANTHROPIC_DEFAULT_HAIKU_MODEL', type: 'string', description: 'Model the `haiku` alias resolves to.' },
      { key: 'fable', path: 'env.ANTHROPIC_DEFAULT_FABLE_MODEL', type: 'string', description: 'Model the `fable` alias resolves to.' },
      { key: 'smallFast', path: 'env.ANTHROPIC_SMALL_FAST_MODEL', type: 'string', description: 'Model used for background/small work.' },
    ],
  },
  {
    key: 'codex',
    name: 'Codex',
    aliases: ['codex-cli'],
    order: 96,
    websiteUrl: 'https://github.com/openai/codex',
    description: "OpenAI's coding agent. Configured in TOML; speaks the OpenAI Responses API to whichever provider config.toml names.",
    protocol: 'openai-responses',
    configDir: '~/.codex',
    files: [
      {
        path: '~/.codex/config.toml',
        format: 'toml',
        purpose: 'Main config: model, provider, reasoning effort, provider tables.',
      },
      {
        path: '~/.codex/auth.json',
        format: 'json',
        purpose: 'ChatGPT sign-in credentials.',
      },
      {
        path: '~/.codex/magpie-models.json',
        format: 'json',
        purpose: 'Optional external model catalog referenced by `model_catalog_json`.',
      },
    ],
    fields: [
      { key: 'model', path: 'model', type: 'string', description: 'Default model.' },
      { key: 'provider', path: 'model_provider', type: 'string', description: 'Id of the provider table to use.' },
      { key: 'effort', path: 'model_reasoning_effort', type: 'string', description: 'Reasoning effort (low/medium/high/xhigh).' },
      { key: 'catalog', path: 'model_catalog_json', type: 'string', description: 'Path to an extra model catalog file.' },
      { key: 'providerTable', path: 'model_providers.<id>', type: 'object', description: 'A provider entry: name, base_url, wire_api, token.' },
    ],
  },
  {
    key: 'gemini-cli',
    name: 'Gemini CLI',
    aliases: ['gemini'],
    order: 92,
    websiteUrl: 'https://github.com/google-gemini/gemini-cli',
    description: "Google's Gemini CLI. Speaks only Google's own API; the auth mode and model live in settings.json, while the endpoint and key live in ~/.gemini/.env.",
    protocol: 'gemini',
    configDir: '~/.gemini',
    files: [
      {
        path: '~/.gemini/settings.json',
        format: 'json',
        purpose: 'Main config: `security.auth.selectedType` and `model.name`.',
      },
      {
        path: '~/.gemini/.env',
        format: 'env',
        purpose: 'GOOGLE_GEMINI_BASE_URL and GEMINI_API_KEY, loaded by the CLI.',
      },
    ],
    fields: [
      { key: 'auth', path: 'security.auth.selectedType', type: 'string', description: 'How it authenticates: oauth-personal / gemini-api-key / vertex-ai.' },
      { key: 'model', path: 'model.name', type: 'string', description: 'Model to use.' },
      { key: 'baseUrl', path: 'GOOGLE_GEMINI_BASE_URL', file: '~/.gemini/.env', type: 'string', description: 'Gemini API base URL (from .env).' },
      { key: 'apiKey', path: 'GEMINI_API_KEY', file: '~/.gemini/.env', type: 'string', description: 'Gemini API key (from .env).' },
    ],
  },
  {
    key: 'opencode',
    name: 'OpenCode',
    aliases: ['oc'],
    order: 88,
    websiteUrl: 'https://opencode.ai',
    description: 'Open-source terminal agent. Spells models as `provider/model`; its JSON (or JSONC) config and provider credentials sit under the XDG config and data dirs.',
    protocol: 'openai-completions',
    configDir: '~/.config/opencode',
    files: [
      {
        path: '~/.config/opencode/opencode.json',
        format: 'jsonc',
        envVar: { name: 'XDG_CONFIG_HOME', replaces: '~/.config' },
        purpose: 'Main config: `model`, `small_model`, and provider entries. May also be named opencode.jsonc.',
      },
      {
        path: '~/.local/share/opencode/auth.json',
        format: 'json',
        envVar: { name: 'XDG_DATA_HOME', replaces: '~/.local/share' },
        purpose: 'Per-provider credentials.',
      },
    ],
    fields: [
      { key: 'model', path: 'model', type: 'string', description: 'Main `provider/model`.' },
      { key: 'small', path: 'small_model', type: 'string', description: 'Small/background `provider/model`.' },
      { key: 'provider', path: 'provider.<id>', type: 'object', description: 'A provider entry: npm, options (baseURL, apiKey), models.' },
    ],
  },
  {
    key: 'cursor-cli',
    name: 'Cursor CLI',
    aliases: ['cursor-agent'],
    order: 84,
    websiteUrl: 'https://cursor.com/cli',
    description: "Cursor's CLI agent (cursor-agent). Its default model and the fields used to display it live in a single JSON file.",
    configDir: '~/.cursor',
    files: [
      {
        path: '~/.cursor/cli-config.json',
        format: 'json',
        purpose: 'Main config: the selected model and its display fields.',
      },
    ],
    fields: [
      { key: 'model', path: 'model.modelId', type: 'string', description: 'Selected model id (or `auto`).' },
      { key: 'displayModelId', path: 'model.displayModelId', type: 'string', description: 'Model id as shown in the UI.' },
      { key: 'displayName', path: 'model.displayName', type: 'string', description: 'Model name as shown in the UI.' },
      { key: 'hasChangedDefaultModel', path: 'hasChangedDefaultModel', type: 'boolean', description: 'Whether the user overrode the default model.' },
    ],
  },
  {
    key: 'copilot-cli',
    name: 'Copilot CLI',
    aliases: ['gh-copilot'],
    order: 80,
    websiteUrl: 'https://docs.github.com/copilot',
    description: "GitHub's Copilot CLI. The model — or `auto` to let Copilot choose — is a single key in settings.json.",
    configDir: '~/.copilot',
    files: [
      {
        path: '~/.copilot/settings.json',
        format: 'json',
        purpose: 'Main config: the selected model.',
      },
    ],
    fields: [
      { key: 'model', path: 'model', type: 'string', description: 'Selected model, or `auto`.' },
    ],
  },
  {
    key: 'pi',
    name: 'Pi',
    aliases: [],
    order: 68,
    description: 'Pi agent. The default model is split across `defaultProvider` and `defaultModel` in settings.json; custom providers and their models live in models.json.',
    protocol: 'openai-completions',
    configDir: '~/.pi/agent',
    files: [
      {
        path: '~/.pi/agent/settings.json',
        format: 'json',
        purpose: 'Main config: defaultProvider, defaultModel, defaultThinkingLevel, theme.',
      },
      {
        path: '~/.pi/agent/models.json',
        format: 'json',
        purpose: 'Custom provider definitions and their model lists.',
      },
      {
        path: '~/.pi/agent/auth.json',
        format: 'json',
        purpose: 'Per-provider credentials.',
      },
    ],
    fields: [
      { key: 'provider', path: 'defaultProvider', type: 'string', description: 'Default provider id.' },
      { key: 'model', path: 'defaultModel', type: 'string', description: 'Default model id.' },
      { key: 'thinking', path: 'defaultThinkingLevel', type: 'string', description: 'Startup thinking level (off/minimal/low/medium/high/xhigh/max).' },
    ],
  },
  {
    key: 'deepseek-harness',
    name: 'DeepSeek Harness',
    aliases: ['dsh'],
    order: 64,
    description: 'DeepSeek Harness (dsh). Its config is a YAML patch list of {id, config} entries; the model lives in the `agent-loop` entry and the endpoint in `llm-deepseek`. The home directory is $DSH_HOME (default ~/.dsh).',
    configDir: '~/.dsh',
    files: [
      {
        path: '~/.dsh/config.yaml',
        format: 'yaml',
        envVar: { name: 'DSH_HOME', replaces: '~/.dsh' },
        purpose: 'Patch list replacing whole config rows, addressed by `id`.',
      },
      {
        path: '~/.dsh/settings.yaml',
        format: 'yaml',
        envVar: { name: 'DSH_HOME', replaces: '~/.dsh' },
        purpose: 'Runtime settings the harness merges on top of config.yaml (model selection, permissions).',
      },
    ],
    fields: [
      { key: 'model', path: 'agent-loop.model', type: 'string', description: 'Model of the main agent loop.' },
      { key: 'endpoint', path: 'llm-deepseek.config.baseURL', type: 'string', description: 'DeepSeek endpoint base URL.' },
      { key: 'apiKey', path: 'llm-deepseek.config.apiKey', type: 'string', description: 'DeepSeek API key.' },
    ],
  },
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
