import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_CLIENT_DEFINITIONS, AGENT_CLIENT_DEFINITION_BY_KEY, LOCAL_PROVIDER_NAME } from '@common/clients'
import { createAppTranslator } from '@common/i18n/catalogs'
import type { AppError } from '../errors'
import { closeDatabases, initDatabases } from '../database'
import { hashClientConfigContent } from '../database/client-config-version-store'
import { updateSettings } from '../database/settings-store'
import {
  applyClientConfigDefaults,
  applyClientConfigOverrides,
  listClientConfigFileVersions,
  listClientConfigOverview,
  previewClientConfigOverrides,
  readClientConfigFile,
  readClientConfigVersion,
  resolveClientConfigTarget,
  restoreClientConfigVersion,
  saveClientConfigContent,
} from './service'
import { declaredPathForPlatform } from './paths'
import { defaultShellProfileCandidates } from './shell'

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
const CODEX_AUTH_FILE = '~/.codex/auth.json'
const OPENCODE_FILE = '~/.config/opencode/opencode.json'
const PI_SETTINGS_FILE = '~/.pi/agent/settings.json'
const PI_MODELS_FILE = '~/.pi/agent/models.json'
const DSH_FILE = 'deepseek-harness'
const DSH_SETTINGS_FILE = '~/.dsh/settings.yaml'
const COPILOT = 'copilot-cli'
const COPILOT_ENV_FILE = '~/.copilot/osw.env'
const VSCODE = 'vscode'
/**
 * 身份是注册表里的 `files[].path`（VS Code 写的是 macOS 那一份），**不是**当前平台展开后的落点：
 * 调用方给的永远是前者，落点由服务端按平台展开（`declaredPathForPlatform`）。若这里按当前平台推导身份，
 * 就只有 macOS 对得上——CI 的 ubuntu 会因路径与注册表不符被拒（`CLIENT_CONFIG_PATH_NOT_ALLOWED`）。
 */
const VSCODE_FILE = AGENT_CLIENT_DEFINITION_BY_KEY[VSCODE]!.files[0]!.path
/** 按当前平台展开后的真实落点，仅用于测试自己读写磁盘；服务端写入的就是这个路径。 */
const VSCODE_RESOLVED_FILE = declaredPathForPlatform(AGENT_CLIENT_DEFINITION_BY_KEY[VSCODE]!.files[0]!, process.platform)

/**
 * 注册表里声明了「目录可被环境变量改道」的变量名（OpenCode 的 XDG、DeepSeek Harness 的 DSH_HOME）。
 *
 * 这些变量在 CI 上是**预设好的**——GitHub Actions 的 ubuntu runner 就带着 `XDG_CONFIG_HOME`——
 * 于是 `resolveClientConfigPath` 会把文件指到临时主目录之外：写入落到真实用户目录里，
 * 用例自己的 `fullPath()` 却还在临时目录里找，于是报「文件不存在」；更糟的是那份残留会跨用例
 * 存活，下一个用例读到上一个用例写下的值，算出「无需改动」。本机没配这些变量时一切正常，
 * 所以这是一个只在 CI 上复现的失败。
 *
 * 从注册表推导而不是手抄变量名：以后新增带 `envVar` 的客户端会自动被覆盖。
 */
const ENV_OVERRIDE_NAMES = [
  ...new Set(AGENT_CLIENT_DEFINITIONS.flatMap(client => client.files.flatMap(file => (file.envVar ? [file.envVar.name] : [])))),
]

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

/**
 * `load` 文件的启动文件落点：候选里的第一个（`resolveShellProfilePath` 在候选都不存在时的兜底）。
 *
 * 候选顺序跟着 `$SHELL` 走——CI 的 ubuntu runner 用 bash，第一候选是 `.bash_profile` 而不是 `.zshrc`。
 * 从 `defaultShellProfileCandidates()` 现取，保证与生产代码选中的是同一个文件，而不是把 `.zshrc` 写死。
 */
