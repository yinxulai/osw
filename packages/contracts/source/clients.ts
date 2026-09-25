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

/**
 * 我们写进客户端配置里的 provider 身份。
 *
 * 是**我们自己**在别人配置里的名字，所以它属于契约：core 拿它拼 provider 表项的路径与内容，
 * 控制台拿它拼需要展示的模型名，两边必须说同一个字符串。
 */
export const LOCAL_PROVIDER_ID = 'osw'
export const LOCAL_PROVIDER_NAME = 'One Switch'

/** 注册表里的一个字段在自动填充时被当成什么来写。 */
export type AgentClientFieldRole =
  /** 指向本地服务的基础地址。 */
  | 'baseUrl'
  /** 本地服务不校验的调用方凭证。 */
  | 'apiKey'
  /** 主模型。 */
  | 'model'
  /** 小模型/后台模型，留空时回落主模型。 */
  | 'smallModel'
  /** 指向 provider 表项的 id。 */
  | 'provider'
  /** provider 表项本身（对象）。 */
  | 'providerEntry'
  /** 需要置为 true 的布尔标记（如 Cursor 的 `hasChangedDefaultModel`）。 */
  | 'flagTrue'

/**
 * 表单上要用户决定的两个模型槽位，见 `agentClientModelSlots`。
 *
 * 单独切出一个类型而不是复用 `AgentClientFieldRole`：界面按槽位渲染行、按槽位回读初值，
 * 而「基础地址」这类角色永远不会成为一行（它由服务端固定写入），编译器应该替我们把这件事说清。
 */
export type AgentClientModelSlot = Extract<AgentClientFieldRole, 'model' | 'smallModel'>

/**
 * 模板里一个值：字面量，或者一个 `{{占位符}}`。
 *
 * 刻意用**纯数据**而不是函数表达「provider 表项长什么样」：它是这个客户端的一条事实，
 * 和「它读哪个文件、有哪些键」属于同一份清单，分开住在两个包里只会让两边慢慢走样，
 * 而控制台也没法拿一个函数去渲染表单。
 */
export type AgentClientTemplateValue = string | number | boolean | null | AgentClientTemplateValue[] | { [key: string]: AgentClientTemplateValue }

/** 模板里可以引用的实值。 */
export interface AgentClientTemplateContext {
  /** 本机服务的监听地址。 */
  baseUrl: string
  /** 那个固定样例密钥。 */
  apiKey: string
  /** 用户选定的主模型。 */
  model: string
  /** 用户选定的小模型（已回落到主模型）。 */
  smallModel: string
  /** 见 `LOCAL_PROVIDER_ID`。 */
  providerId: string
  /** 见 `LOCAL_PROVIDER_NAME`。 */
  providerName: string
}

export interface AgentClientProviderEntryTemplate {
  /** 表项路径的点号写法；`{{providerId}}` 会被换成本地 provider id。 */
  path: string
  /** 表项骨架，键与值里的占位符在写入前统一替换。 */
  template: Record<string, AgentClientTemplateValue>
}

/**
 * 「把这个客户端的配置指到本机服务」的配方。
 *
 * 为什么注册表里那点声明不够、还需要这一块：注册表描述「这些键存在、它们是这个意思」，
 * 而改配置还需要知道注册表不该关心的事——哪些键应当**一起**被覆盖（Claude Code 的
 * `opus/sonnet/haiku` 别名必须跟着改，否则用户切一下别名就跑到真实 Anthropic 去了）、
 * provider 表项长什么样、以及哪些键**必须放过**（推理档位、认证方式是用户自己的取舍）。
 */
