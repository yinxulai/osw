import { describe, expect, it } from 'vitest'
import {
  AGENT_CLIENT_DEFINITIONS,
  AGENT_CLIENT_DEFINITION_BY_KEY,
  LOCAL_PROVIDER_ID,
  LOCAL_PROVIDER_NAME,
  agentClientModelSlots,
  expandAgentClientTemplate,
  resolveAgentClientSlotValue,
  resolveLocalProviderIdentity,
  type AgentClientTemplateContext,
} from '@common/clients'
import {
  type ClientApplyContext,
  type ClientApplyIdentity,
  type ClientApplyRule,
  concreteProviderEntryPath,
  getClientApplyConfig,
  getClientApplyRule,
  getClientApplyRuleKeys,
  resolveFieldValue,
  resolveModelPrefix,
  stripModelPrefix,
} from './rules'

/**
 * 逐客户端配方。
 *
 * 配方本身是注册表的一部分（`@common/clients` 里的 `apply`），这里测的是**执行器**：
 * 注册表里面那份纯数据能不能被正确展开、覆盖是否完整。
 *
 * 最容易出事的不是「写错值」，而是**漏写**：注册表里新加一个会读到真实厂商的键（模型别名是重灾区），
 * 配方里没登记就没人发现，直到用户切了个别名直接绕开本地路由。所以下面除了逐条检查含义，
 * 更主要的是检查「覆盖完整」——注册表里的每个键都必须有明确归属（要么在 `roles` 里写，要么在
 * `ignored` 里显式放过），而没有配方的客户端必须是**我们已知的**那几个。
 */

const CONTEXT: ClientApplyContext = {
  baseUrl: 'http://127.0.0.1:9300',
  apiKey: 'sk-osw',
  model: 'osw-model',
  smallModel: 'osw-small',
}

/** 正式环境那一套身份（测试里的默认口径）。 */
const PRODUCTION: ClientApplyIdentity = resolveLocalProviderIdentity('production')
/** 开发环境那一套：**必须**与正式不同名，否则两套环境会写进同一条表项、互相覆盖。 */
const DEVELOPMENT: ClientApplyIdentity = resolveLocalProviderIdentity('development')

const TEMPLATE_CONTEXT: AgentClientTemplateContext = {
  ...CONTEXT,
  providerId: PRODUCTION.id,
  providerName: PRODUCTION.name,
}

/** 两套身份都要满足的断言，逐条跑一遍。 */
const IDENTITIES: readonly [string, ClientApplyIdentity][] = [
  ['production', PRODUCTION],
  ['development', DEVELOPMENT],
]

describe('provider identity', () => {
  it('never lets development borrow the production name', () => {
    // 这就是整件事的前提：两套身份一旦同名，开发实例写的就是正式那一条表项（同一个键），
    // 后写的那次直接把前一次覆盖掉——用户真正的配置被改到一个 19300 的地址上。
    expect(DEVELOPMENT.id).not.toBe(PRODUCTION.id)
    expect(DEVELOPMENT.name).not.toBe(PRODUCTION.name)
  })

  it('keeps the production identity equal to the published constants', () => {
    // `LOCAL_PROVIDER_ID` / `LOCAL_PROVIDER_NAME` 是对外的那一对字面量（示例代码、文档都用它），
    // 它们必须与 `resolveLocalProviderIdentity('production')` 说同一件事。
    expect(PRODUCTION.id).toBe(LOCAL_PROVIDER_ID)
    expect(PRODUCTION.name).toBe(LOCAL_PROVIDER_NAME)
  })

  it('uses a key-safe id: no whitespace, no template braces left', () => {
    // id 要当配置文件的**键**用（`model_providers.osw-dev`），带空格或残留占位符就写不出合法配置；
    // 带空格的那个名字只能当展示名。
    for (const [label, identity] of IDENTITIES) {
      expect(identity.id, `${label} 的 id 不是合法的键`).toMatch(/^[a-z0-9][a-z0-9._-]*$/)
      expect(identity.id).not.toContain('{{')
      expect(identity.name.trim()).toBe(identity.name)
      expect(identity.name.length).toBeGreaterThan(0)
    }
  })
})

