import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_CLIENT_DEFINITIONS, AGENT_CLIENT_DEFINITION_BY_KEY } from '@common/clients'
import type { AppError } from '../errors'
import { closeDatabases, initDatabases } from '../database'
import { hashClientConfigContent } from '../database/client-config-version-store'
import {
  applyClientConfigDefaults,
  applyClientConfigOverrides,
  listClientConfigFileVersions,
  listClientConfigOverview,
  readClientConfigFile,
  readClientConfigVersion,
  resolveClientConfigTarget,
  restoreClientConfigVersion,
  saveClientConfigContent,
} from './service'

/**
 * 客户端配置文件服务。
 *
 * 所有路径都通过 `homedir()` 展开，所以这里把它换成每个用例自己的临时目录——测试**不能**
 * 碰用户真实的 `~/.claude`。断言分三类：读到什么（回读的值）、写到什么（落盘的结果）、
 * 以及**拒绝什么**（越界路径 / 不支持自动填充的客户端 / 坏 URL）。
 */

const mocks = vi.hoisted(() => ({ home: '' }))

vi.mock('node:os', async importOriginal => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => mocks.home }
})

const CLAUDE = 'claude-code'
const CLAUDE_FILE = '~/.claude/settings.json'
const CODEX_FILE = '~/.codex/config.toml'
const GEMINI_FILE = '~/.gemini/settings.json'
const GEMINI_ENV_FILE = '~/.gemini/.env'
const OPENCODE_FILE = '~/.config/opencode/opencode.json'

let temporaryDirectory: string

function fullPath(declaredPath: string): string {
  return path.join(mocks.home, declaredPath.replace(/^~\//, ''))
}

function writeFile(declaredPath: string, content: string): void {
  const target = fullPath(declaredPath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content, 'utf8')
}

function readFile(declaredPath: string): string {
  return fs.readFileSync(fullPath(declaredPath), 'utf8')
}

/** 同步入口抛错时，把 `AppError` 的 code 取出来；这条路径本身不该走到返回值。 */
function syncErrorCode(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    return (error as AppError).code
  }
  return 'NO_ERROR'
}

const VALUES = { baseUrl: 'http://127.0.0.1:9300', apiKey: 'sk-osw', model: 'osw-model' }

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-client-config-'))
  mocks.home = temporaryDirectory
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  mocks.home = ''
})

describe('resolveClientConfigTarget', () => {
  it('expands a declared pair under the current home directory', () => {
    expect(resolveClientConfigTarget(CLAUDE, CLAUDE_FILE)).toMatchObject({
      clientKey: CLAUDE,
      filePath: CLAUDE_FILE,
      resolvedPath: fullPath(CLAUDE_FILE),
    })
  })

  it('refuses a file the client never declared', () => {
    expect(syncErrorCode(() => resolveClientConfigTarget(CLAUDE, '~/.ssh/id_rsa'))).toBe('CLIENT_CONFIG_PATH_NOT_ALLOWED')
    expect(syncErrorCode(() => resolveClientConfigTarget('nope', CLAUDE_FILE))).toBe('CLIENT_CONFIG_PATH_NOT_ALLOWED')
  })
})

