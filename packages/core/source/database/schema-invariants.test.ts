import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AttemptStatusSchema, RequestContentCaptureStatusSchema, RequestStatusSchema } from '@common/schemas'
import * as configSchema from './config-schema'
import * as dataSchema from './data-schema'
import { closeDatabases, getConfigDb, getDataDb, initDatabases } from './index'

/**
 * 两个 schema 文件里真正会伤人的东西：`extraConfig` 回调只在表被**materialize** 时才跑
 * （生产路径导入 schema 只为拿列对象，DDL 全部来自已生成的迁移），所以库内约束
 * 平时没有任何测试真的把它建出来过。这里用 `getTableConfig` 显式 materialize，
 * 再把文件头上写着的那几条不变量逐条钉住：
 *
 *   1. 跨库外键不存在——两个库分文件的全部依据；
 *   2. 没有任何部分唯一索引——「活跃行唯一」只许写在应用层，否则「删掉再建同名的」会被堵死；
 *   3. 库内 CHECK 的词表与 `@common/schemas` 同源，加一个状态忘了改 schema 会当场炸。
 */

interface MaterializedTable {
  exportName: string
  name: string
  config: ReturnType<typeof getTableConfig>
}

function isDrizzleTable(value: unknown): value is SQLiteTable {
  return typeof value === 'object' && value !== null && Symbol.for('drizzle:IsDrizzleTable') in value
}

/** 枚举模块导出的**全部**表（而不是手写清单）：新增一张表自动纳入下面每条不变量。 */
function listTables(module: Record<string, unknown>): MaterializedTable[] {
  const tables: MaterializedTable[] = []
  for (const [exportName, value] of Object.entries(module)) {
    if (!isDrizzleTable(value)) continue
    const config = getTableConfig(value)
    tables.push({ exportName, name: config.name, config })
  }
  return tables
}

const configTables = listTables(configSchema)
const dataTables = listTables(dataSchema)

function foreignTargets(table: MaterializedTable): string[] {
  return table.config.foreignKeys.map(foreignKey => getTableConfig(foreignKey.reference().foreignTable).name)
}

describe.each([
  ['配置库', configTables],
  ['观测库', dataTables],
])('%s 的表结构', (_label, tables) => {
  it('外键一律指向同一个文件里的表', () => {
    const ownTableNames = new Set(tables.map(table => table.name))

    for (const table of tables) {
      // 跨文件外键在 SQLite 里根本不可能生效，写下来只会给人「已经兜住了」的错觉。
      // `check-database-boundaries.mjs` 从 import 侧拦这条，这里从**声明侧**再拦一次：
      // 直接把 `references(() => 另一个文件里的列)` 写成字面量也过不去。
      for (const target of foreignTargets(table)) {
        expect(ownTableNames.has(target), `${table.name} 的外键指向了 ${target}`).toBe(true)
      }
    }
  })

  it('没有任何部分唯一索引', () => {
    // 部分唯一索引说的是「这个值不许第二次出现」，而业务规则是「当前活跃的行之间不许重复」。
    // 写成约束之后，删除路径不得不打标让位、改名腾位，用户看得见的
    // 「删掉再建一个同名的」就成了一次莫名其妙的冲突（见 `config-schema.ts` 文件头第 4 条）。
    const partial = tables.flatMap(table =>
      table.config.indexes
        .filter(index => index.config.where !== undefined)
        .map(index => `${table.name}.${index.config.name}`),
    )

    expect(partial).toEqual([])
  })

  it('每张表都声明了显式名字', () => {
    // 少一个名字，drizzle-kit 生成的迁移里就会多出一个以列拼出来的索引名，
    // 而下一次 diff 又会把它当成新索引。
    for (const table of tables) {
      const unnamed = table.config.indexes.filter(index => !index.isNameExplicit).map(index => `${table.name}.${index.config.name}`)
      expect(unnamed, `${table.exportName}`).toEqual([])
    }
  })
})

/**
 * 「去重交给 SQLite」这类说法必须落到**具体的列组合**上：唯一索引建在那三列上才叫去重，
 * 建在别的组合上会安静地把不该合并的行合并掉，或者根本拦不住重复。
 */
