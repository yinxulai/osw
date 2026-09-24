/**
 * 「把某个客户端的配置指到本地服务」这件事的**逐客户端配方**。
 *
 * 为什么不能全靠注册表里那点声明自动推：注册表描述的是「这些键存在、它们是这个意思」，
 * 而改配置还需要知道注册表不该关心的事——
 *
 *   - 哪些键应当一起被覆盖（Claude Code 的 `opus/sonnet/haiku` 别名都必须跟着改，
 *     否则用户切一下别名就跑到真实 Anthropic 去了）；
 *   - provider 表项长什么样（Codex 的 `[model_providers.osw]` 与 OpenCode 的
 *     `provider.osw.options` 是两套不同结构）；
 *   - 哪些键**必须放过**（`model_reasoning_effort`、`security.auth.selectedType`…）。
 *
 * 没有配方的客户端就是「没有可指向本地服务的地址字段」（Copilot CLI、Cursor CLI 只存模型名），
 * 或地址与 provider 定义分在两个文件里（Pi），此时自动填充不可用，界面引导用户手动编辑。
 * `rules.test.ts` 会校验：配方提到的 key 必须都在注册表里，且注册表里的每个 key
 * 要么有角色、要么在 `ignored` 里——加字段时忘了登记会直接测试失败。
 */

/** 写进客户端配置的 provider id / 名字。 */
export const LOCAL_PROVIDER_ID = 'osw'
export const LOCAL_PROVIDER_NAME = 'One Switch'

export type ClientFieldRole =
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

export interface ClientApplyContext {
  baseUrl: string
  apiKey: string
  model: string
  smallModel: string
}

export interface ClientApplyRule {
  /** 注册表 `fields[].key` → 要写什么。没列出的 key 不写。 */
  roles: Record<string, ClientFieldRole>
  /** 明确放过、但确实属于这个客户端的键（有意的「不碰」清单）。 */
  ignored: string[]
  /** provider 表项的路径与结构；`<id>` 会被替换成 `LOCAL_PROVIDER_ID`。 */
  providerEntry?: {
    path: string
    build: (context: ClientApplyContext) => Record<string, unknown>
  }
  /** 模型字段的值前缀，如 OpenCode 要求 `provider/model`。 */
  modelPrefix?: string
}

const RULES: Record<string, ClientApplyRule> = {
  'claude-code': {
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
    },
    ignored: [],
  },
  codex: {
    roles: {
      model: 'model',
      provider: 'provider',
      providerTable: 'providerEntry',
    },
    // 推理档位与额外模型目录是用户自己的取舍，与「走哪个地址」无关。
    ignored: ['effort', 'catalog'],
    providerEntry: {
      path: 'model_providers.<id>',
      // 不写 `env_key`：本地服务不校验鉴权，而 `env_key` 一旦写了，Codex 会要求这个环境
      // 变量必须存在，等于凭空给用户加一个必须导出的变量。
      build: context => ({
        name: LOCAL_PROVIDER_NAME,
        base_url: context.baseUrl,
        wire_api: 'responses',
      }),
    },
  },
  'gemini-cli': {
    roles: {
      model: 'model',
      baseUrl: 'baseUrl',
      apiKey: 'apiKey',
    },
    // 认证方式由用户自己决定（oauth / api-key / vertex）；我们只改地址与密钥。
    ignored: ['auth'],
  },
  opencode: {
    roles: {
      model: 'model',
      small: 'smallModel',
      provider: 'providerEntry',
    },
    ignored: [],
    modelPrefix: `${LOCAL_PROVIDER_ID}/`,
    providerEntry: {
      path: 'provider.<id>',
      build: context => ({
        npm: '@ai-sdk/openai-compatible',
        name: LOCAL_PROVIDER_NAME,
        options: { baseURL: context.baseUrl, apiKey: context.apiKey },
        // OpenCode 只认 provider 里声明过的 model id，所以这里把它登记的模型一起写进去。
        models: { [context.model]: {} },
      }),
    },
  },
}

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
 */
export function resolveFieldValue(role: ClientFieldRole, context: ClientApplyContext, rule: ClientApplyRule): string | boolean | null {
  switch (role) {
    case 'baseUrl':
      return context.baseUrl
    case 'apiKey':
      return context.apiKey
    case 'model':
      return `${rule.modelPrefix ?? ''}${context.model}`
    case 'smallModel':
      return `${rule.modelPrefix ?? ''}${context.smallModel}`
    case 'provider':
      return LOCAL_PROVIDER_ID
    case 'flagTrue':
      return true
    case 'providerEntry':
      return null
  }
}

/** provider 表项在某个客户端上使用的具体路径（把 `<id>` 换成真实 id）。 */
export function concreteProviderEntryPath(rule: ClientApplyRule): string | null {
  return rule.providerEntry ? rule.providerEntry.path.replace('<id>', LOCAL_PROVIDER_ID) : null
}

/**
 * 反向解析模型字段：把 `osw/xxx` 还原成 `xxx`。
 *
 * 一键生效要「沿用用户已经选好的模型名」，而读回来的值是带前缀的（OpenCode 只认
 * `provider/model`），不脱掉前缀再写回去就会变成 `osw/osw/xxx`。
 */
export function stripModelPrefix(rule: ClientApplyRule, value: string): string {
  const prefix = rule.modelPrefix
  if (!prefix || !value.startsWith(prefix)) return value
  return value.slice(prefix.length)
}
