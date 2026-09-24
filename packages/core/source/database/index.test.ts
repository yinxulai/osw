import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createDatabaseFileName, listCurrentDatabaseFileNames } from '@common/database-file'
import { closeDatabases, getConfigDb, getDataDb, initDatabases } from './index'
import { listProviderModelsForLogicalModel } from './model-store'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await closeDatabases()
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-db-'))
  temporaryDirectories.push(directory)
  return directory
}

function tableNames(client: DatabaseSync): string[] {
  return client
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map(row => (row as { name: string }).name)
}

function indexNames(client: DatabaseSync): string[] {
  return client
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
    .all()
    .map(row => (row as { name: string }).name)
}

function columnNames(client: DatabaseSync, table: string): string[] {
  return client
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map(row => (row as { name: string }).name)
}

function tableDefinition(client: DatabaseSync, table: string): string {
  const row = client.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
  if (!row) throw new Error(`missing table ${table}`)
  return (row as { sql: string }).sql
}

describe('database lifecycle', () => {
  it('refuses a handle before initialization', () => {
    expect(() => getConfigDb()).toThrow('Config database not initialized')
    expect(() => getDataDb()).toThrow('Data database not initialized')
  })

  it('opens both files on initialization and clears the handles on close', async () => {
    const directory = createTemporaryDirectory()
    await initDatabases(directory)

    expect(getConfigDb().$client.prepare('SELECT 1 AS value').get()).toEqual({ value: 1 })
    expect(getDataDb().$client.prepare('SELECT 1 AS value').get()).toEqual({ value: 1 })
    expect(fs.readdirSync(directory).filter(name => name.endsWith('.db')).sort()).toEqual([...listCurrentDatabaseFileNames()].sort())

    await closeDatabases()

    expect(() => getConfigDb()).toThrow('Config database not initialized')
    expect(() => getDataDb()).toThrow('Data database not initialized')
  })

  it('can be closed repeatedly', async () => {
    await initDatabases(createTemporaryDirectory())

    await closeDatabases()

    await expect(closeDatabases()).resolves.toBeUndefined()
  })

  // 重复初始化是幂等的：换掉已有句柄只会让调用方手里的引用变成孤儿，还会多出一个
  // 写连接去抢同一个 `-wal`。
  it('skips a redundant initialization instead of reopening', async () => {
    const directory = createTemporaryDirectory()
    await initDatabases(directory)
    const handle = getConfigDb()

    await initDatabases(directory)

    expect(getConfigDb()).toBe(handle)
  })

  it('reopens the same directory after a close', async () => {
    const directory = createTemporaryDirectory()
    await initDatabases(directory)
    const time = Date.now()
    getConfigDb()
      .$client.prepare('INSERT INTO providers (id, name, createdTime, updatedTime) VALUES (?, ?, ?, ?)')
      .run('prov_persisted', 'Persisted', time, time)

    await closeDatabases()
    await initDatabases(directory)

    expect(getConfigDb().$client.prepare('SELECT id FROM providers').all()).toEqual([{ id: 'prov_persisted' }])
  })

  it('seeds the default logical model on a fresh configuration file', async () => {
    await initDatabases(createTemporaryDirectory())

    expect(getConfigDb().$client.prepare('SELECT id, name, enabled FROM logical_models').all()).toEqual([
      { id: 'default', name: 'default', enabled: 1 },
    ])
  })

  it('restores default when a configuration file has no logical model', async () => {
    const directory = createTemporaryDirectory()
    await initDatabases(directory)
    const client = getConfigDb().$client
    const time = Date.now()

    client.prepare('DELETE FROM logical_models').run()
    client
      .prepare('INSERT INTO logical_models (id, name, createdTime, updatedTime) VALUES (?, ?, ?, ?)')
      .run('custom', 'Custom', time, time)

    await closeDatabases()
    await initDatabases(directory)

    expect(getConfigDb().$client.prepare('SELECT id FROM logical_models ORDER BY id').all()).toEqual([
      { id: 'custom' },
      { id: 'default' },
    ])
  })
})

