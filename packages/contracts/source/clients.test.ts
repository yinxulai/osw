import { describe, expect, it } from 'vitest'
import {
  AGENT_CLIENT_DEFINITIONS,
  AGENT_CLIENT_DEFINITION_BY_KEY,
  agentClientFieldFile,
  agentClientFieldsOfFile,
  findAgentClient,
  findAgentClientFile,
  isKnownAgentClient,
  type AgentClientDefinition,
  type AgentClientFieldDefinition,
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
const PROTOCOLS = ['anthropic-messages', 'openai-responses', 'openai-completions']

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

  it('lists every auto-fillable client ahead of the ones that can only be hand-edited', () => {
    // 列表与选择器都照注册表顺序排：能自动写入的客户端排在前面，用户扫一眼先看到「点了就能用」的那几个，
    // 「只能手改」的沉到后面。这不是权重碰巧的结果，而是注册表要守住的一条次序。
    // 目前注册表里每个客户端都有配方（没有「只能手改」的），这条次序因此是空成立的——但规则照旧，
    // 以后再收一个没有地址字段的客户端时，它必须排到所有能自动写入的之后。
    const fillable = AGENT_CLIENT_DEFINITIONS.filter(client => client.apply !== undefined)
    const manual = AGENT_CLIENT_DEFINITIONS.filter(client => client.apply === undefined)

    expect(fillable.length).toBeGreaterThan(0)
    // 每个「只能手改」的都排在每个「能自动写入」的之后。
    for (const manualClient of manual) {
      for (const fillableClient of fillable) {
        expect(fillableClient.order).toBeGreaterThan(manualClient.order)
      }
    }
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

        // 平台专有路径同样要守在主目录下：它们只是换一条 `~/` 路径，不是开一条绝对路径的后门。
        for (const platformPath of Object.values(file.platformPaths ?? {})) {
          expect(platformPath).toMatch(/^~\//)
          expect(platformPath.endsWith('/')).toBe(false)
        }
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

  it('marks a shell-loaded file as env and nothing else', () => {
    // `load` 的文件由 OSW 维护、登录 shell 加载，所以只能是 `KEY=VALUE` 的 env 文件。
    // 别的格式挂上 `load` 没有加载机制可用，等于写了也不会生效。
    for (const client of AGENT_CLIENT_DEFINITIONS) {
      for (const file of client.files) {
        if (file.load === undefined) continue
        expect(file.load).toBe(true)
        expect(file.format).toBe('env')
      }
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

  it('declares a file storage shape the format editor can interpret', () => {
    for (const client of AGENT_CLIENT_DEFINITIONS) {
      for (const file of client.files) {
        const shape = file.shape
        if (shape === undefined) continue

        if (shape.kind === 'map') continue

        // 写名字的字段（`id` / `payload` / `idField`）缺省各有默认，写了就必须是能对上的非空标识符。
        if (shape.kind === 'entryList') {
          if (shape.idField === undefined) continue
          expect(shape.idField.trim().length).toBeGreaterThan(0)
          expect(shape.idField).not.toContain('.')
          continue
        }

        expect(shape.kind).toBe('patchList')
        for (const name of [shape.idField, shape.payloadField]) {
          if (name === undefined) continue
          expect(name.trim().length).toBeGreaterThan(0)
          expect(name).not.toContain('.')
        }
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

  it('honours the file a field names over the first file', () => {
    // 一份客户端的设置项分散在两个文件里时，`field.file` 就是唯一能说清归属的地方：
    // 认错了文件，回读会读到空、写入会往不读它的那个文件里塞键。
    const client = { key: 'x', name: 'X', order: 1, description: 'd', configDir: '~/.x', files: [{ path: '~/.x/a.json', format: 'json' }, { path: '~/.x/b.json', format: 'json' }], fields: [] } as unknown as AgentClientDefinition
    const field: AgentClientFieldDefinition = { key: 'k', path: 'k', file: '~/.x/b.json', description: 'd' }

    expect(agentClientFieldFile(client, field)).toBe('~/.x/b.json')
  })

  it('lists the fields of a file', () => {
    const codex = AGENT_CLIENT_DEFINITION_BY_KEY['codex']!
    const keys = agentClientFieldsOfFile(codex, '~/.codex/config.toml').map(field => field.key)

    // auth.json 上没有可改写的设置项（凭证不由我们管）。
    expect(keys).toEqual(['model', 'provider', 'effort', 'providerTable'])
    expect(agentClientFieldsOfFile(codex, '~/.codex/auth.json')).toEqual([])
  })
})