/**
 * 没有配方的客户端：只能手改、没有任何可指向本地服务的字段。注册表里**每个**客户端目前都有配方，
 * 所以下面这条「覆盖完整」的断言要求「有配方的客户端集合」等于「注册表全集」——这正是要守住的形状：
 * 新收一个客户端却忘了给它配方，这里就会失败。
 * 跨文件（地址与 provider 表项分在两个文件里）不构成「没有配方」——Pi 靠给字段标 `file` 走跨文件配方。
 * 靠环境变量交付地址与密钥的（Copilot CLI 的 `COPILOT_PROVIDER_*`）也是正常配方——那正是 `file` + `load`
 * 要覆盖的情形，配方照常给出 `roles`。
 * 存储形状（如 `patchList`）也不构成「没有配方」——它已由 `files[].shape` 声明、由格式编辑器解释，
 * 配方只管「往哪个逻辑路径写什么」。
 */

describe('rule coverage', () => {
  it('only writes recipes for clients that exist', () => {
    for (const key of getClientApplyRuleKeys()) {
      expect(AGENT_CLIENT_DEFINITIONS.map(client => client.key)).toContain(key)
    }
  })

  it('knows exactly which clients it cannot autofill', () => {
    // 注册表里每个客户端都必须有配方：漏一个，用户在这个客户端上就点不动「自动填充」。
    const covered = getClientApplyRuleKeys().sort()
    const expected = AGENT_CLIENT_DEFINITIONS.map(client => client.key).sort()
    expect(covered).toEqual(expected)
  })

  it('gives every declared field of a covered client a role or an explicit pass', () => {
    for (const key of getClientApplyRuleKeys()) {
      const rule = getClientApplyRule(key)!
      const declared = AGENT_CLIENT_DEFINITION_BY_KEY[key]!.fields.map(field => field.key)

      for (const fieldKey of declared) {
        const handled = fieldKey in rule.roles || rule.ignored.includes(fieldKey)
        expect(handled, `${key}.${fieldKey} 既没有角色也没有被放过`).toBe(true)
      }
    }
  })

  it('never mentions a field the client does not declare', () => {
    for (const key of getClientApplyRuleKeys()) {
      const rule = getClientApplyRule(key)!
      const declared = AGENT_CLIENT_DEFINITION_BY_KEY[key]!.fields.map(field => field.key)

      for (const fieldKey of [...Object.keys(rule.roles), ...rule.ignored]) {
        expect(declared, `${key}.${fieldKey} 不在注册表里`).toContain(fieldKey)
      }
    }
  })

  it('never both writes and ignores the same field', () => {
    for (const key of getClientApplyRuleKeys()) {
      const rule = getClientApplyRule(key)!
      for (const ignored of rule.ignored) expect(ignored in rule.roles).toBe(false)
    }
  })

  it('sends every model alias to the local service', () => {
    // 漏掉任何一个别名，用户在 CLI 里切到它就会绕过本地路由——这是最难被发现的一类漏改。
    // 别名清单来自 Claude Code 自己的环境变量写法（含子代理用的 `CLAUDE_CODE_SUBAGENT_MODEL`）。
    // `*Name` 是 `/model` 选择器里的展示名，留着旧值会让用户以为切换没生效，所以也一并改写。
    const claudeCode = getClientApplyRule('claude-code')!
    for (const alias of ['mainModel', 'opus', 'opusName', 'sonnet', 'sonnetName', 'haiku', 'haikuName', 'fable', 'fableName', 'subagent']) {
      expect(claudeCode.roles[alias]).toBe('model')
    }
    expect(claudeCode.roles['smallFast']).toBe('smallModel')
    expect(claudeCode.roles['authToken']).toBe('apiKey')
    expect(claudeCode.roles['baseUrl']).toBe('baseUrl')
  })

  it('keeps the user own choices out of the rewrite', () => {
    expect(getClientApplyRule('codex')!.ignored).toEqual(['effort'])
  })
})