describe('schema split', () => {
  it('creates exactly the configuration tables in the configuration file', async () => {
    await initDatabases(createTemporaryDirectory())

    expect(tableNames(getConfigDb().$client)).toEqual([
      '__drizzle_migrations',
      'client_config_versions',
      'logical_models',
      'protocol_converters',
      'provider_endpoints',
      'provider_model_endpoints',
      'provider_model_request_rewrite_rules',
      'provider_models',
      'provider_settings',
      'providers',
      'request_rewrite_rules',
      'scheduling_policies',
      'settings',
      'workflows',
    ].sort())
  })

  it('creates exactly the observability tables in the data file', async () => {
    await initDatabases(createTemporaryDirectory())

    expect(tableNames(getDataDb().$client)).toEqual([
      '__drizzle_migrations',
      'attempt_contents',
      'attempt_usages',
      'provider_health',
      'provider_model_health',
      'request_attempts',
      'request_attributes',
      'request_contents',
      'request_logs',
      'request_usages',
      'runtime_logs',
    ].sort())
  })

  // 这条断言是「两个文件真的分开了」的核心证据：健康行写不起来自配置库的外键，
  // 否则每次报成功都要跨库检查，而 SQLite 的外键又不可能跨文件生效。
  it('keeps the health tables free of foreign keys', async () => {
    await initDatabases(createTemporaryDirectory())

    for (const table of ['provider_health', 'provider_model_health']) {
      expect(tableDefinition(getDataDb().$client, table)).not.toContain('REFERENCES')
    }
  })

  it('accepts a health row whose provider no longer exists', async () => {
    await initDatabases(createTemporaryDirectory())

    // 外键没了，孤儿行就必须能被写进来；真正兜住它们的是启动时的孤儿清理，
    // 而不是让写入直接失败（那会在请求已经成功的路径上报错）。
    expect(() =>
      getDataDb().$client.prepare('INSERT INTO provider_health (providerId, updatedTime) VALUES (?, ?)').run('missing', Date.now()),
    ).not.toThrow()
  })

  it('enforces route uniqueness inside the configuration file', async () => {
    await initDatabases(createTemporaryDirectory())
    const client = getConfigDb().$client
    const time = Date.now()
    client.prepare('INSERT INTO providers (id, name, createdTime, updatedTime) VALUES (?, ?, ?, ?)').run('prov_test', 'Test', time, time)
    client.prepare('INSERT INTO provider_models (id, providerId, modelName, createdTime, updatedTime) VALUES (?, ?, ?, ?, ?)').run('pm_test', 'prov_test', 'model-a', time, time)
    client.prepare('INSERT INTO scheduling_policies (logicalModelId, providerModelId, priority, weight, createdTime, updatedTime) VALUES (?, ?, ?, ?, ?, ?)').run('default', 'pm_test', 0, 100, time, time)

    expect(() => client.prepare('INSERT INTO scheduling_policies (logicalModelId, providerModelId, createdTime, updatedTime) VALUES (?, ?, ?, ?)').run('default', 'pm_test', time, time)).toThrow()
  })

  it('keeps disabled models in the management list while excluding them from scheduling', async () => {
    await initDatabases(createTemporaryDirectory())
    const client = getConfigDb().$client
    const time = Date.now()
    client.prepare('INSERT INTO providers (id, name, createdTime, updatedTime) VALUES (?, ?, ?, ?)').run('prov_test', 'Test', time, time)
    client.prepare('INSERT INTO provider_models (id, providerId, modelName, enabled, createdTime, updatedTime) VALUES (?, ?, ?, ?, ?, ?)').run('pm_disabled', 'prov_test', 'model-disabled', 0, time, time)
    client.prepare('INSERT INTO scheduling_policies (logicalModelId, providerModelId, priority, weight, createdTime, updatedTime) VALUES (?, ?, ?, ?, ?, ?)').run('default', 'pm_disabled', 0, 100, time, time)

    await expect(listProviderModelsForLogicalModel('default')).resolves.toEqual([])
    // 管理列表仍要露出全局停用的模型；`enabled` 是绑定开关（默认开），不是模型本体。
    await expect(listProviderModelsForLogicalModel('default', false, true)).resolves.toMatchObject([
      { id: 'pm_disabled', enabled: true, priority: 0 },
    ])
  })

  it('creates the expected columns and indexes across both files', async () => {
    await initDatabases(createTemporaryDirectory())
    const config = getConfigDb().$client
    const data = getDataDb().$client

    // `PRAGMA table_info` 返回的是物理列顺序；两个库各由一个首发基线建表，物理顺序等于
    // schema 声明顺序。这里仍然比较集合，避免测试在有人重排 schema 时无意义地变红。
    expect(columnNames(data, 'request_logs').sort()).toEqual([
      'clientProtocol', 'createdTime', 'id', 'logicalModelId', 'status', 'totalDurationMilliseconds', 'transport',
    ])
    // 正文列存的是压缩后落库、读取时还原的字节，但列亲和性仍是 `text`：压缩是列定义里的
    // 细节，不产生 schema 变更，所以这两张表的物理列与首发基线完全一致。这里断言的是
    // **迁移链**真的跑过一遍：只比 schema 声明的话，「schema 改了但没生成迁移」会一路绿到运行期才炸。
    expect(columnNames(data, 'request_contents').sort()).toEqual([
      'captureStatus', 'createdTime', 'id', 'requestBody', 'requestHeaders', 'requestId',
      'requestMethod', 'requestPath', 'responseBody', 'responseHeaders', 'responseStatus',
      'updatedTime',
    ])
    expect(columnNames(data, 'attempt_contents').sort()).toEqual([
      'attemptId', 'captureStatus', 'createdTime', 'id', 'requestBody', 'requestHeaders',
      'responseBody', 'responseHeaders', 'responseStatus', 'updatedTime',
    ])
    expect(columnNames(config, 'settings')).toEqual(['key', 'value', 'valueType', 'updatedTime'])
    expect(columnNames(data, 'request_attempts')).toEqual(
      expect.arrayContaining(['providerModelId', 'providerName', 'providerModelName', 'url', 'httpStatus', 'retryable', 'upstreamTransport', 'ttftMilliseconds', 'requestRewriteRuleIds', 'responseRewriteRuleIds']),
    )
    expect(columnNames(config, 'workflows').sort()).toEqual([
      'createdTime', 'definition', 'deletedTime', 'description', 'id', 'name', 'type', 'updatedTime', 'version',
    ])
    expect(indexNames(config)).toEqual(
      expect.arrayContaining(['idx_scheduling_policies_route', 'idx_workflows_type_version', 'idx_provider_model_request_rewrite_rule_priority_active']),
    )
    expect(indexNames(data)).toEqual(
      expect.arrayContaining(['idx_request_attempts_request_order', 'idx_request_attributes_key_value', 'idx_runtime_logs_timestamp']),
    )
    // 唯一性只能由**部分**唯一索引表达（只约束未删除的行），这里断言不存在全量唯一索引：
    // 它会把「软删除旧绑定后在同 priority 绑定新规则」这条最常见的换绑路径堵死，
    // 而且只会在运行期以写入失败的形式暴露。
    expect([...indexNames(config), ...indexNames(data)]).not.toContain('idx_model_request_rewrite_rule_priority')
  })
})