export interface AgentClientApplyConfig {
  /** 注册表 `fields[].key` → 要写什么。没列出的 key 不写。 */
  roles: Record<string, AgentClientFieldRole>
  /** 明确放过、但确实属于这个客户端的键（有意的「不碰」清单）。 */
  ignored: string[]
  /** 模型字段的值前缀，如 OpenCode 要求 `provider/model`。 */
  modelPrefix?: string
  /** provider 表项的路径与模板。 */
  providerEntry?: AgentClientProviderEntryTemplate
}

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
  /**
   * 「把配置指到本机服务」的配方。缺省表示自动填充不可用，详情页因此**不摆**「要写入的模型」那一块。
   *
   * 缺省的两种情形：一是没有可指向本地服务的地址字段（Copilot CLI、Cursor CLI 只存模型名）；
   * 二是地址与 provider 定义分在两个文件里、或者配置是按条目打补丁的（Pi、DeepSeek Harness）。
   * 两者都是「我们写不对」，不是「用户接不上」——所以界面不摆空表单，而是让用户直接编辑文件，
   * 并在客户端列表页顶部给出地址与受理路径（见控制台的 `ManualSetupBand`）。
   */
  apply?: AgentClientApplyConfig
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
      { key: 'subagent', path: 'env.CLAUDE_CODE_SUBAGENT_MODEL', type: 'string', description: 'Model used by subagents the main session spawns.' },
    ],
    apply: {
      roles: {
        model: 'model',
        baseUrl: 'baseUrl',
        authToken: 'apiKey',
        mainModel: 'model',
        // 五个模型别名一起改成同一个名字：base URL 已经指向本地了，别名再解析到真实
        // Anthropic 的模型名就会绕过路由，用户在 CLI 里切 `haiku` 时最难发现这类漏改。
        opus: 'model',
        sonnet: 'model',
        haiku: 'model',
        fable: 'model',
        smallFast: 'smallModel',
        // 子代理干的是正文里的活，不是 `smallFast` 那类「起个标题」的小任务，所以归 `model`：
        // 分法沿用文件里已有的两档，不在这里重新判断什么算「小」。
        subagent: 'model',
      },
      ignored: [],
    },
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
    apply: {
      roles: {
        model: 'model',
        provider: 'provider',
        providerTable: 'providerEntry',
      },
      // 推理档位与额外模型目录是用户自己的取舍，与「走哪个地址」无关。
      ignored: ['effort', 'catalog'],
      providerEntry: {
        path: 'model_providers.{{providerId}}',
        // 不写 `env_key`：本地服务不校验鉴权，而 `env_key` 一旦写了，Codex 会要求这个环境
        // 变量必须存在，等于凭空给用户加一个必须导出的变量。
        template: {
          name: '{{providerName}}',
          base_url: '{{baseUrl}}',
          wire_api: 'responses',
        },
      },
    },
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
    apply: {
      roles: {
        model: 'model',
        baseUrl: 'baseUrl',
        apiKey: 'apiKey',
      },
      // 认证方式由用户自己决定（oauth / api-key / vertex）；我们只改地址与密钥。
      ignored: ['auth'],
    },
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
    apply: {
      roles: {
        model: 'model',
        small: 'smallModel',
        provider: 'providerEntry',
      },
      ignored: [],
      modelPrefix: `${LOCAL_PROVIDER_ID}/`,
      providerEntry: {
        path: 'provider.{{providerId}}',
        template: {
          npm: '@ai-sdk/openai-compatible',
          name: '{{providerName}}',
          options: { baseURL: '{{baseUrl}}', apiKey: '{{apiKey}}' },
          // OpenCode 只认 provider 里声明过的 model id，所以把用户选中的那个也登记进去。
          models: { '{{model}}': {} },
        },
      },
    },
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
    // 不提供 `apply`：这个配置文件里没有任何「指向哪个地址」的字段，模型名与它的展示字段就是全部。
    // 要换上游只能靠 `HTTP_PROXY` / `HTTPS_PROXY` 这类进程环境变量，那不在文件里，我们不改用户的环境。
    // 官方文档里能改的也只有编辑器行为与权限（version / editor / permissions），所以是「真的没得配」。
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
    // 不提供 `apply`：settings.json 里只有一个模型名，没有地址也没有 provider 表。
    // 鉴权走 `/login` 或 `COPILOT_GITHUB_TOKEN` 这类环境变量，同样不在文件里。
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
    /*
     * 不提供 `apply`：这个客户端**是**能接上的（models.json 里 `providers.<id>` 收 `api`/`baseUrl`/`apiKey`），
     * 但模型选在 settings.json、provider 定义在 models.json，而配方目前只能把 provider 表写进
     * 「模型字段所在的那个文件」（`AgentClientProviderEntryTemplate.path` 是同一个文件里的点号路径），
     * 摆不下这种跨文件组合。要补的话得先扩配方的形状，而不是在这里写一个会写歪的配方。
     */
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
    /*
     * 不提供 `apply`：上面那三个点号路径是**读**出来的位置，而写入要的是「按 id 打补丁」
     * ——config.yaml 里每一行都是一个 `{id, config}` 条目，改一个键要连着 id 一起重建整行，
     * 还得跟用户自己写的条目共存。配方（点号路径 + 模板整块替换）表达不了这种形状，
     * 所以宁可让用户手动改，也不拿「看起来对」的补丁去覆盖别人的配置。
     */
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

/** provider 表项在该客户端上的具体路径（把 `{{providerId}}` 换成真实 id）。 */
export function concreteAgentClientProviderEntryPath(config: AgentClientApplyConfig): string | null {
  return config.providerEntry ? config.providerEntry.path.replaceAll('{{providerId}}', LOCAL_PROVIDER_ID) : null
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
