import { describe, expect, it } from 'vitest'
import { AGENT_CLIENT_DEFINITIONS, AGENT_CLIENT_DEFINITION_BY_KEY } from '@common/clients'
import {
  LOCAL_PROVIDER_ID,
  LOCAL_PROVIDER_NAME,
  type ClientApplyContext,
  type ClientApplyRule,
  concreteProviderEntryPath,
  getClientApplyRule,
  getClientApplyRuleKeys,
  resolveFieldValue,
  stripModelPrefix,
} from './rules'

/**
 * 逐客户端配方。
 *
 * 最容易出事的不是「写错值」，而是**漏写**：注册表里新加一个会读到真实厂商的键（模型别名是重灾区），
 * 配方里没登记就没人发现，直到用户切了个别名直接绕开本地路由。所以这里除了逐条检查配方的含义，
 * 更主要的是检查「覆盖完整」——注册表里的每个键都必须有明确归属（要么在 `roles` 里写，要么在
 * `ignored` 里显式放过），而没有配方的客户端必须是**我们已知的**那几个。
 */

const CONTEXT: ClientApplyContext = {
  baseUrl: 'http://127.0.0.1:9300',
  apiKey: 'sk-osw',
  model: 'osw-model',
  smallModel: 'osw-small',
}

/** 没有配方的客户端：地址与凭证不在同一个文件里（Pi），或压根没有可填的地址字段。 */
const CLIENTS_WITHOUT_RULE = ['copilot-cli', 'cursor-cli', 'deepseek-harness', 'pi']

describe('rule coverage', () => {
  it('only writes recipes for clients that exist', () => {
    for (const key of getClientApplyRuleKeys()) {
      expect(AGENT_CLIENT_DEFINITIONS.map(client => client.key)).toContain(key)
    }
  })

  it('knows exactly which clients it cannot autofill', () => {
    for (const key of CLIENTS_WITHOUT_RULE) {
      expect(getClientApplyRule(key)).toBeNull()
      expect(AGENT_CLIENT_DEFINITIONS.map(client => client.key)).toContain(key)
    }

    const covered = getClientApplyRuleKeys().sort()
    const expected = AGENT_CLIENT_DEFINITIONS.map(client => client.key)
      .filter(key => !CLIENTS_WITHOUT_RULE.includes(key))
      .sort()
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
    const claudeCode = getClientApplyRule('claude-code')!
    for (const alias of ['mainModel', 'opus', 'sonnet', 'haiku', 'fable']) {
      expect(claudeCode.roles[alias]).toBe('model')
    }
    expect(claudeCode.roles['smallFast']).toBe('smallModel')
    expect(claudeCode.roles['authToken']).toBe('apiKey')
    expect(claudeCode.roles['baseUrl']).toBe('baseUrl')
  })

  it('keeps the user own choices out of the rewrite', () => {
    expect(getClientApplyRule('codex')!.ignored).toEqual(['effort', 'catalog'])
    expect(getClientApplyRule('gemini-cli')!.ignored).toEqual(['auth'])
  })
})

describe('provider entries', () => {
  it('declares a concrete entry path only where one is needed', () => {
    expect(concreteProviderEntryPath(getClientApplyRule('codex')!)).toBe('model_providers.osw')
    expect(concreteProviderEntryPath(getClientApplyRule('opencode')!)).toBe('provider.osw')
    expect(concreteProviderEntryPath(getClientApplyRule('claude-code')!)).toBeNull()
    expect(concreteProviderEntryPath(getClientApplyRule('gemini-cli')!)).toBeNull()
  })

  it('builds the codex table without an env_key', () => {
    const entry = getClientApplyRule('codex')!.providerEntry!.build(CONTEXT)

    expect(entry).toEqual({ name: LOCAL_PROVIDER_NAME, base_url: CONTEXT.baseUrl, wire_api: 'responses' })
    // `env_key` 一旦写进去，Codex 会要求那个变量必须存在。
    expect('env_key' in entry).toBe(false)
  })

  it('builds the opencode provider with the model the user picked', () => {
    const entry = getClientApplyRule('opencode')!.providerEntry!.build({ ...CONTEXT, model: 'gpt-5' })

    expect(entry).toEqual({
      npm: '@ai-sdk/openai-compatible',
      name: LOCAL_PROVIDER_NAME,
      options: { baseURL: CONTEXT.baseUrl, apiKey: CONTEXT.apiKey },
      models: { 'gpt-5': {} },
    })
  })
})

describe('resolveFieldValue', () => {
  const bare: ClientApplyRule = { roles: {}, ignored: [] }

  it('passes the context through for the direct roles', () => {
    expect(resolveFieldValue('baseUrl', CONTEXT, bare)).toBe(CONTEXT.baseUrl)
    expect(resolveFieldValue('apiKey', CONTEXT, bare)).toBe(CONTEXT.apiKey)
    expect(resolveFieldValue('provider', CONTEXT, bare)).toBe(LOCAL_PROVIDER_ID)
    expect(resolveFieldValue('flagTrue', CONTEXT, bare)).toBe(true)
  })

  it('rounds an empty small model down to the prefix, leaving the caller to skip it', () => {
    // 空值的处置交给 `service.ts`（没填就不写这个键），这里只负责按规则拼字符串。
    expect(resolveFieldValue('smallModel', { ...CONTEXT, smallModel: '' }, bare)).toBe('')
  })

  it('prefixes a model only when the client asks for it', () => {
    const opencode = getClientApplyRule('opencode')!

    expect(resolveFieldValue('model', CONTEXT, bare)).toBe('osw-model')
    expect(resolveFieldValue('model', CONTEXT, opencode)).toBe('osw/osw-model')
    expect(resolveFieldValue('smallModel', CONTEXT, opencode)).toBe('osw/osw-small')
  })

  it('writes nothing for the roles carried by another path', () => {
    // `providerTable` / `provider` 这类角色由 providerEntry 的表项路径承载，自身不写值。
    expect(resolveFieldValue('providerEntry', CONTEXT, bare)).toBeNull()
  })
})

describe('stripModelPrefix', () => {
  const bare: ClientApplyRule = { roles: {}, ignored: [] }
  const opencode = getClientApplyRule('opencode')!

  it('removes the prefix the recipe itself would add', () => {
    // 一键生效会「读回文件里已经写好的模型名再写一遍」，不去前缀就会变成 osw/osw/xxx。
    expect(stripModelPrefix(opencode, 'osw/osw-model')).toBe('osw-model')
  })

  it('leaves a value without the prefix alone', () => {
    expect(stripModelPrefix(opencode, 'osw-model')).toBe('osw-model')
    // 前缀只在开头算数：中间带斜杠的模型名（如 `anthropic/claude`）不能被误伤。
    expect(stripModelPrefix(opencode, 'anthropic/claude')).toBe('anthropic/claude')
  })

  it('does nothing for recipes without a prefix', () => {
    expect(stripModelPrefix(bare, 'osw/osw-model')).toBe('osw/osw-model')
  })
})