// 孤儿健康行是拆库的直接代价：健康表在观测库，外键又不可能跨文件，所以「配置里删掉的
// 供应商，健康表里还留着行」只能由启动时的一次清理收掉。它是启动路径上唯一的跨库动作，
// 因此必须被钉住——清理漏了会在界面上留下幽灵行，清理错了会抹掉真实状态。
describe('orphan health rows', () => {
  it('drops health rows whose provider or provider model is gone', async () => {
    const directory = createTemporaryDirectory()
    await initDatabases(directory)
    const time = Date.now()

    getConfigDb()
      .$client.prepare('INSERT INTO providers (id, name, createdTime, updatedTime) VALUES (?, ?, ?, ?)')
      .run('prov_alive', 'Alive', time, time)
    getConfigDb()
      .$client.prepare('INSERT INTO provider_models (id, providerId, modelName, createdTime, updatedTime) VALUES (?, ?, ?, ?, ?)')
      .run('pm_alive', 'prov_alive', 'model-alive', time, time)
    for (const id of ['prov_alive', 'prov_gone']) {
      getDataDb().$client.prepare('INSERT INTO provider_health (providerId, updatedTime) VALUES (?, ?)').run(id, time)
    }
    for (const id of ['pm_alive', 'pm_gone']) {
      getDataDb().$client.prepare('INSERT INTO provider_model_health (providerModelId, updatedTime) VALUES (?, ?)').run(id, time)
    }

    await closeDatabases()
    await initDatabases(directory)

    expect(getDataDb().$client.prepare('SELECT providerId FROM provider_health').all()).toEqual([{ providerId: 'prov_alive' }])
    expect(getDataDb().$client.prepare('SELECT providerModelId FROM provider_model_health').all()).toEqual([
      { providerModelId: 'pm_alive' },
    ])
  })
})

describe('schema version in the file name', () => {
  // 文件名带的是**数据库结构版本**，不是应用版本：一次应用大版本升级不会换掉用户的配置文件名，
  // 只有这个库的结构真的不兼容时才把 `DATABASE_SCHEMA_VERSIONS` 里那个数字加一，
  // 下一次启动自然落到另一个全新的空文件上。所以这里没有任何版本检测代码。
  it('creates both files of the current schema version and leaves other files untouched', async () => {
    const directory = createTemporaryDirectory()
    // 借同一个 API 造一个「上一代」的文件名：命名规则将来再变，这个用例也不会静默退化成
    // 「造了一个永远不可能出现的字符串」。
    const foreignPath = path.join(directory, createDatabaseFileName('config').replace(/-v\d+\.db$/, '-v0.db'))
    const foreignClient = new DatabaseSync(foreignPath)
    foreignClient.exec('CREATE TABLE previous_version_only (id TEXT PRIMARY KEY)')
    foreignClient.close()
    const foreignBytes = fs.readFileSync(foreignPath)

    await initDatabases(directory)

    expect(fs.readdirSync(directory).filter(name => name.endsWith('.db')).sort()).toEqual(
      [path.basename(foreignPath), ...listCurrentDatabaseFileNames()].sort(),
    )
    expect(
      getConfigDb().$client.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'previous_version_only'").all(),
    ).toEqual([])
    expect(fs.readFileSync(foreignPath)).toEqual(foreignBytes)
  })
})