describe('provider entries', () => {
  it('declares a concrete entry path only where one is needed', () => {
    expect(concreteProviderEntryPath(getClientApplyRule('codex')!, PRODUCTION)).toBe('model_providers.osw')
    expect(concreteProviderEntryPath(getClientApplyRule('opencode')!, PRODUCTION)).toBe('provider.osw')
    expect(concreteProviderEntryPath(getClientApplyRule('deepseek-harness')!, PRODUCTION)).toBe('llm-pi-ai.providers.osw')
    expect(concreteProviderEntryPath(getClientApplyRule('claude-code')!, PRODUCTION)).toBeNull()
  })

  it('sends the development entry to a path of its own, next to the production one', () => {
    // 这一条就是整个改动的目的：同一台机器上，开发实例写的表项不能落在正式那一条上。
    // 落在同一条 = 开发时点一下「生成配置」就把用户正在用的正式配置改掉了。
    const codex = getClientApplyRule('codex')!
    const opencode = getClientApplyRule('opencode')!
    const dsh = getClientApplyRule('deepseek-harness')!
    const vscode = getClientApplyRule('vscode')!
    // VS Code 按 `name` 认条目，路径必须与模板里那个 name 字面相等，所以两处一起变。
    expect(concreteProviderEntryPath(vscode, DEVELOPMENT)).toBe(DEVELOPMENT.name)

    for (const rule of [codex, opencode, dsh, vscode]) {
      expect(concreteProviderEntryPath(rule, DEVELOPMENT)).not.toBe(concreteProviderEntryPath(rule, PRODUCTION))
    }
    expect(concreteProviderEntryPath(codex, DEVELOPMENT)).toBe('model_providers.osw-dev')
  })

  it('builds the codex table without an env_key', () => {
    const entry = getClientApplyRule('codex')!.providerEntry!.build(CONTEXT, PRODUCTION)

    expect(entry).toEqual({ name: PRODUCTION.name, base_url: CONTEXT.baseUrl, wire_api: 'responses' })
    // `env_key` 一旦写进去，Codex 会要求那个变量必须存在。
    expect('env_key' in entry).toBe(false)
  })

  it('builds the opencode provider with the model the user picked', () => {
    const entry = getClientApplyRule('opencode')!.providerEntry!.build({ ...CONTEXT, model: 'gpt-5' }, PRODUCTION)

    expect(entry).toEqual({
      npm: '@ai-sdk/openai-compatible',
      name: PRODUCTION.name,
      options: { baseURL: CONTEXT.baseUrl, apiKey: CONTEXT.apiKey },
      models: { 'gpt-5': {} },
    })
  })

  it('builds the pi provider with a bare origin plus /v1 and an array of models', () => {
    const entry = getClientApplyRule('pi')!.providerEntry!.build({ ...CONTEXT, model: 'gpt-5' }, PRODUCTION)

    expect(entry).toEqual({
      name: PRODUCTION.name,
      // Pi 要求 baseUrl 指向 `/v1`，而默认值给的是裸 origin。
      baseUrl: `${CONTEXT.baseUrl}/v1`,
      api: 'openai-completions',
      apiKey: CONTEXT.apiKey,
      // Pi 的 models 是**数组**（每个 { id, name }），不是对象。
      models: [{ id: 'gpt-5', name: 'gpt-5' }],
    })
  })

  it('builds the deepseek-harness route with /v1, an array of models, and a placeholder bearer header', () => {
    const entry = getClientApplyRule('deepseek-harness')!.providerEntry!.build({ ...CONTEXT, model: 'gpt-5' }, PRODUCTION)

    expect(entry).toEqual({
      displayName: PRODUCTION.name,
      api: 'openai-completions',
      // baseURL 落在 route 上、指向本机服务的 `/v1`。
      baseURL: `${CONTEXT.baseUrl}/v1`,
      // 与 OpenCode/Pi 不同，dsh 的 models 是 { id } 数组；而手工声明的模型**自带零个推理档位**，
      // 必须显式声明 `reasoningEfforts`，否则 harness 会对任何请求的档位报 UNSUPPORTED_REASONING_EFFORT。
      // `off` 留空 = 这一档支持、但请求里什么都不发。
      models: [
        {
          id: 'gpt-5',
          reasoningEfforts: {
            off: null,
            minimal: 'minimal',
            low: 'low',
            medium: 'medium',
            high: 'high',
            xhigh: 'xhigh',
            max: 'max',
          },
        },
      ],
      // pi-ai 的 OpenAI 兼容实现即使本地服务不校验密钥也要求带一个凭证，于是写一个占位 Bearer 头。
      headers: { Authorization: `Bearer ${CONTEXT.apiKey}` },
    })
  })

  it('names the entry after the identity it was built with, never after the production one', () => {
    // 表项内容与表项路径必须是**同一套身份**：名字变了、键没变（或反过来），写下去就是两条互不相认的
    // 表项——开发环境以为自己新增了一条，实际上旁边还留着一条指向 9300 的正式表项。
    for (const [label, identity] of IDENTITIES) {
      for (const key of ['codex', 'opencode', 'pi', 'deepseek-harness'] as const) {
        const serialized = JSON.stringify(getClientApplyRule(key)!.providerEntry!.build(CONTEXT, identity))
        expect(serialized, `${key} 在 ${label} 下没写对名字`).toContain(`"${identity.name}"`)
        if (identity !== PRODUCTION) {
          // 比的是**带引号的完整值**：开发环境的展示名（`OSW Development`）本来就含 `OSW` 三个字，
          // 用子串去判会把正确的输出误判成「写了正式的名字」。
          expect(serialized, `${key} 在 ${label} 下写进了正式的名字`).not.toContain(`"${PRODUCTION.name}"`)
        }
      }
    }
  })
})