describe('唯一约束的列组合', () => {
  it('客户端配置版本按（客户端, 路径, 内容摘要）去重', () => {
    const table = configTables.find(candidate => candidate.name === 'client_config_versions')

    expect(table?.config.uniqueConstraints ?? []).toEqual([])
    const unique = table?.config.indexes.filter(index => index.config.unique) ?? []
    expect(unique.map(index => [index.config.name, index.config.columns.map(column => 'name' in column ? column.name : String(column))])).toEqual([
      ['idx_client_config_versions_hash', ['clientKey', 'filePath', 'contentHash']],
    ])
  })

  it('尝试序号在同一请求内唯一，正文与一个请求/尝试恰好一行', () => {
    const expected: Record<string, string[]> = {
      request_attempts: ['requestId', 'attemptIndex'],
      request_contents: ['requestId'],
      attempt_contents: ['attemptId'],
    }

    for (const [tableName, columns] of Object.entries(expected)) {
      const table = dataTables.find(candidate => candidate.name === tableName)
      const unique = (table?.config.indexes ?? []).filter(index => index.config.unique)

      expect(unique.map(index => index.config.columns.map(column => ('name' in column ? column.name : String(column)))), tableName).toEqual([columns])
    }
  })
})

describe('库内 CHECK 的词表', () => {
  let temporaryDirectory: string

  beforeEach(async () => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-schema-invariants-'))
    await initDatabases(temporaryDirectory)
  })

  afterEach(async () => {
    await closeDatabases()
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  })

  function insertRequestLog(id: string, status = 'pending'): void {
    getDataDb()
      .$client.prepare('INSERT INTO request_logs (id, status, createdTime) VALUES (?, ?, ?)')
      .run(id, status, 1)
  }

  it('请求状态：合同里的每一种都能落库，词表外的取值被 chk_request_logs_status 拒绝', () => {
    const insert = getDataDb().$client.prepare('INSERT INTO request_logs (id, status, createdTime) VALUES (?, ?, ?)')

    // 词表同源是这条断言的全部意义：往 `@common/schemas` 里加一个状态而不改 schema，
    // 请求写入会在生产里以「CHECK constraint failed」的形式炸掉，而不是在这里。
    for (const status of RequestStatusSchema.options) {
      expect(() => insert.run(`req_${status}`, status, 1), status).not.toThrow()
    }

    expect(() => insert.run('req_bogus', 'unknown', 1)).toThrow(/CHECK constraint failed: chk_request_logs_status/)
  })

  it('尝试状态少一个 `pending`：尝试行只在拿到结果后写入', () => {
    insertRequestLog('req_for_attempts')
    const insert = getDataDb().$client.prepare(
      'INSERT INTO request_attempts (id, requestId, providerId, providerModelId, providerName, providerModelName, url, status, attemptIndex, durationMilliseconds, createdTime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    const base = ['req_for_attempts', 'prov_x', 'pm_x', 'P', 'M', 'https://upstream.invalid/v1'] as const

    for (const [index, status] of AttemptStatusSchema.options.entries()) {
      expect(() => insert.run(`att_${status}`, ...base, status, index, 1, 1), status).not.toThrow()
    }

    expect(() => insert.run('att_pending', ...base, 'pending', 9, 1, 1)).toThrow(/CHECK constraint failed: chk_request_attempts_status/)
  })

  it('正文采集状态只有 captured 与 partial', () => {
    const insert = getDataDb().$client.prepare(
      'INSERT INTO request_contents (id, requestId, captureStatus, requestMethod, requestPath, createdTime, updatedTime) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    const requestIdFor = (captureStatus: string) => `req_contents_${captureStatus}`

    // `request_contents` 每个请求恰好一行（`idx_request_contents_request`），
    // 所以每个取值都要配一个自己的请求行。
    for (const captureStatus of RequestContentCaptureStatusSchema.options) {
      insertRequestLog(requestIdFor(captureStatus))
      expect(() =>
        insert.run(`rc_${captureStatus}`, requestIdFor(captureStatus), captureStatus, 'POST', '/v1/chat', 1, 1),
      ).not.toThrow()
    }

    insertRequestLog('req_contents_truncated')
    expect(() => insert.run('rc_bogus', 'req_contents_truncated', 'truncated', 'POST', '/v1/chat', 1, 1)).toThrow(
      /CHECK constraint failed: chk_request_contents_capture_status/,
    )
  })

  it('用量形状：raw 行只带 rawValue，数值行只带 value', () => {
    // 形状约束的理由写在 `data-schema.ts` 里：`raw` 行是原始 usage 报文，用 `0` 占位
    // 会污染 `sum(value)`，所以「哪一列必须有值」是必须由库来兜的事。
    const insert = getDataDb().$client.prepare('INSERT INTO request_usages (requestId, type, value, rawValue, createdTime) VALUES (?, ?, ?, ?, ?)')

    insertRequestLog('req_usage_numeric')
    expect(() => insert.run('req_usage_numeric', 'inputTokens', 12, null, 1)).not.toThrow()

    insertRequestLog('req_usage_raw')
    expect(() => insert.run('req_usage_raw', 'raw', null, '{"input_tokens":12}', 1)).not.toThrow()

    insertRequestLog('req_usage_raw_value')
    expect(() => insert.run('req_usage_raw_value', 'raw', 0, '{}', 1)).toThrow(/CHECK constraint failed: chk_request_usages_value_shape/)

    insertRequestLog('req_usage_raw_empty')
    expect(() => insert.run('req_usage_raw_empty', 'raw', null, null, 1)).toThrow(/CHECK constraint failed: chk_request_usages_value_shape/)

    insertRequestLog('req_usage_numeric_raw')
    expect(() => insert.run('req_usage_numeric_raw', 'outputTokens', 1, '{}', 1)).toThrow(/CHECK constraint failed: chk_request_usages_value_shape/)

    insertRequestLog('req_usage_type')
    expect(() => insert.run('req_usage_type', 'bogus', 1, null, 1)).toThrow(/CHECK constraint failed: chk_request_usages_type/)
  })

  it('尝试级用量与请求级用量共用同一套形状约束', () => {
    insertRequestLog('req_for_attempt_usage')
    const attemptId = 'att_usage'
    getDataDb()
      .$client.prepare(
        'INSERT INTO request_attempts (id, requestId, providerId, providerModelId, providerName, providerModelName, url, status, attemptIndex, durationMilliseconds, createdTime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(attemptId, 'req_for_attempt_usage', 'prov_x', 'pm_x', 'P', 'M', 'https://upstream.invalid/v1', 'success', 0, 1, 1)

    const insert = getDataDb().$client.prepare('INSERT INTO attempt_usages (attemptId, type, value, rawValue, createdTime) VALUES (?, ?, ?, ?, ?)')

    expect(() => insert.run(attemptId, 'inputTokens', 5, null, 1)).not.toThrow()
    expect(() => insert.run(attemptId, 'raw', 5, null, 1)).toThrow(/CHECK constraint failed: chk_attempt_usages_value_shape/)
  })
})

describe('跨库写入', () => {
  let temporaryDirectory: string

  beforeEach(async () => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-schema-cross-'))
    await initDatabases(temporaryDirectory)
  })

  afterEach(async () => {
    await closeDatabases()
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  })

  it('观测库里存着配置库已经删掉的供应商 id 也照样写得进去', () => {
    // 这是拆库的核心代价与核心收益：健康行、尝试行都锚在配置库的 id 上，但没有外键，
    // 所以「删供应商」不需要跨库协调，代价是孤儿行要由启动时的清理收掉。
    const time = Date.now()

    expect(() =>
      getDataDb()
        .$client.prepare('INSERT INTO provider_model_health (providerModelId, updatedTime) VALUES (?, ?)')
        .run('pm_gone', time),
    ).not.toThrow()

    expect(getConfigDb().$client.prepare('SELECT count(*) AS total FROM provider_models').get()).toEqual({ total: 0 })
  })
})