function firstShellProfilePath(): string {
  const [first] = defaultShellProfileCandidates()
  return first!.replace(`${mocks.home}/`, '~/')
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

/**
 * 调用方唯一能决定的事：模型名。
 *
 * 地址与密钥不在入参里——它们由服务端按本机监听设置（这里默认是 `127.0.0.1:9300`）
 * 与固定样例密钥自己填。客户端要指向的就是本机服务本身，没有第二种正确答案。
 */
const MODEL = { model: 'osw-model' }

beforeEach(async () => {
  // 主目录说了算：把改道变量清空，写入才会落在本用例的临时目录里（见 `ENV_OVERRIDE_NAMES`）。
  for (const name of ENV_OVERRIDE_NAMES) vi.stubEnv(name, '')
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-client-config-'))
  mocks.home = temporaryDirectory
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  mocks.home = ''
  vi.unstubAllEnvs()
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

  it('identifies a multi-platform file by its declared path and expands it for the current platform', () => {
    // 注册表里声明的路径（VS Code 是 macOS 那一份）才是身份，按平台展开只影响 `resolvedPath`。
    // 曾经的 bug：身份也跟着平台走，于是只有 macOS 对得上，CI 的 ubuntu 被拒。
    const declared = AGENT_CLIENT_DEFINITION_BY_KEY[VSCODE]!.files[0]!
    const target = resolveClientConfigTarget(VSCODE, declared.path)

    expect(target.filePath).toBe(declared.path)
    expect(target.resolvedPath).toBe(fullPath(declaredPathForPlatform(declared, process.platform)))
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

  it('reports only the fields that live in the requested file', async () => {
    writeFile(CODEX_AUTH_FILE, JSON.stringify({ tokens: { access_token: 'x' } }))

    const state = await readClientConfigFile('codex', CODEX_AUTH_FILE)

    // `model`、`provider` 都在 config.toml 上；凭证文件本身没有一个可改写的设置项。
    expect(state.detected).toEqual({})
    expect(state.autoFill).toBe('ready')
  })

  it('reports an unparsable file instead of throwing', async () => {
    writeFile(CLAUDE_FILE, '{"model":')

    const state = await readClientConfigFile(CLAUDE, CLAUDE_FILE)

    expect(state.autoFill).toBe('unparsable')
    expect(state.detected).toEqual({})
    // 内容照旧回给界面：用户要靠它手动修好自己写坏的文件。
    expect(state.content).toBe('{"model":')
  })

  it('refuses a disallowed path', async () => {
    await expect(readClientConfigFile(CLAUDE, '~/.ssh/id_rsa')).rejects.toMatchObject({ code: 'CLIENT_CONFIG_PATH_NOT_ALLOWED' })
  })

  it('surfaces a read error that is not simply a missing file', async () => {
    // 只有 `ENOENT` 是「还没建」；这里目录占着这个路径，读它得到的是 EISDIR。
    // 把它当成空文件会把「读不了」静悄悄地说成「没有」，界面会给用户一个错的下一步。
    fs.mkdirSync(fullPath(CLAUDE_FILE), { recursive: true })

    await expect(readClientConfigFile(CLAUDE, CLAUDE_FILE)).rejects.toMatchObject({ code: 'EISDIR' })
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

    const versions = await listClientConfigFileVersions(CLAUDE, CLAUDE_FILE)
    expect(versions.map(version => version.preview)).toEqual(['{"a":1}'])
    // 摘要要交代「回退到这一版会让哪个值变成什么」：当前是 2，这一版是 1。
    expect(versions[0]!.diff).toEqual([{ before: 'a: 2', after: 'a: 1' }])
  })

  it('does not grow the history when the same content is committed again', async () => {
    await saveClientConfigContent(CLAUDE, CLAUDE_FILE, '{"a":1}')
    // 第一次：把改动前（空文件）视为无可备份，登记下当前的 '{"a":1}'。
    const first = await saveClientConfigContent(CLAUDE, CLAUDE_FILE, '{"a":1}')
    const again = await saveClientConfigContent(CLAUDE, CLAUDE_FILE, '{"a":1}')

    expect(first.backedUp).toMatchObject({ preview: '{"a":1}' })
    // 同一份内容只存一次：反复点提交，历史里也只有一条。
    expect(again.backedUp).toBeNull()
    expect(await listClientConfigFileVersions(CLAUDE, CLAUDE_FILE)).toHaveLength(1)
  })

  it('reports a write the filesystem refused instead of pretending it worked', async () => {
    // 备份已经登记、临时文件却写不下去（目录只读）：这个错误必须抛出来。
    // 吞掉它会让界面显示「已保存」而磁盘上什么也没变。
    const directory = path.dirname(fullPath(CLAUDE_FILE))
    fs.mkdirSync(directory, { recursive: true })
    fs.chmodSync(directory, 0o500)
    try {
      await expect(saveClientConfigContent(CLAUDE, CLAUDE_FILE, '{"a":1}')).rejects.toMatchObject({
        code: 'CLIENT_CONFIG_WRITE_FAILED',
        statusCode: 500,
      })
      expect(fs.existsSync(fullPath(CLAUDE_FILE))).toBe(false)
    } finally {
      fs.chmodSync(directory, 0o700)
    }
  })
})

describe('applyClientConfigOverrides', () => {
  it('points a fresh claude-code config at the local service', async () => {
    const result = await applyClientConfigOverrides(CLAUDE, CLAUDE_FILE, MODEL)

    expect(JSON.parse(readFile(CLAUDE_FILE))).toEqual({
      model: 'osw-model',
      env: {
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:9300',
        ANTHROPIC_AUTH_TOKEN: 'sk-osw',
        ANTHROPIC_MODEL: 'osw-model',
        // 没填小模型就回落主模型：空串会被客户端当成「没有模型」。
        ANTHROPIC_SMALL_FAST_MODEL: 'osw-model',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'osw-model',
        ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: 'osw-model',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'osw-model',
        ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: 'osw-model',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'osw-model',
        ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: 'osw-model',
        ANTHROPIC_DEFAULT_FABLE_MODEL: 'osw-model',
        ANTHROPIC_DEFAULT_FABLE_MODEL_NAME: 'osw-model',
        // 子代理也走本地：漏一个就会有一部分请求绕回去找真实上游。
        CLAUDE_CODE_SUBAGENT_MODEL: 'osw-model',
      },
    })
    expect(result.state.autoFill).toBe('ready')
    expect(result.changes).toHaveLength(14)
    expect(result.changes[0]).toEqual({ path: 'model', before: null, after: 'osw-model' })
  })

  it('keeps a separate small model when one is given', async () => {
    await applyClientConfigOverrides(CLAUDE, CLAUDE_FILE, { ...MODEL, smallModel: 'osw-small' })

    expect(JSON.parse(readFile(CLAUDE_FILE)).env.ANTHROPIC_SMALL_FAST_MODEL).toBe('osw-small')
  })

  it('rewrites the model labels alongside the aliases', async () => {
    // 用户文件里往往已经有一组 `*_MODEL_NAME`（有些工具/教程会写）。它们是 `/model` 选择器里的
    // 展示名，如果只改别名不改它，用户切了模型却看到选择器还显示老模型，会以为切换没生效。
    writeFile(CLAUDE_FILE, JSON.stringify({
      env: {
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'default',
        ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: 'anthropic/claude-4.8-opus',
      },
    }))

    const result = await applyClientConfigOverrides(CLAUDE, CLAUDE_FILE, MODEL)
    const env = JSON.parse(readFile(CLAUDE_FILE)).env

    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('osw-model')
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME).toBe('osw-model')
    expect(result.changes).toContainEqual({ path: 'env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME', before: 'anthropic/claude-4.8-opus', after: 'osw-model' })
  })

  it('reports what each key looked like before', async () => {
    writeFile(CLAUDE_FILE, JSON.stringify({ model: 'opus', permissions: { allow: ['Read'] } }))

    const result = await applyClientConfigOverrides(CLAUDE, CLAUDE_FILE, MODEL)

    expect(result.backedUp).not.toBeNull()
    expect(result.changes).toContainEqual({ path: 'model', before: 'opus', after: 'osw-model' })
    // 地址不受调用方影响：它总是本机服务当前的监听地址。
    expect(result.changes).toContainEqual({ path: 'env.ANTHROPIC_BASE_URL', before: null, after: 'http://127.0.0.1:9300' })
    // 别人的键一个不动。
    expect(JSON.parse(readFile(CLAUDE_FILE)).permissions).toEqual({ allow: ['Read'] })
  })

  it('writes a codex provider table next to the existing one', async () => {
    writeFile(
      CODEX_FILE,
      ['model = "gpt-5"', 'model_provider = "openai"', 'model_reasoning_effort = "high"', '', '[model_providers.openai]', 'name = "OpenAI"', 'base_url = "https://api.openai.com/v1"', ''].join('\n'),
    )

    const result = await applyClientConfigOverrides('codex', CODEX_FILE, MODEL)
    const content = readFile(CODEX_FILE)

    expect(content).toContain('model = "osw-model"')
    expect(content).toContain('model_provider = "osw"')
    expect(content).toContain('[model_providers.openai]')
    expect(content).toContain(`[model_providers.osw]\nname = "${LOCAL_PROVIDER_NAME}"\nbase_url = "http://127.0.0.1:9300"\nwire_api = "responses"`)
    // 推理档位是用户自己的取舍，配方里显式放过了。
    expect(content).toContain('model_reasoning_effort = "high"')
    expect(result.changes).toContainEqual({ path: 'model_providers.osw', before: null, after: expect.any(String) })
  })

  it('leaves a file that carries none of the fillable fields alone', async () => {
    // codex 的凭证文件也声明在这个客户端上，但 `model`、`provider` 都落在 config.toml：
    // 逐文件写入到这儿不该凭空造出一张 provider 表，也不该写任何别的键。
    writeFile(CODEX_AUTH_FILE, JSON.stringify({ tokens: { access_token: 'x' } }))

    const result = await applyClientConfigOverrides('codex', CODEX_AUTH_FILE, MODEL)

    expect(result.changes).toEqual([])
    expect(result.backedUp).toBeNull()
    expect(JSON.parse(readFile(CODEX_AUTH_FILE))).toEqual({ tokens: { access_token: 'x' } })
  })

  it('writes a cross-file client without losing the model the user already picked', async () => {
    // Pi 的模型名在 settings.json、provider 表项在 models.json：两份文件各写各的那一半。
    // 回读模型名必须在客户端的**全部文件**里找，否则写 models.json 那一次会把用户在
    // settings.json 里选好的模型悄悄换回兜底值。
    writeFile(PI_SETTINGS_FILE, JSON.stringify({ defaultModel: 'my-model' }))

    await applyClientConfigDefaults('pi')

    // provider 表项写进 models.json：baseUrl 带 `/v1`、models 是数组。
    expect(JSON.parse(readFile(PI_MODELS_FILE))).toEqual({
      providers: {
        osw: {
          name: LOCAL_PROVIDER_NAME,
          baseUrl: 'http://127.0.0.1:9300/v1',
          api: 'openai-completions',
          apiKey: 'sk-osw',
          models: [{ id: 'my-model', name: 'my-model' }],
        },
      },
    })

    // settings.json 指到本地 provider，且保住了用户自己填的模型名。
    const settings = JSON.parse(readFile(PI_SETTINGS_FILE)) as Record<string, unknown>
    expect(settings.defaultProvider).toBe('osw')
    expect(settings.defaultModel).toBe('my-model')
  })

  it('spells the opencode model with its provider prefix', async () => {
    await applyClientConfigOverrides('opencode', OPENCODE_FILE, { ...MODEL, smallModel: 'osw-small' })
    expect(JSON.parse(readFile(OPENCODE_FILE))).toEqual({
      model: 'osw/osw-model',
      small_model: 'osw/osw-small',
      provider: {
        osw: {
          npm: '@ai-sdk/openai-compatible',
          name: LOCAL_PROVIDER_NAME,
          options: { baseURL: 'http://127.0.0.1:9300', apiKey: 'sk-osw' },
          models: { 'osw-model': {} },
        },
      },
    })
  })

  it('refuses when the local service address is not usable', async () => {
    // 地址读不出来时宁可不写：一个拼不出来的地址会在客户端里变成一个语焉不详的报错。
    await updateSettings({ listenHost: '' })

    await expect(applyClientConfigOverrides(CLAUDE, CLAUDE_FILE, MODEL)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
    expect(fs.existsSync(fullPath(CLAUDE_FILE))).toBe(false)
  })

  it('delivers env-only settings through a sourced env file and injects a loader into the login shell', async () => {
    // Copilot CLI 的 BYOK 只读环境变量：能改的只有 shell。写入 env 文件之外，还要在登录启动文件里
    // 留一段哨兵区段去 `source` 它——否则文件写了也没人读。
    await updateSettings({ language: 'en' })
    await applyClientConfigOverrides(COPILOT, COPILOT_ENV_FILE, MODEL)

    // 1) env 文件带「由 OSW 生成」抬头，键值就是我们给的那些。
    const env = readFile(COPILOT_ENV_FILE)
    expect(env).toContain('# Generated by One Switch')
    expect(env).toContain('COPILOT_PROVIDER_BASE_URL=http://127.0.0.1:9300')
    expect(env).toContain('COPILOT_PROVIDER_API_KEY=sk-osw')
    expect(env).toContain('COPILOT_MODEL=osw-model')

    // 2) 登录启动文件里有一段指向该 env 文件的哨兵区段。测试的主目录是空临时目录，
    //    一个候选都不存在，于是落到第一候选（`firstShellProfilePath()`，通常是 `.zshrc`）。
    const profile = readFile(firstShellProfilePath())
    expect(profile).toContain('>>> osw managed env >>>')
    expect(profile).toContain(fullPath(COPILOT_ENV_FILE))
  })

  it('localizes the env file header to the configured language', async () => {
    // 抬头跟着界面语言走；换成中文后重写同一份文件，不该叠出两段抬头。
    await updateSettings({ language: 'zh-CN' })
    await applyClientConfigOverrides(COPILOT, COPILOT_ENV_FILE, MODEL)

    const env = readFile(COPILOT_ENV_FILE)
    expect(env).toContain(createAppTranslator('zh-CN')('clientConfig.envFile.header.title'))
    expect((env.match(/# 由 One Switch 生成/g) ?? []).length).toBe(1)
  })

  it('replaces the header in place when the language changes', async () => {
    await updateSettings({ language: 'en' })
    await applyClientConfigOverrides(COPILOT, COPILOT_ENV_FILE, MODEL)
    await updateSettings({ language: 'zh-CN' })
    await applyClientConfigDefaults(COPILOT)

    const env = readFile(COPILOT_ENV_FILE)
    // 换语言后只留一段当前语言的抬头，旧语言的抬头不残留。
    expect((env.match(/# 由 One Switch 生成/g) ?? []).length).toBe(1)
    expect(env).toContain('COPILOT_PROVIDER_BASE_URL=http://127.0.0.1:9300')
  })

  it('writes a vscode BYOK provider as one entry of the model list', async () => {
    const result = await applyClientConfigOverrides(VSCODE, VSCODE_FILE, MODEL)

    expect(result.state.autoFill).toBe('ready')
    expect(JSON.parse(readFile(VSCODE_RESOLVED_FILE))).toEqual([
      {
        name: LOCAL_PROVIDER_NAME,
        vendor: 'customendpoint',
        apiKey: 'sk-osw',
        apiType: 'chat-completions',
        models: [
          {
            id: 'osw-model',
            name: 'osw-model',
            url: 'http://127.0.0.1:9300/v1/chat/completions',
            toolCalling: true,
            vision: true,
            maxInputTokens: 128000,
            maxOutputTokens: 16000,
          },
        ],
      },
    ])
  })

  it('rewrites only the osw entry and leaves the user other providers alone', async () => {
    writeFile(
      VSCODE_RESOLVED_FILE,
      JSON.stringify([
        { name: 'Anthropic', vendor: 'customendpoint', apiKey: 'keep', models: [{ id: 'claude', name: 'Claude' }] },
        { name: LOCAL_PROVIDER_NAME, vendor: 'customendpoint', apiKey: 'old', models: [] },
      ]),
    )

    await applyClientConfigOverrides(VSCODE, VSCODE_FILE, MODEL)
    const entries = JSON.parse(readFile(VSCODE_RESOLVED_FILE)) as Array<Record<string, unknown>>

    // 别人的 provider 原封不动——条目数组形状下「只动目标键」就是这个意思。
    expect(entries[0]).toEqual({ name: 'Anthropic', vendor: 'customendpoint', apiKey: 'keep', models: [{ id: 'claude', name: 'Claude' }] })
    expect((entries[1] as { apiKey: string }).apiKey).toBe('sk-osw')
    expect(entries).toHaveLength(2)
  })

  it('is idempotent for a vscode provider list', async () => {
    await applyClientConfigDefaults(VSCODE)

    const [second] = await applyClientConfigDefaults(VSCODE)

    expect(second).toMatchObject({ status: 'unchanged', changeCount: 0 })
  })

  it('calls a vscode file that points at the local service applied', async () => {
    await applyClientConfigDefaults(VSCODE)

    expect(await overviewOf(VSCODE)).toMatchObject({ coverage: 'applied', pendingChanges: 0 })
  })

  it('rewrites the loader in place instead of stacking a second block', async () => {
    await applyClientConfigOverrides(COPILOT, COPILOT_ENV_FILE, MODEL)
    await applyClientConfigDefaults(COPILOT)

    const profile = readFile(firstShellProfilePath())
    // 恰好一段：重复应用只改这一段，不追加第二段。
    expect(profile.split('>>> osw managed env >>>').length - 1).toBe(1)
  })

  it('prefers an existing shell profile over creating a new one', async () => {
    // 用户实际在用的是 `.bash_profile`：就改它，别另外造一个 `.zshrc`。
    writeFile('~/.bash_profile', 'export PATH="$HOME/bin:$PATH"\n')

    await applyClientConfigDefaults(COPILOT)

    const profile = readFile('~/.bash_profile')
    expect(profile).toContain('export PATH="$HOME/bin:$PATH"')
    expect(profile).toContain('>>> osw managed env >>>')
    expect(fs.existsSync(fullPath('~/.zshrc'))).toBe(false)
  })

  it('refuses to overwrite a file it cannot parse', async () => {
    writeFile(CLAUDE_FILE, '{"model":')

    await expect(applyClientConfigOverrides(CLAUDE, CLAUDE_FILE, MODEL)).rejects.toMatchObject({ code: 'CLIENT_CONFIG_PARSE_FAILED' })
    // 没有解析成功就不能动文件，也不该留下一个「改动前」的版本。
    expect(readFile(CLAUDE_FILE)).toBe('{"model":')
    expect(await listClientConfigFileVersions(CLAUDE, CLAUDE_FILE)).toEqual([])
  })
})

describe('previewClientConfigOverrides', () => {
  it('shows the file that apply would write, without writing it', async () => {
    writeFile(CLAUDE_FILE, JSON.stringify({ model: 'opus' }))

    const preview = await previewClientConfigOverrides(CLAUDE, CLAUDE_FILE, MODEL)

    expect(JSON.parse(preview.content)).toMatchObject({ model: 'osw-model', env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9300' } })
    expect(preview.changes).toContainEqual({ path: 'model', before: 'opus', after: 'osw-model' })
    // 预览不落盘、不产生版本：它只看，不动。
    expect(readFile(CLAUDE_FILE)).toBe(JSON.stringify({ model: 'opus' }))
    expect(await listClientConfigFileVersions(CLAUDE, CLAUDE_FILE)).toEqual([])
  })

  it('lists exactly the changes that the real apply then performs', async () => {
    writeFile(CLAUDE_FILE, JSON.stringify({ model: 'opus' }))

    const preview = await previewClientConfigOverrides(CLAUDE, CLAUDE_FILE, MODEL)
    const applied = await applyClientConfigOverrides(CLAUDE, CLAUDE_FILE, MODEL)

    // 预览与落盘必须出自同一份规划：两处各算一遍，界面说「会改 3 处」而按钮只改 2 处。
    expect(applied.changes).toEqual(preview.changes)
    expect(readFile(CLAUDE_FILE)).toBe(preview.content)
  })

  it('plans a file that does not exist yet without creating it', async () => {
    const preview = await previewClientConfigOverrides(CLAUDE, CLAUDE_FILE, MODEL)

    expect(preview.changes.length).toBeGreaterThan(0)
    expect(fs.existsSync(fullPath(CLAUDE_FILE))).toBe(false)
  })

  it('is empty once the file already points at the local service', async () => {
    await applyClientConfigOverrides(CLAUDE, CLAUDE_FILE, MODEL)

    const preview = await previewClientConfigOverrides(CLAUDE, CLAUDE_FILE, MODEL)

    // 列表页的「已生效」就是这个空数组。
    expect(preview.changes).toEqual([])
  })
})

describe('history', () => {
  it('restores an earlier version and keeps the one it replaced', async () => {
    await saveClientConfigContent(CLAUDE, CLAUDE_FILE, '{"a":1}')
    await saveClientConfigContent(CLAUDE, CLAUDE_FILE, '{"a":2}')
    const [earlier] = await listClientConfigFileVersions(CLAUDE, CLAUDE_FILE)

    expect(readClientConfigVersion(earlier!.id)!.content).toBe('{"a":1}')

    const result = await restoreClientConfigVersion(CLAUDE, CLAUDE_FILE, earlier!.id)

    expect(readFile(CLAUDE_FILE)).toBe('{"a":1}')
    expect(result.backedUp).toMatchObject({ preview: '{"a":2}', origin: 'restore' })
    expect((await listClientConfigFileVersions(CLAUDE, CLAUDE_FILE)).map(version => version.preview).sort()).toEqual(['{"a":1}', '{"a":2}'])
  })

  it('refuses an unknown version', async () => {
    await expect(restoreClientConfigVersion(CLAUDE, CLAUDE_FILE, 'ccv_nope')).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 })
  })

  it('refuses a version that belongs to another file', async () => {
    // 备份的是**改动前**的内容，所以同一个文件要存两次才会留下第一个版本。
    await saveClientConfigContent(CLAUDE, '~/.claude/.credentials.json', '{"a":1}')
    await saveClientConfigContent(CLAUDE, '~/.claude/.credentials.json', '{"a":2}')
    const [stored] = await listClientConfigFileVersions(CLAUDE, '~/.claude/.credentials.json')

    await expect(restoreClientConfigVersion(CLAUDE, CLAUDE_FILE, stored!.id)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('refuses a disallowed path', async () => {
    // 白名单先于读文件生效：拒掉的路径不会被读、更不会被写。
    await expect(listClientConfigFileVersions(CLAUDE, '~/.ssh/id_rsa')).rejects.toMatchObject({ code: 'CLIENT_CONFIG_PATH_NOT_ALLOWED' })
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

  it('calls a file whose own syntax is broken unavailable', async () => {
    // 解析不了就不是「差几处改动」，而是要用户先动手修语法。状态必须区分这两件事，
    // 否则界面会给出一个治不了病的「一键生效」按钮。
    writeFile(CLAUDE_FILE, '{"model":')

    expect(await overviewOf(CLAUDE)).toMatchObject({ coverage: 'unavailable', pendingChanges: 0 })
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

  it('reuses the model a codex config already names', async () => {    writeFile(CODEX_FILE, 'model = "gpt-5"\n')

    const [codex] = await applyClientConfigDefaults('codex')

    // 模型名以文件里已有的为准；codex 没有小模型这一档，读它时找不到对应字段，
    // 那既不是报错也不该把模型写成兜底值。
    expect(codex).toMatchObject({ status: 'applied' })
    const content = readFile(CODEX_FILE)
    expect(content).toContain('model = "gpt-5"')
    expect(content).toContain('[model_providers.osw]')
  })

  it('fills the harness runtime settings with a route and a default model', async () => {
    const [harness] = await applyClientConfigDefaults(DSH_FILE)

    expect(harness).toMatchObject({ clientKey: DSH_FILE, status: 'applied' })
    // 写的是运行期热加载的那份 settings.yaml，而不是只读的 config.yaml 图层。
    expect(harness!.filePaths).toContain(DSH_SETTINGS_FILE)

    const settings = parse(readFile(DSH_SETTINGS_FILE)) as {
      'agent-default-model'?: { provider?: string; model?: string }
      'llm-pi-ai'?: { providers?: Record<string, { baseURL?: string; models?: Array<{ id?: string }> }> }
    }

    // 新会话的默认路由指向本机服务提供方。
    expect(settings['agent-default-model']).toMatchObject({ provider: LOCAL_PROVIDER_NAME.toLowerCase() })
    // 手工声明的 provider 路由带上本机地址与 /v1，以及数组形态的模型清单。
    expect(settings['llm-pi-ai']?.providers?.osw?.baseURL).toContain('127.0.0.1:9300/v1')
    expect(settings['llm-pi-ai']?.providers?.osw?.models?.[0]).toMatchObject({ id: 'default' })
  })

  it('is idempotent for the harness too: a second run has nothing to write', async () => {
    await applyClientConfigDefaults(DSH_FILE)

    const [second] = await applyClientConfigDefaults(DSH_FILE)

    expect(second).toMatchObject({ clientKey: DSH_FILE, status: 'unchanged', changeCount: 0 })
  })

  it('refuses an unregistered client', async () => {
    await expect(applyClientConfigDefaults('nope')).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 })
  })

  it('reports the file it could not fill instead of failing the whole run', async () => {
    writeFile(CLAUDE_FILE, '{"model":')

    const [claude] = await applyClientConfigDefaults(CLAUDE)

    // 一个文件坏了不影响其余客户端继续生效；但这一条必须把失败说出来，
    // 而不是报成「没有改动」——那是两种完全不同的下一步。
    expect(claude).toMatchObject({ clientKey: CLAUDE, status: 'failed', changeCount: 0, filePaths: [] })
    expect(claude!.message).toContain(CLAUDE_FILE)
    expect(readFile(CLAUDE_FILE)).toBe('{"model":')
  })

  it('touches every registered client when no key is given', async () => {
    const items = await applyClientConfigDefaults()

    expect(items.map(item => item.clientKey)).toEqual(AGENT_CLIENT_DEFINITIONS.map(client => client.key))
    // 注册表里每个客户端都有配方，所以「全部生效」不会跳过任何一个。
    expect(items.filter(item => item.status === 'applied').map(item => item.clientKey)).toEqual(['claude-code', 'codex', 'vscode', 'opencode', 'copilot-cli', 'pi', 'deepseek-harness'])
    expect(items.filter(item => item.status === 'skipped')).toEqual([])
  })
})
