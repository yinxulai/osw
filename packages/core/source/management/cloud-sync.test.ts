import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SecretStore } from '@common/secret-store'
import { CONFIG_SNAPSHOT_FILE_NAME, CONFIG_SNAPSHOT_FORMAT, CONFIG_SNAPSHOT_VERSION } from '@common/cloud-sync'
import type { ConfigSnapshot } from '@common/cloud-sync'
import { closeDatabases, initDatabases } from '../database'
import { normalizeError } from '../errors'
import { createLogicalModel, listLogicalModels, listSchedulingPolicies, reorderLogicalModels, upsertSchedulingPolicy } from '@server/database/logical-model-store'
import { createProviderModelRoute, listProviderModels } from '@server/database/model-store'
import { createProvider, listProviders } from '@server/database/provider-store'
import { getSettings } from '@server/database/settings-store'
import { configureSecretStore } from '@server/infrastructure/secrets/secret-store'
import { cloudBackupCredentialReference } from './cloud-sync/backends'
import { normalizeGistTarget } from './cloud-sync/backends/github-gist'
import { exportConfigSnapshot } from './cloud-sync/export-config-snapshot'
import { importConfigSnapshot } from './cloud-sync/import-config-snapshot'
import { configureCloudSync, pullConfigSnapshot, pushConfigSnapshot } from './cloud-sync/service'

/**
 * HTTP 出口整体替换成假实现：这里要验的是「拿到某个状态码之后我们怎么做」，
 * 不是 Node 的 HTTP 栈。真的打一次 GitHub 会让测试依赖网络与账号。
 */
const { requestHttpBuffered } = vi.hoisted(() => ({ requestHttpBuffered: vi.fn() }))

vi.mock('@server/infrastructure/network/core-network', () => ({
  coreNetworkClient: { requestHttpBuffered },
  createCoreNetworkClient: vi.fn(),
}))

const GIST_ID = 'a'.repeat(32)

let temporaryDirectory: string
let directories: string[]
let secrets: Map<string, string>

beforeEach(async () => {
  directories = []
  await restartWithEmptyDatabase()
  secrets = new Map()
  const store: SecretStore = {
    set: async (reference, value) => { secrets.set(reference, value) },
    get: async reference => secrets.get(reference) ?? null,
    delete: async reference => { secrets.delete(reference) },
  }
  configureSecretStore(store)
  requestHttpBuffered.mockReset()
})

afterEach(async () => {
  await closeDatabases()
  for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true })
})

/**
 * 关库、换一个空目录重开，用来模拟「另一台机器」。
 *
 * 不能原地 `initDatabases(同一个目录)`：磁盘上那些文件还在，那不是一台空机器，
 * 而断言「导入后变成这样」会因为本来就长这样而恒成立。
 */
async function restartWithEmptyDatabase(): Promise<void> {
  await closeDatabases()
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-cloud-sync-'))
  directories.push(temporaryDirectory)
  await initDatabases(temporaryDirectory)
}

function githubReply(statusCode: number, payload: unknown): { statusCode: number; headers: Record<string, string>; body: string } {
  return { statusCode, headers: {}, body: JSON.stringify(payload) }
}

type GithubHandler = (body: unknown) => { statusCode: number; headers: Record<string, string>; body: string }

/** 出站连接器被替换成假实现，这里只看它被怎么调用。 */
type RequestOptions = { method: string }

/**
 * 按 `METHOD /path` 路由一个假的 GitHub，并把请求体原样交给处理器。
 * 未登记的组合直接抛错：静默返回 404 会让「忘了打桩」伪装成一条业务分支。
 */
function mockGithub(routes: Record<string, GithubHandler>): void {
  requestHttpBuffered.mockImplementation(async (url: URL, options: RequestOptions, body: Buffer) => {
    const handler = routes[`${options.method} ${url.pathname}`]
    if (!handler) throw new Error(`unexpected GitHub request: ${options.method} ${url.pathname}`)
    return handler(JSON.parse(body.toString('utf8') || 'null'))
  })
}

function gistPayload(id = GIST_ID): Record<string, unknown> {
  return { id, html_url: `https://gist.github.com/${id}`, updated_at: '2026-09-01T00:00:00Z' }
}