describe('readClientConfigFile', () => {
  it('reports a missing file without failing', async () => {
    const state = await readClientConfigFile(CLAUDE, CLAUDE_FILE)

    expect(state).toMatchObject({
      clientKey: CLAUDE,
      filePath: CLAUDE_FILE,
      format: 'json',
      exists: false,
      content: '',
      sizeBytes: 0,
      modifiedTime: null,
      autoFill: 'ready',
      detected: {},
    })
    expect(state.contentHash).toBe(hashClientConfigContent(''))
  })

  it('reads back and sizes an existing file', async () => {
    writeFile(CLAUDE_FILE, '{"a":"中"}')

    const state = await readClientConfigFile(CLAUDE, CLAUDE_FILE)

    expect(state.exists).toBe(true)
    // 中文按 UTF-8 的字节数算，不是字符数。
    expect(state.sizeBytes).toBe(Buffer.byteLength('{"a":"中"}', 'utf8'))
    expect(state.modifiedTime).toBeGreaterThan(0)
  })

  it('detects the scalar values the interface can show in an input', async () => {
    writeFile(
      CLAUDE_FILE,
      JSON.stringify({
        model: 'opus',
        env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com', ANTHROPIC_AUTH_TOKEN: 'sk-x', ANTHROPIC_MODEL: 'm' },
        permissions: { allow: ['Read'] },
      }),
    )

    const state = await readClientConfigFile(CLAUDE, CLAUDE_FILE)

    expect(state.autoFill).toBe('ready')
    // 对象（`permissions`）没有对应的输入框，回读出来也只是噪音。
    expect(state.detected).toEqual({
      model: 'opus',
      baseUrl: 'https://api.anthropic.com',
      authToken: 'sk-x',
      mainModel: 'm',
    })
  })

  it('only reports the fields that live in the requested file', async () => {
    writeFile(GEMINI_ENV_FILE, 'GOOGLE_GEMINI_BASE_URL=https://example.com\nGEMINI_API_KEY=sk-1\n')

    const state = await readClientConfigFile('gemini-cli', GEMINI_ENV_FILE)

    // `model` 与 `auth` 在 settings.json 里；往 .env 上回读它们只会读出空。
    expect(state.detected).toEqual({ baseUrl: 'https://example.com', apiKey: 'sk-1' })
  })

  it('reports an unparsable file instead of throwing', async () => {
    writeFile(CLAUDE_FILE, '{"model":')

    const state = await readClientConfigFile(CLAUDE, CLAUDE_FILE)

    expect(state.autoFill).toBe('unparsable')
    expect(state.detected).toEqual({})
    // 内容照旧回给界面：用户要靠它手动修好自己写坏的文件。
    expect(state.content).toBe('{"model":')
  })

  it('says so when there is no recipe for the client', async () => {
    // 没有配方时先报客户端维度：这类工具（Pi 的地址与凭证分在两个文件里；Copilot CLI、
    // Cursor CLI 只存模型名；DeepSeek Harness 是 YAML）连「该填什么」都无从谈起，
    // 格式能不能解析无关紧要。
    const files = {
      pi: '~/.pi/agent/settings.json',
      'copilot-cli': '~/.copilot/settings.json',
      'cursor-cli': '~/.cursor/cli-config.json',
      'deepseek-harness': '~/.dsh/config.yaml',
    }

    for (const [client, filePath] of Object.entries(files)) {
      const state = await readClientConfigFile(client, filePath)
      expect({ client, autoFill: state.autoFill }).toEqual({ client, autoFill: 'unsupported-client' })
    }
  })

  it('refuses a disallowed path', async () => {
    await expect(readClientConfigFile(CLAUDE, '~/.ssh/id_rsa')).rejects.toMatchObject({ code: 'CLIENT_CONFIG_PATH_NOT_ALLOWED' })
  })
})

describe('saveClientConfigContent', () => {
  it('writes the file and reports that nothing was backed up yet', async () => {
    const result = await saveClientConfigContent(CLAUDE, CLAUDE_FILE, '{"a":1}')

    // 之前没有文件，「备份」这件事无从发生（空内容不是版本）。
    expect(result.backedUp).toBeNull()
    expect(readFile(CLAUDE_FILE)).toBe('{"a":1}')
    expect(result.state).toMatchObject({ exists: true, content: '{"a":1}' })
  })

  it('backs up the previous content before overwriting it', async () => {
    await saveClientConfigContent(CLAUDE, CLAUDE_FILE, '{"a":1}')
    const result = await saveClientConfigContent(CLAUDE, CLAUDE_FILE, '{"a":2}', '改成 2')

    expect(result.backedUp).toMatchObject({ contentHash: hashClientConfigContent('{"a":1}'), preview: '{"a":1}', origin: 'manual', note: '改成 2' })
    expect(readFile(CLAUDE_FILE)).toBe('{"a":2}')

    const versions = listClientConfigFileVersions(CLAUDE, CLAUDE_FILE)
    expect(versions.map(version => version.preview)).toEqual(['{"a":1}'])
  })

  it('does not grow the history when the same content is committed again', async () => {
    await saveClientConfigContent(CLAUDE, CLAUDE_FILE, '{"a":1}')
    // 第一次：把改动前（空文件）视为无可备份，登记下当前的 '{"a":1}'。
    const first = await saveClientConfigContent(CLAUDE, CLAUDE_FILE, '{"a":1}')
    const again = await saveClientConfigContent(CLAUDE, CLAUDE_FILE, '{"a":1}')

    expect(first.backedUp).toMatchObject({ preview: '{"a":1}' })
    // 同一份内容只存一次：反复点提交，历史里也只有一条。
    expect(again.backedUp).toBeNull()
    expect(listClientConfigFileVersions(CLAUDE, CLAUDE_FILE)).toHaveLength(1)
  })
})