describe('resolveFieldValue', () => {
  const bare: ClientApplyRule = { roles: {}, ignored: [] }

  it('passes the context through for the direct roles', () => {
    expect(resolveFieldValue('baseUrl', CONTEXT, bare, PRODUCTION)).toBe(CONTEXT.baseUrl)
    expect(resolveFieldValue('apiKey', CONTEXT, bare, PRODUCTION)).toBe(CONTEXT.apiKey)
    expect(resolveFieldValue('provider', CONTEXT, bare, PRODUCTION)).toBe(PRODUCTION.id)
    expect(resolveFieldValue('flagTrue', CONTEXT, bare, PRODUCTION)).toBe(true)
  })

  it('writes the provider id of the identity it was given', () => {
    // `provider` 是「指向哪条表项」，必须与表项路径用的是同一个 id，否则主键与表项对不上。
    expect(resolveFieldValue('provider', CONTEXT, bare, DEVELOPMENT)).toBe(DEVELOPMENT.id)
    expect(resolveFieldValue('provider', CONTEXT, bare, DEVELOPMENT)).not.toBe(PRODUCTION.id)
  })

  it('rounds an empty small model down to the prefix, leaving the caller to skip it', () => {
    // 空值的处置交给 `service.ts`（没填就不写这个键），这里只负责按规则拼字符串。
    expect(resolveFieldValue('smallModel', { ...CONTEXT, smallModel: '' }, bare, PRODUCTION)).toBe('')
  })

  it('prefixes a model only when the client asks for it', () => {
    const opencode = getClientApplyRule('opencode')!

    expect(resolveFieldValue('model', CONTEXT, bare, PRODUCTION)).toBe('osw-model')
    expect(resolveFieldValue('model', CONTEXT, opencode, PRODUCTION)).toBe('osw/osw-model')
    expect(resolveFieldValue('smallModel', CONTEXT, opencode, PRODUCTION)).toBe('osw/osw-small')
  })

  it('prefixes the model with the name of the environment the entry lives in', () => {
    // OpenCode 的模型字段是 `provider/model`：前缀指的就是那条表项。开发环境的表项叫 `osw-dev`，
    // 前缀却写 `osw/` 的话，模型名会指到正式那条表项上去——配置里看着有两条，实际只有一条被用。
    const opencode = getClientApplyRule('opencode')!

    expect(resolveModelPrefix(opencode, DEVELOPMENT)).toBe(`${DEVELOPMENT.id}/`)
    expect(resolveFieldValue('model', CONTEXT, opencode, DEVELOPMENT)).toBe(`${DEVELOPMENT.id}/osw-model`)
    expect(resolveFieldValue('model', CONTEXT, opencode, DEVELOPMENT)).not.toBe(resolveFieldValue('model', CONTEXT, opencode, PRODUCTION))
  })

  it('writes nothing for the roles carried by another path', () => {
    // `providerTable` / `provider` 这类角色由 providerEntry 的表项路径承载，自身不写值。
    expect(resolveFieldValue('providerEntry', CONTEXT, bare, PRODUCTION)).toBeNull()
  })
})