/** 远端快照文件的样子：Gist 把它放在 `files[文件名].content` 里。 */
function gistHolding(content: string): Record<string, unknown> {
  return { ...gistPayload(), files: { [CONFIG_SNAPSHOT_FILE_NAME]: { content } } }
}

async function expectAppError(run: () => Promise<unknown>, code: string): Promise<void> {
  const error = await run().then(() => undefined, (value: unknown) => value)
  expect(normalizeError(error).code).toBe(code)
}

/** 造一台「有东西可搬」的机器：一个供应商、两个模型、两个逻辑模型、两条绑定。 */
async function seedLocalConfiguration(): Promise<void> {
  const provider = await createProvider({ name: 'OpenAI', apiKeyReference: 'key_ref', timeoutMilliseconds: 30_000 })
  const model = await createProviderModelRoute({ providerId: provider.id, modelName: 'gpt-4o', priority: 0 })
  const other = await createProviderModelRoute({ providerId: provider.id, modelName: 'gpt-4o-mini', priority: 1 })
  await createLogicalModel({ id: 'lm_heavy', name: 'Heavy', description: 'expensive things' })
  await reorderLogicalModels(['lm_heavy', 'default'])
  await upsertSchedulingPolicy({ logicalModelId: 'lm_heavy', providerModelId: other.id, priority: 3 })
  await upsertSchedulingPolicy({ logicalModelId: 'default', providerModelId: model.id, priority: 0 })
}

describe('config snapshot', () => {
  it('carries the api key as base64, never in the clear', async () => {
    await seedLocalConfiguration()
    secrets.set('key_ref', 'sk-super-secret')

    const { snapshot, content } = await exportConfigSnapshot()

    expect(snapshot.format).toBe(CONFIG_SNAPSHOT_FORMAT)
    expect(snapshot.version).toBe(CONFIG_SNAPSHOT_VERSION)
    // `providers` 保持脱敏，密钥单独走 `secrets`：同一个字段名在两种文档里表示两种东西迟早要出错。
    expect(snapshot.providers[0]).not.toHaveProperty('apiKey')
    expect(snapshot.secrets).toEqual([
      { providerName: 'OpenAI', value: Buffer.from('sk-super-secret', 'utf8').toString('base64') },
    ])
    // 这是编码不是加密：文件里看不到明文，但任何人都解得回来。别把它当成保护。
    expect(content).not.toContain('sk-super-secret')
    expect(Buffer.from(snapshot.secrets[0].value, 'base64').toString('utf8')).toBe('sk-super-secret')
  })

  it('writes the api key back onto a machine that never had one', async () => {
    await seedLocalConfiguration()
    secrets.set('key_ref', 'sk-super-secret')
    const { snapshot } = await exportConfigSnapshot()

    await restartWithEmptyDatabase()
    await importConfigSnapshot(snapshot)

    const [provider] = await listProviders()
    // 新机器上的供应商是新建的，密钥引用也是新的；密钥本身必须跟着快照过来。
    expect(provider.apiKeyReference).not.toBe('key_ref')
    expect(secrets.get(provider.apiKeyReference)).toBe('sk-super-secret')
  })

  it('leaves the local api key alone when the snapshot carries none', async () => {
    await seedLocalConfiguration()
    secrets.set('key_ref', 'sk-local-secret')
    const { snapshot } = await exportConfigSnapshot()

    // 旧版本推上来的快照没有 `secrets` 字段，不能因此把本机已经配好的密钥抹掉。
    await importConfigSnapshot({ ...snapshot, secrets: [] })

    const [provider] = await listProviders()
    expect(provider.apiKeyReference).toBe('key_ref')
    expect(secrets.get('key_ref')).toBe('sk-local-secret')
  })

  it('falls back to the local api key when a secret in the snapshot cannot be decoded', async () => {
    await seedLocalConfiguration()
    secrets.set('key_ref', 'sk-local-secret')
    const { snapshot } = await exportConfigSnapshot()

    // 一段乱码要退化成「这份快照没带这把密钥」，而不是把乱码写进密钥库——
    // 那要等到下一次请求才以一个看不懂的错误爆掉。
    await importConfigSnapshot({ ...snapshot, secrets: [{ providerName: 'OpenAI', value: 'not base64!' }] })

    expect(secrets.get('key_ref')).toBe('sk-local-secret')
  })

  it('round-trips providers, models, logical models and bindings into a fresh database', async () => {
    await seedLocalConfiguration()
    const { snapshot } = await exportConfigSnapshot()

    // 换一台机器：空目录重开，再用同一个文件拉回来。
    await restartWithEmptyDatabase()

    const result = await importConfigSnapshot(snapshot)

    expect(result.imported).toMatchObject({ providers: 1, models: 2, logicalModels: 2, bindings: 2 })
    expect((await listProviders()).map(provider => provider.name)).toEqual(['OpenAI'])
    expect((await listProviderModels()).map(model => model.modelName).sort()).toEqual(['gpt-4o', 'gpt-4o-mini'])
    expect((await listLogicalModels()).map(model => model.id)).toEqual(['lm_heavy', 'default'])
  })

  it('replaces the bindings of every logical model the snapshot mentions', async () => {
    await seedLocalConfiguration()
    const { snapshot } = await exportConfigSnapshot()
    await restartWithEmptyDatabase()

    await importConfigSnapshot(snapshot)

    const heavy = await listSchedulingPolicies('lm_heavy')
    expect(heavy).toHaveLength(1)
    expect(heavy[0]).toMatchObject({ priority: 3 })
  })

  it('drops bindings the snapshot no longer mentions, so removing a model from a queue survives the trip', async () => {
    await seedLocalConfiguration()
    const { snapshot } = await exportConfigSnapshot()
    const stripped: ConfigSnapshot = {
      ...snapshot,
      bindings: snapshot.bindings.filter(binding => binding.logicalModelId !== 'lm_heavy'),
    }
    await restartWithEmptyDatabase()

    await importConfigSnapshot(stripped)

    expect(await listSchedulingPolicies('lm_heavy')).toEqual([])
  })

  it('leaves logical models the snapshot never mentions alone', async () => {
    await seedLocalConfiguration()
    const { snapshot } = await exportConfigSnapshot()
    await restartWithEmptyDatabase()
    await createLogicalModel({ id: 'lm_local_only', name: 'Local only' })

    await importConfigSnapshot(snapshot)

    expect((await listLogicalModels()).map(model => model.id)).toContain('lm_local_only')
  })

  it('rejects a file that is not a snapshot with a validation error', async () => {
    await expectAppError(() => importConfigSnapshot({ hello: 'world' }), 'VALIDATION_ERROR')
  })
})