describe('applyClientConfigOverrides', () => {
  it('points a fresh claude-code config at the local service', async () => {
    const result = await applyClientConfigOverrides(CLAUDE, CLAUDE_FILE, VALUES)

    expect(JSON.parse(readFile(CLAUDE_FILE))).toEqual({
      model: 'osw-model',
      env: {
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:9300',
        ANTHROPIC_AUTH_TOKEN: 'sk-osw',
        ANTHROPIC_MODEL: 'osw-model',
        // 没填小模型就回落主模型：空串会被客户端当成「没有模型」。
        ANTHROPIC_SMALL_FAST_MODEL: 'osw-model',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'osw-model',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'osw-model',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'osw-model',
        ANTHROPIC_DEFAULT_FABLE_MODEL: 'osw-model',
      },
    })
    expect(result.state.autoFill).toBe('ready')
    expect(result.changes).toHaveLength(9)
    expect(result.changes[0]).toEqual({ path: 'model', before: null, after: 'osw-model' })
  })

  it('keeps a separate small model when one is given', async () => {
    await applyClientConfigOverrides(CLAUDE, CLAUDE_FILE, { ...VALUES, smallModel: 'osw-small' })

    expect(JSON.parse(readFile(CLAUDE_FILE)).env.ANTHROPIC_SMALL_FAST_MODEL).toBe('osw-small')
  })

  it('reports what each key looked like before', async () => {
    writeFile(CLAUDE_FILE, JSON.stringify({ model: 'opus', permissions: { allow: ['Read'] } }))

    const result = await applyClientConfigOverrides(CLAUDE, CLAUDE_FILE, VALUES)

    expect(result.backedUp).not.toBeNull()
    expect(result.changes).toContainEqual({ path: 'model', before: 'opus', after: 'osw-model' })
    expect(result.changes).toContainEqual({ path: 'env.ANTHROPIC_BASE_URL', before: null, after: VALUES.baseUrl })
    // 别人的键一个不动。
    expect(JSON.parse(readFile(CLAUDE_FILE)).permissions).toEqual({ allow: ['Read'] })
  })

  it('rewrites only the fields of the target file', async () => {
    const result = await applyClientConfigOverrides('gemini-cli', GEMINI_ENV_FILE, VALUES)

    expect(readFile(GEMINI_ENV_FILE)).toBe('GOOGLE_GEMINI_BASE_URL=http://127.0.0.1:9300\nGEMINI_API_KEY=sk-osw\n')
    // `model` 在 settings.json 里，不该被写进 .env。
    expect(result.changes.map(change => change.path).sort()).toEqual(['GEMINI_API_KEY', 'GOOGLE_GEMINI_BASE_URL'])
    expect(fs.existsSync(fullPath(GEMINI_FILE))).toBe(false)
  })

  it('leaves the untouched keys of the same file alone', async () => {
    writeFile(GEMINI_FILE, JSON.stringify({ security: { auth: { selectedType: 'gemini-api-key' } }, theme: 'dark' }))

    await applyClientConfigOverrides('gemini-cli', GEMINI_FILE, VALUES)

    expect(JSON.parse(readFile(GEMINI_FILE))).toEqual({
      security: { auth: { selectedType: 'gemini-api-key' } },
      theme: 'dark',
      model: { name: 'osw-model' },
    })
  })

  it('writes a codex provider table next to the existing one', async () => {
    writeFile(
      CODEX_FILE,
      ['model = "gpt-5"', 'model_provider = "openai"', 'model_reasoning_effort = "high"', '', '[model_providers.openai]', 'name = "OpenAI"', 'base_url = "https://api.openai.com/v1"', ''].join('\n'),
    )

    const result = await applyClientConfigOverrides('codex', CODEX_FILE, VALUES)
    const content = readFile(CODEX_FILE)

    expect(content).toContain('model = "osw-model"')
    expect(content).toContain('model_provider = "osw"')
    expect(content).toContain('[model_providers.openai]')
    expect(content).toContain('[model_providers.osw]\nname = "One Switch"\nbase_url = "http://127.0.0.1:9300"\nwire_api = "responses"')
    // 推理档位是用户自己的取舍，配方里显式放过了。
    expect(content).toContain('model_reasoning_effort = "high"')
    expect(result.changes).toContainEqual({ path: 'model_providers.osw', before: null, after: expect.any(String) })
  })

  it('spells the opencode model with its provider prefix', async () => {
    await applyClientConfigOverrides('opencode', OPENCODE_FILE, { ...VALUES, smallModel: 'osw-small' })

    expect(JSON.parse(readFile(OPENCODE_FILE))).toEqual({
      model: 'osw/osw-model',
      small_model: 'osw/osw-small',
      provider: {
        osw: {
          npm: '@ai-sdk/openai-compatible',
          name: 'One Switch',
          options: { baseURL: 'http://127.0.0.1:9300', apiKey: 'sk-osw' },
          models: { 'osw-model': {} },
        },
      },
    })
  })

  it('refuses a base URL that is not a full URL', async () => {
    await expect(applyClientConfigOverrides(CLAUDE, CLAUDE_FILE, { ...VALUES, baseUrl: 'localhost:9300' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
    expect(fs.existsSync(fullPath(CLAUDE_FILE))).toBe(false)
  })

  it('refuses a client without a recipe', async () => {
    await expect(applyClientConfigOverrides('pi', '~/.pi/agent/settings.json', VALUES)).rejects.toMatchObject({
      code: 'CLIENT_CONFIG_CLIENT_NOT_SUPPORTED',
    })
  })

  it('refuses to overwrite a file it cannot parse', async () => {
    writeFile(CLAUDE_FILE, '{"model":')

    await expect(applyClientConfigOverrides(CLAUDE, CLAUDE_FILE, VALUES)).rejects.toMatchObject({ code: 'CLIENT_CONFIG_PARSE_FAILED' })
    // 没有解析成功就不能动文件，也不该留下一个「改动前」的版本。
    expect(readFile(CLAUDE_FILE)).toBe('{"model":')
    expect(listClientConfigFileVersions(CLAUDE, CLAUDE_FILE)).toEqual([])
  })
})

describe('history', () => {
  it('restores an earlier version and keeps the one it replaced', async () => {
    await saveClientConfigContent(CLAUDE, CLAUDE_FILE, '{"a":1}')
    await saveClientConfigContent(CLAUDE, CLAUDE_FILE, '{"a":2}')
    const [earlier] = listClientConfigFileVersions(CLAUDE, CLAUDE_FILE)

    expect(readClientConfigVersion(earlier!.id)!.content).toBe('{"a":1}')

    const result = await restoreClientConfigVersion(CLAUDE, CLAUDE_FILE, earlier!.id)

    expect(readFile(CLAUDE_FILE)).toBe('{"a":1}')
    expect(result.backedUp).toMatchObject({ preview: '{"a":2}', origin: 'restore' })
    expect(listClientConfigFileVersions(CLAUDE, CLAUDE_FILE).map(version => version.preview).sort()).toEqual(['{"a":1}', '{"a":2}'])
  })

  it('refuses an unknown version', async () => {
    await expect(restoreClientConfigVersion(CLAUDE, CLAUDE_FILE, 'ccv_nope')).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 })
  })

  it('refuses a version that belongs to another file', async () => {
    // 备份的是**改动前**的内容，所以同一个文件要存两次才会留下第一个版本。
    await saveClientConfigContent(CLAUDE, '~/.claude/.credentials.json', '{"a":1}')
    await saveClientConfigContent(CLAUDE, '~/.claude/.credentials.json', '{"a":2}')
    const [stored] = listClientConfigFileVersions(CLAUDE, '~/.claude/.credentials.json')

    await expect(restoreClientConfigVersion(CLAUDE, CLAUDE_FILE, stored!.id)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('refuses a disallowed path', () => {
    expect(syncErrorCode(() => listClientConfigFileVersions(CLAUDE, '~/.ssh/id_rsa'))).toBe('CLIENT_CONFIG_PATH_NOT_ALLOWED')
  })

  it('returns null for an unknown version id', () => {
    expect(readClientConfigVersion('ccv_nope')).toBeNull()
  })
})

/** 列表行里的那个客户端。 */
async function overviewOf(clientKey: string) {
  const item = (await listClientConfigOverview()).find(entry => entry.clientKey === clientKey)
  if (!item) throw new Error(`no overview item for ${clientKey}`)
  return item
}

describe('listClientConfigOverview', () => {
  it('gives every registered client exactly one row, keyed on its primary file', async () => {
    const items = await listClientConfigOverview()

    expect(items.map(item => item.clientKey)).toEqual(AGENT_CLIENT_DEFINITIONS.map(client => client.key))
    for (const item of items) {
      expect(item.filePath).toBe(AGENT_CLIENT_DEFINITION_BY_KEY[item.clientKey]!.files[0]!.path)
    }
  })

  it('calls a not-yet-written file absent instead of implying a failure', async () => {
    // 「还没建」和「建了但要改」是两种下一步，空值也必须给全（界面用 `—` 占位，不换排版）。
    expect(await overviewOf(CLAUDE)).toMatchObject({
      coverage: 'absent',
      exists: false,
      modifiedTime: null,
      versionCount: 0,
      lastVersionTime: null,
    })
  })

  it('marks a client without a recipe as unavailable', async () => {
    expect(await overviewOf('pi')).toMatchObject({ coverage: 'unavailable', pendingChanges: 0 })
  })

  it('marks a file that already points at the local service as applied', async () => {
    await applyClientConfigDefaults(CLAUDE)

    expect(await overviewOf(CLAUDE)).toMatchObject({ coverage: 'applied', pendingChanges: 0, exists: true, versionCount: 0 })
  })

  it('counts the pending changes when the file points somewhere else', async () => {
    writeFile(CLAUDE_FILE, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' } }))

    const claude = await overviewOf(CLAUDE)

    expect(claude.coverage).toBe('pending')
    // 状态与「点一下会改几处」出自同一次 dry run，两者不能各说各话。
    expect(claude.pendingChanges).toBeGreaterThan(0)
  })

  it('counts the versions of a client across all of its files', async () => {
    writeFile(CLAUDE_FILE, '{"a":1}')
    await saveClientConfigContent(CLAUDE, CLAUDE_FILE, '{"a":2}')

    const claude = await overviewOf(CLAUDE)

    expect(claude.versionCount).toBe(1)
    expect(claude.lastVersionTime).not.toBeNull()
  })
})

describe('applyClientConfigDefaults', () => {
  it('points one client at the local service', async () => {
    const [claude] = await applyClientConfigDefaults(CLAUDE)

    expect(claude).toMatchObject({ clientKey: CLAUDE, status: 'applied', filePaths: [CLAUDE_FILE], message: '' })
    expect(claude!.changeCount).toBeGreaterThan(0)
    // 文件原本不存在，没有可备份的旧内容。
    expect(claude!.newVersions).toBe(0)
    expect(readFile(CLAUDE_FILE)).toContain('127.0.0.1:9300')
  })

  it('is idempotent: a second run has nothing to write', async () => {
    await applyClientConfigDefaults(CLAUDE)

    const [second] = await applyClientConfigDefaults(CLAUDE)

    expect(second).toMatchObject({ status: 'unchanged', changeCount: 0, newVersions: 0 })
  })

  it('keeps the model name the user picked, without doubling the prefix', async () => {
    writeFile(OPENCODE_FILE, JSON.stringify({ model: 'osw/my-model' }))
    await applyClientConfigDefaults('opencode')

    // 第二次会先把文件里的模型名读回来再写一遍；不去前缀就会变成 osw/osw/my-model。
    const [again] = await applyClientConfigDefaults('opencode')

    expect(again).toMatchObject({ status: 'unchanged', changeCount: 0 })
    expect(JSON.parse(readFile(OPENCODE_FILE))).toMatchObject({ model: 'osw/my-model' })
  })

  it('skips a client it has no recipe for, naming the client', async () => {
    const [pi] = await applyClientConfigDefaults('pi')

    expect(pi).toMatchObject({ clientKey: 'pi', status: 'skipped', filePaths: [], changeCount: 0 })
    expect(pi!.message).not.toBe('')
  })

  it('refuses an unregistered client', async () => {
    await expect(applyClientConfigDefaults('nope')).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 })
  })

  it('touches every fillable client when no key is given', async () => {
    const items = await applyClientConfigDefaults()

    expect(items.map(item => item.clientKey)).toEqual(AGENT_CLIENT_DEFINITIONS.map(client => client.key))
    expect(items.filter(item => item.status === 'applied').map(item => item.clientKey)).toEqual(['claude-code', 'codex', 'gemini-cli', 'opencode'])
    expect(items.filter(item => item.status === 'skipped').map(item => item.clientKey)).toEqual(['cursor-cli', 'copilot-cli', 'pi', 'deepseek-harness'])
  })
})