describe('stripModelPrefix', () => {
  const bare: ClientApplyRule = { roles: {}, ignored: [] }
  const opencode = getClientApplyRule('opencode')!

  it('removes the prefix the recipe itself would add', () => {
    // 一键生效会「读回文件里已经写好的模型名再写一遍」，不去前缀就会变成 osw/osw/xxx。
    expect(stripModelPrefix(opencode, 'osw/osw-model', PRODUCTION)).toBe('osw-model')
  })

  it('removes the development prefix just the same', () => {
    // 前缀随环境变，去掉时要按**当前环境**去：只认死 `osw/` 的话，开发环境读回来的
    // `osw-dev/gpt-5` 会被原样写回，再点一次就变成 `osw-dev/osw-dev/gpt-5`。
    expect(stripModelPrefix(opencode, `${DEVELOPMENT.id}/osw-model`, DEVELOPMENT)).toBe('osw-model')
    // 反过来也要成立：不确定用哪套身份时不能拿另一套去切。
    expect(stripModelPrefix(opencode, 'osw/osw-model', DEVELOPMENT)).toBe('osw/osw-model')
  })

  it('leaves a value without the prefix alone', () => {
    expect(stripModelPrefix(opencode, 'osw-model', PRODUCTION)).toBe('osw-model')
    // 前缀只在开头算数：中间带斜杠的模型名（如 `anthropic/claude`）不能被误伤。
    expect(stripModelPrefix(opencode, 'anthropic/claude', PRODUCTION)).toBe('anthropic/claude')
  })

  it('does nothing for recipes without a prefix', () => {
    expect(stripModelPrefix(bare, 'osw/osw-model', PRODUCTION)).toBe('osw/osw-model')
  })
})