describe('gist target normalization', () => {
  it('accepts a bare id and any of its url forms', () => {
    expect(normalizeGistTarget(GIST_ID)).toBe(GIST_ID)
    expect(normalizeGistTarget(`https://gist.github.com/octocat/${GIST_ID}`)).toBe(GIST_ID)
    expect(normalizeGistTarget(`https://gist.github.com/${GIST_ID}#file-osw-config-json`)).toBe(GIST_ID)
    expect(normalizeGistTarget(`  ${GIST_ID}?plain=1  `)).toBe(GIST_ID)
  })

  it('treats an empty string as unbind and everything else as an error', async () => {
    expect(normalizeGistTarget('')).toBe('')
    await expectAppError(async () => normalizeGistTarget('https://example.com/not-a-gist'), 'VALIDATION_ERROR')
  })
})

describe('cloud sync service', () => {
  it('refuses to save a credential the storage does not accept', async () => {
    mockGithub({ 'GET /user': () => githubReply(401, { message: 'Bad credentials' }) })

    await expectAppError(() => configureCloudSync({ credential: 'ghp_bad' }), 'CLOUD_SYNC_AUTH_FAILED')
    // 失败的凭据不能落库，否则用户只会在第一次上传时才发现它不可用。
    expect(secrets.size).toBe(0)
  })

  it('saves the credential under the reference of its own storage, together with the account it belongs to', async () => {
    mockGithub({ 'GET /user': () => githubReply(200, { login: 'octocat' }) })

    await configureCloudSync({ credential: 'ghp_good' })

    // 按承载方式分开存：换回旧后端时那份凭据还得在。
    expect(secrets.get(cloudBackupCredentialReference('github-gist'))).toBe('ghp_good')
    expect(Array.from(secrets.keys())).toEqual(['cloud_backup_credential.github-gist'])
    expect((await getSettings()).cloudSyncAccountLabel).toBe('@octocat')
  })

  it('separates "the storage said no" from "the storage was not reachable"', async () => {
    requestHttpBuffered.mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.github.com'))

    // 复用 NETWORK_ERROR 会让界面提示「连不上本地服务」，把排查方向带偏。
    await expectAppError(() => configureCloudSync({ credential: 'ghp_any' }), 'CLOUD_SYNC_UNREACHABLE')
  })

  it('creates a secret gist on the first push and remembers its id', async () => {
    let createdBody: unknown
    mockGithub({
      'GET /user': () => githubReply(200, { login: 'octocat' }),
      'POST /gists': body => {
        createdBody = body
        return githubReply(201, gistPayload())
      },
    })
    await configureCloudSync({ credential: 'ghp_good' })
    await seedLocalConfiguration()

    const result = await pushConfigSnapshot()

    expect(result.createdTarget).toBe(true)
    expect(result.pushed).toMatchObject({ providers: 1, models: 2, logicalModels: 2, bindings: 2 })
    expect(result.status.target).toBe(GIST_ID)
    expect(result.status.targetUrl).toBe(`https://gist.github.com/${GIST_ID}`)
    const settings = await getSettings()
    expect(settings.cloudSyncTarget).toBe(GIST_ID)
    expect(settings.cloudSyncLastPushedTime).toBeGreaterThan(0)
    expect(createdBody).toMatchObject({ public: false })
    expect(JSON.stringify(createdBody)).toContain(CONFIG_SNAPSHOT_FILE_NAME)
  })

  it('lists the storages the client may choose from and marks the active one', async () => {
    const status = await configureCloudSync({ provider: 'github-gist' })

    expect(status.provider).toBe('github-gist')
    // 后端自述里给的是 key，界面自己去翻；这里只保证列表与当前项都存在。
    expect(status.providers.map(item => item.kind)).toEqual(['github-gist'])
    expect(status.providers[0].labelKey).toContain('githubGist')
  })

  it('keeps the binding when the same storage is selected again', async () => {
    mockGithub({ 'GET /user': () => githubReply(200, { login: 'octocat' }) })
    await configureCloudSync({ credential: 'ghp_good', target: GIST_ID })

    // 重复选中同一个后端不该被当成「换后端」，否则用户手滑一下绑定就没了。
    await configureCloudSync({ provider: 'github-gist' })

    expect((await getSettings()).cloudSyncTarget).toBe(GIST_ID)
  })

  it('pulls a snapshot another machine wrote and applies it here', async () => {
    await seedLocalConfiguration()
    const { content } = await exportConfigSnapshot()
    await restartWithEmptyDatabase()
    mockGithub({
      'GET /user': () => githubReply(200, { login: 'octocat' }),
      [`GET /gists/${GIST_ID}`]: () => githubReply(200, gistHolding(content)),
    })
    await configureCloudSync({ credential: 'ghp_good', target: GIST_ID })

    const result = await pullConfigSnapshot()

    expect(result.pulled).toMatchObject({ providers: 1, models: 2, logicalModels: 2, bindings: 2 })
    expect((await listProviders()).map(provider => provider.name)).toEqual(['OpenAI'])
    expect((await getSettings()).cloudSyncLastPulledTime).toBeGreaterThan(0)
  })

  it('reports a gist that has no snapshot file instead of importing nonsense', async () => {
    mockGithub({ 'GET /user': () => githubReply(200, { login: 'octocat' }) })
    await configureCloudSync({ credential: 'ghp_good', target: GIST_ID })
    mockGithub({ [`GET /gists/${GIST_ID}`]: () => githubReply(200, gistPayload()) })

    await expectAppError(() => pullConfigSnapshot(), 'CLOUD_SYNC_REMOTE_FILE_MISSING')
  })

  it('reports a remote file that is not valid JSON as a file problem, not as a missing one', async () => {
    mockGithub({
      'GET /user': () => githubReply(200, { login: 'octocat' }),
      [`GET /gists/${GIST_ID}`]: () => githubReply(200, gistHolding('{ not json at all')),
    })
    await configureCloudSync({ credential: 'ghp_good', target: GIST_ID })

    await expectAppError(() => pullConfigSnapshot(), 'CLOUD_SYNC_REMOTE_FILE_INVALID')
  })

  it('refuses to talk to the storage before a credential is saved', async () => {
    await expectAppError(() => pushConfigSnapshot(), 'CLOUD_SYNC_NOT_CONFIGURED')
  })
})
