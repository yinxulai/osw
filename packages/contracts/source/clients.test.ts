import { describe, expect, it } from 'vitest'
import {
  AGENT_CLIENT_DEFINITIONS,
  AGENT_CLIENT_DEFINITION_BY_KEY,
  agentClientFieldFile,
  agentClientFieldsOfFile,
  findAgentClient,
  findAgentClientFile,
  isKnownAgentClient,
} from './clients'

/**
 * 客户端注册表的数据约束。
 *
 * 这张表同时决定两件事：界面里列什么、以及管理服务端**允许写哪些文件**。所以断言的重心在
 * 路径形状上——`~/` 前缀、`fields[].file` 必须指到本客户端真实声明过的文件（写错一条就等于
 * 凭空多出一个越界写入的目标）。图标与「注册表 → 目录」的对应关系属于控制台表示层，
 * 由 `packages/console/source/catalog/clients/agent-clients.test.ts` 断言。
 */

const CONFIG_FORMATS = ['json', 'jsonc', 'toml', 'yaml', 'env']
const PROTOCOLS = ['anthropic-messages', 'openai-responses', 'openai-completions', 'gemini']

describe('agent client registry', () => {
  it('lists at least one client', () => {
    expect(AGENT_CLIENT_DEFINITIONS.length).toBeGreaterThan(0)
  })

  it('indexes each client under the key it declares', () => {
    for (const client of AGENT_CLIENT_DEFINITIONS) {
      expect(AGENT_CLIENT_DEFINITION_BY_KEY[client.key]).toBe(client)
    }
    expect(Object.keys(AGENT_CLIENT_DEFINITION_BY_KEY).length).toBe(AGENT_CLIENT_DEFINITIONS.length)
  })

  it('gives every client its own key and its own weight', () => {
    const keys = AGENT_CLIENT_DEFINITIONS.map(client => client.key)
    const orders = AGENT_CLIENT_DEFINITIONS.map(client => client.order)

    expect(new Set(keys).size).toBe(keys.length)
    // 权重是逐个手填的：重复值不会报错（排序会按 key 兜底），但那是漏改的痕迹。
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('orders clients by descending weight', () => {
    const orders = AGENT_CLIENT_DEFINITIONS.map(client => client.order)
    expect(orders).toEqual([...orders].sort((left, right) => right - left))
  })

  it('describes every client', () => {
    for (const client of AGENT_CLIENT_DEFINITIONS) {
      expect(client.name.trim().length).toBeGreaterThan(0)
      expect(client.description.trim().length).toBeGreaterThan(0)
      expect(client.key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })

  it('only declares protocols we know how to convert', () => {
    for (const client of AGENT_CLIENT_DEFINITIONS) {
      if (client.protocol) expect(PROTOCOLS).toContain(client.protocol)
    }
  })

  it('gives every https website a bare origin', () => {
    // 有的客户端（Pi、DeepSeek Harness）没有可引用的官网，允许缺省。
    for (const client of AGENT_CLIENT_DEFINITIONS) {
      if (client.websiteUrl) expect(client.websiteUrl).toMatch(/^https:\/\/[^/]+\.[^/]+/)
    }
  })

  it('keeps every alias lowercase, unique and distinct from a key', () => {
    const seen = new Set<string>()
    const keys = new Set(AGENT_CLIENT_DEFINITIONS.map(client => client.key))

    for (const client of AGENT_CLIENT_DEFINITIONS) {
      for (const alias of client.aliases ?? []) {
        expect(alias).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
        // 别名撞上另一个客户端的 key，会让「按别名找客户端」这件事没有唯一答案。
        expect(keys.has(alias)).toBe(false)
        expect(seen.has(alias)).toBe(false)
        seen.add(alias)
      }
    }
  })

  it('puts the config directory and every config file under the home directory', () => {
    for (const client of AGENT_CLIENT_DEFINITIONS) {
      expect(client.configDir).toMatch(/^~\//)
      expect(client.configDir.endsWith('/')).toBe(false)
      expect(client.files.length).toBeGreaterThan(0)

      for (const file of client.files) {
        expect(file.path).toMatch(/^~\//)
        expect(file.path.endsWith('/')).toBe(false)
        expect(CONFIG_FORMATS).toContain(file.format)
        expect(file.purpose.trim().length).toBeGreaterThan(0)
      }

      // 主配置文件必须在 `configDir` 下；其余文件可以是别的目录（OpenCode 的凭证在 XDG 数据目录）。
      expect(client.files[0]!.path.startsWith(`${client.configDir}/`)).toBe(true)
    }
  })

  it('lists each config file once', () => {
    for (const client of AGENT_CLIENT_DEFINITIONS) {
      const paths = client.files.map(file => file.path)
      expect(new Set(paths).size).toBe(paths.length)
    }
  })

  it('describes each config field with an addressable path', () => {
    for (const client of AGENT_CLIENT_DEFINITIONS) {
      expect(client.fields.length).toBeGreaterThan(0)

      const keys = client.fields.map(field => field.key)
      expect(new Set(keys).size).toBe(keys.length)

      for (const field of client.fields) {
        expect(field.key.trim().length).toBeGreaterThan(0)
        expect(field.description.trim().length).toBeGreaterThan(0)
        // 点号分隔的键路径；`<id>` 是运行期才确定的一段。
        expect(field.path).toMatch(/^[^.\s]+(\.[^.\s]+)*$/)
      }
    }
  })

  it('only lets a field point at a file the client declares', () => {
    for (const client of AGENT_CLIENT_DEFINITIONS) {
      const paths = client.files.map(file => file.path)
      for (const field of client.fields) {
        if (field.file === undefined) continue
        expect(paths).toContain(field.file)
      }
    }
  })

  it('declares the owning file when a client spreads its fields across files', () => {
    // Gemini CLI 的模型在 settings.json、地址与密钥在 .env；不写 `file` 的话，
    // 改 `.env` 时会连带往它里面写 `model`，写出一个工具根本不读的键。
    const gemini = AGENT_CLIENT_DEFINITION_BY_KEY['gemini-cli']!
    const fromEnv = agentClientFieldsOfFile(gemini, '~/.gemini/.env').map(field => field.key)
    const fromSettings = agentClientFieldsOfFile(gemini, '~/.gemini/settings.json').map(field => field.key)

    expect(fromEnv.sort()).toEqual(['apiKey', 'baseUrl'])
    expect(fromSettings.sort()).toEqual(['auth', 'model'])
  })

  it('overrides a file directory only through a variable that covers its path', () => {
    for (const client of AGENT_CLIENT_DEFINITIONS) {
      for (const file of client.files) {
        if (!file.envVar) continue

        expect(file.envVar.name).toMatch(/^[A-Z][A-Z0-9_]*$/)
        expect(file.envVar.replaces).toMatch(/^~\//)
        expect(file.envVar.replaces.endsWith('/')).toBe(false)
        // `replaces` 是路径前缀而不是随便一段字符串：对不上时 `expandDeclaredPath` 会静默忽略它。
        expect(file.path.startsWith(`${file.envVar.replaces}/`)).toBe(true)
      }
    }
  })
})

describe('registry lookups', () => {
  it('finds a client by key', () => {
    expect(findAgentClient('claude-code')?.name).toBe('Claude Code')
    expect(findAgentClient('nope')).toBeUndefined()
  })

  it('finds a file only by the exact path the client declared', () => {
    expect(findAgentClientFile('codex', '~/.codex/config.toml')?.format).toBe('toml')
    expect(findAgentClientFile('codex', '~/.codex/nope.toml')).toBeUndefined()
    // 路径来自 A 客户端时不能在 B 客户端里命中，否则「可写文件」的集合会被拼出来。
    expect(findAgentClientFile('codex', '~/.claude/settings.json')).toBeUndefined()
    expect(findAgentClientFile('nope', '~/.codex/config.toml')).toBeUndefined()
  })

  it('answers whether a key is known without throwing', () => {
    expect(isKnownAgentClient('opencode')).toBe(true)
    expect(isKnownAgentClient('constructor')).toBe(false)
    expect(isKnownAgentClient('')).toBe(false)
  })

  it('falls back to the first file when a field does not name one', () => {
    const codex = AGENT_CLIENT_DEFINITION_BY_KEY['codex']!
    const model = codex.fields.find(field => field.key === 'model')!

    expect(agentClientFieldFile(codex, model)).toBe('~/.codex/config.toml')
  })

  it('lists the fields of a file', () => {
    const codex = AGENT_CLIENT_DEFINITION_BY_KEY['codex']!
    const keys = agentClientFieldsOfFile(codex, '~/.codex/config.toml').map(field => field.key)

    // auth.json 与 magpie-models.json 上没有可改写的设置项（凭证与模型目录都不由我们管）。
    expect(keys).toEqual(['model', 'provider', 'effort', 'catalog', 'providerTable'])
    expect(agentClientFieldsOfFile(codex, '~/.codex/auth.json')).toEqual([])
  })
})