describe('registry-declared recipes', () => {
  it('keeps the recipe in the registry, not in this layer', () => {
    // 两边一旦分家就会慢慢走样：注册表加了键、配方没跟，谁都不知道。
    for (const key of getClientApplyRuleKeys()) {
      expect(getClientApplyConfig(key), `${key} 的配方不在注册表里`).not.toBeNull()
      expect(AGENT_CLIENT_DEFINITION_BY_KEY[key]!.apply).toBeDefined()
    }
  })

  it('declares every provider entry path as a placeholder, never a literal id', () => {
    for (const key of getClientApplyRuleKeys()) {
      const entry = getClientApplyConfig(key)!.providerEntry
      // 表项路径必须是模板：多数客户端用 `{{providerId}}`，条目数组形状的（VS Code）按 `name` 认身份，
      // 用 `{{providerName}}`。写死任何一个真实 id 都会在换 provider 身份时悄悄指错条目。
      if (entry) expect(entry.path, `${key} 的表项路径写死了 provider id`).toMatch(/\{\{(providerId|providerName)\}\}/)
    }
  })

  it('expands placeholders written as object keys too', () => {
    // OpenCode 拿模型名当 provider 的 model id（`models: { '{{model}}': {} }`）；
    // 只替换值不替换键的话，它的模型列表永远是空的。
    const template = getClientApplyConfig('opencode')!.providerEntry!.template

    expect(expandAgentClientTemplate(template, { ...TEMPLATE_CONTEXT, model: 'gpt-5' })).toEqual({
      npm: '@ai-sdk/openai-compatible',
      name: PRODUCTION.name,
      options: { baseURL: CONTEXT.baseUrl, apiKey: CONTEXT.apiKey },
      models: { 'gpt-5': {} },
    })
  })

  it('refuses an unknown placeholder instead of writing it verbatim', () => {
    // 拼错的占位符（`{{baseURL}}`）静默留成字面量的话，会直接写进用户的配置文件。
    expect(() => expandAgentClientTemplate({ url: '{{baseURL}}' }, TEMPLATE_CONTEXT)).toThrow(/baseURL/)
  })

  it('leaves non-string leaves alone', () => {
    const expanded = expandAgentClientTemplate({ enabled: true, count: 3, nothing: null }, TEMPLATE_CONTEXT)

    expect(expanded).toEqual({ enabled: true, count: 3, nothing: null })
  })
})

describe('model slots', () => {
  it('collapses the claude-code aliases into two rows', () => {
    // 五个别名写的是同一个值，表单上只能是**一行**：用户要决定的是「用哪个模型」。
    expect(agentClientModelSlots(getClientApplyConfig('claude-code')!)).toEqual(['model', 'smallModel'])
  })

  it('keeps the main model first and the small model last', () => {
    for (const key of getClientApplyRuleKeys()) {
      const slots = agentClientModelSlots(getClientApplyConfig(key)!)
      // 没有模型槽位的客户端跳过：VS Code 的模型名写在 provider 条目里，注册表不为它登记 `model` 角色。
      if (slots.length === 0) continue
      expect(slots[0], `${key} 的主模型槽位不在第一位`).toBe('model')
      if (slots.includes('smallModel')) expect(slots.indexOf('smallModel')).toBe(slots.length - 1)
    }
  })

  it('gives a client without a small model exactly one row', () => {
    // 配方里没有 `smallModel` 的客户端不该出现一个写了也没人读的输入框。
    expect(agentClientModelSlots(getClientApplyConfig('codex')!)).toEqual(['model'])
  })

  it('takes the current value from whichever alias actually has one', () => {
    const claudeCode = getClientApplyConfig('claude-code')!

    // `detected` 的键是注册表里的**语义名**（`service.ts` 按 `field.key` 回读），不是配置文件路径。
    expect(resolveAgentClientSlotValue(claudeCode, { mainModel: 'sonnet-5' }, 'model')).toBe('sonnet-5')
    expect(resolveAgentClientSlotValue(claudeCode, { model: 'haiku-5' }, 'model')).toBe('haiku-5')
    // 一个都没有就是空串——界面按「读不到」渲染，不能当成「原来是空的」。
    expect(resolveAgentClientSlotValue(claudeCode, {}, 'model')).toBe('')
  })

  it('strips the provider prefix before putting the value back in the box', () => {
    const opencode = getClientApplyConfig('opencode')!

    expect(resolveAgentClientSlotValue(opencode, { model: 'osw/gpt-5' }, 'model')).toBe('gpt-5')
  })
})
