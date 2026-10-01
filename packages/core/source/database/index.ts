import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import {
  createDatabaseFileName,
  type DatabaseRole,
} from '@common/database-file'
import { BUILT_IN_DEFAULT_LOGICAL_MODEL_DESCRIPTION, BUILT_IN_DEFAULT_LOGICAL_MODEL_ID } from '@common/schemas'
import { generateId } from '@common/utils'
import { drizzle } from 'drizzle-orm/node-sqlite'
import { migrate } from 'drizzle-orm/node-sqlite/migrator'
import { invalidateConfigReadCache } from './config-read-cache'

/**
 * 数据库连接层：一个数据目录、两个文件。
 *
 * `config-v1.db`（用户配置）与 `data-v1.db`（观测数据）分别开连接、
 * 分别迁移、分别调优。文件名由 `@common/database-file` 自己推导，宿主与连接层都不参与，
 * 也不拼任何字面量。为什么要拆、拆的边界在哪，见那个文件与 `docs/product/data-model.md`；
 * 这里只讲连接层自己必须守住的三件事：
 *
 *   1. **没有跨库事务。** SQLite 的事务作用域是单个文件，`ATTACH` 也不会让 `BEGIN` 跨越两个
 *      文件（它只会把两个库一起卷进同一次提交，代价与语义都不是我们要的）。所以这里只提供
 *      两个句柄，不做任何「看起来像原子」的封装：需要「两边都成」的地方必须在应用层自己排序，
 *      并想清楚中间失败该怎么办。当前唯一这种场景是开发用种子数据，它被拆成两个先后执行的事务。
 *   2. **两个库不共用一套参数。** PRAGMA 按角色各设一套（见 `applyPragmas`）：配置库要的是
 *      「写进去的不能丢」，观测库要的是「每个请求一次写入扛得住」加「删了日志能真的还空间」。
 *      取两者的折中只会两边都做不好——这正是拆开的收益之一。
 *   3. **同时持有两个句柄的地方只允许有一处**：本文件结尾的孤儿健康行清理。
 *      其它任何地方需要「两个库一起看」，都说明架构被绕过了，先改架构。
 *      这条由 `packages/core/scripts/check-database-boundaries.mjs` 静态检查。
 */

export type Database = ReturnType<typeof drizzle>

interface OpenedDatabase {
  role: DatabaseRole
  client: DatabaseSync
  database: Database
}

let configDatabase: OpenedDatabase | null = null
let dataDatabase: OpenedDatabase | null = null
/** 观测库的文件住在哪；`readDataStorageBytes` 需要它，别处不许复制一份。 */
let dataDirectory: string | null = null
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))

/**
 * 打开（必要时创建）两个数据文件。
 *
 * 文件名不再由宿主给出：两个库各自带 schema 版本常量，名字由 `@common/database-file` 推导
 * （理由见那个文件）。宿主因此少算一次文件名，也少一个两种形态可能算出不同结果的地方。
 */
export async function initDatabases(dataDir: string): Promise<void> {
  if (configDatabase && dataDatabase) {
    console.debug('[database] initialization skipped reason=already-initialized')
    return
  }

  // 开库前先作废常驻读缓存：新打开的是**另一份**配置，上一个库的值一个都不能留下。
  invalidateConfigReadCache()
  const startedAt = Date.now()
  fs.mkdirSync(dataDir, { recursive: true })
  dataDirectory = dataDir
  try {
    // 配置库先开：它决定「这次启动有没有意义」。数据库拿不到时用户仍能看到配置与健康状态，
    // 所以顺序不是随意的，而是「先给出最重要的那个」。
    configDatabase = openDatabase('config', dataDir)
    dataDatabase = openDatabase('data', dataDir)
    pruneOrphanHealthRows(configDatabase, dataDatabase)
  } catch (error) {
    closeQuietly()
    console.error(`[database] initialization failed duration=${Date.now() - startedAt}ms`, error)
    throw error
  }

  console.info(`[database] initialization completed duration=${Date.now() - startedAt}ms`)
}

/**
 * 配置库句柄：只放用户写的东西（见 `./config-schema.ts`）。
 *
 * 返回的句柄外面包了一层**写失效**（见 `wrapConfigHandleWithInvalidation`）：任何一次配置写入
 * 都会作废 `./config-read-cache.ts` 里的常驻读缓存。放在连接层而不是各个 store 里，是因为
 * 「每个写路径都记得调一下失效」正是会漏的那一类约定；包在这里，`getConfigDb()` 的每一个
 * 使用者都自动覆盖，新增 store 也不例外。
 */
export function getConfigDb(): Database {
  if (!configDatabase) throw new Error('Config database not initialized')
  return configDatabase.database
}

/** 数据库句柄：只放系统写的观测数据（见 `./data-schema.ts`）。 */
export function getDataDb(): Database {
  if (!dataDatabase) throw new Error('Data database not initialized')
  return dataDatabase.database
}

/**
 * 观测库当前在磁盘上占用的字节数——主文件 `data-v<n>.db` 加上尚未 checkpoint 的 `-wal`。
 *
 * 报的是**文件**大小而不是 `PRAGMA page_count * page_size`：两个数在这里本来就不一样，
 * 而用户问的是「这东西占了我多少盘」。WAL 计入是因为它此刻同样占着盘，且默认的自动
 * checkpoint 让它通常只有几 MB，不会掩盖主文件那部分。`-shm` 不计：它是 32KB 的共享
 * 内存映射，不是数据。
 *
 * 用 `fs.statSync` 而不是向 SQLite 问：读文件大小不碰数据库内容，不该走连接、也不该
 * 受事务或 WAL 快照影响。文件读不到（库刚建还没写过、被外部工具移走）按 0 计——
 * 展示层只是少显示一个数字，没有理由因此报错。
 */
export function readDataStorageBytes(): number {
  const directory = dataDirectory
  if (!directory) throw new Error('Data directory not initialized')
  const fileName = createDatabaseFileName('data')
  return [fileName, `${fileName}-wal`].reduce(
    (total, name) => total + readFileSizeOrZero(path.join(directory, name)),
    0,
  )
}

function readFileSizeOrZero(filePath: string): number {
  try {
    return fs.statSync(filePath).size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
}

/** 把清理腾出来的页真正还给文件系统。 */
export function reclaimUnusedSpace(): void {
  if (!dataDatabase) return
  // 只在观测库上做：配置库不增长，没有需要回收的空间。
  //
  // 带页数上限是刻意的。`PRAGMA incremental_vacuum` 不带参数会一次性走完整个空闲链表，
  // 一个几百 MB 的空闲链表会让调用方卡上几秒；这里每次最多回收 2000 页
  // （默认页大小 4KB，约 8MB）。清理是每次启动、每次保留期回收都会跑的常规动作，
  // 「每次回收一点、很快跟上」比「一次回收完但会卡」更合适。
  dataDatabase.client.exec('PRAGMA incremental_vacuum(2000)')
}

export async function closeDatabases(): Promise<void> {
  const handles = [configDatabase, dataDatabase].filter((handle): handle is OpenedDatabase => handle !== null)
  configDatabase = null
  dataDatabase = null
  dataDirectory = null
  // 关库后常驻读缓存必须清空：同一个进程里再开一次库（测试会这么做）时，它拿到的必须是新库的值。
  invalidateConfigReadCache()
  if (handles.length === 0) {
    console.debug('[database] close skipped reason=not-initialized')
    return
  }

  let failure: unknown = null
  for (const handle of handles) {
    try {
      handle.client.close()
      console.info(`[database] closed role=${handle.role}`)
    } catch (error) {
      // 一个库关不掉不该阻止另一个库被关掉：两个句柄都是长驻的，漏关一个会留下
      // 持有 `-wal` 的进程，下次启动直接撞上锁。
      console.error(`[database] close failed role=${handle.role}`, error)
      failure ??= error
    }
  }
  if (failure) throw failure
}

/**
 * 打开一个库：PRAGMA → 迁移 → 角色专属收尾 → 统计信息。
 *
 * 顺序不能挪：PRAGMA 全部要给在 `migrate` 之前，其中 `auto_vacuum` 还额外要求排在
 * `journal_mode = WAL` 之前（见 `applyPragmas`）。
 */
function openDatabase(role: DatabaseRole, dataDir: string): OpenedDatabase {
  const filePath = path.join(dataDir, createDatabaseFileName(role))
  const migrationsFolder = getMigrationsFolder(role)
  const startedAt = Date.now()
  console.info(`[database] open started role=${role} file=${createDatabaseFileName(role)}`)
  const client = new DatabaseSync(filePath, { enableForeignKeyConstraints: true })

  try {
    applyPragmas(role, client)
    const database = drizzle({ client })
    // 迁移期间必须放下外键约束：重建式迁移（建新表 → 拷数据 → 删旧表 → 改名）删旧表时的隐式
    // 删除会撞上子表的外键，而 Drizzle 自己写的 `PRAGMA foreign_keys=OFF` 落在它的迁移事务
    // 内部，SQLite 会忽略。迁移结束后立即恢复，运行期约束强度不受影响。
    // 当前 config 链是「首发基线 + 一条加列」，加列不重建表；这段是为了让将来生成的重建式迁移
    // （建新表 → 拷数据 → 删旧表 → 改名）也仍然成立。
    client.exec('PRAGMA foreign_keys = OFF')
    try {
      migrate(database, { migrationsFolder })
    } finally {
      client.exec('PRAGMA foreign_keys = ON')
    }
    finishRoleSpecificInitialization(role, client)
    // 补一次统计信息。`ANALYZE` 的结果（`sqlite_stat1`）决定查询规划器选哪个索引，
    // 而规划器在没有统计信息时是按「每个索引都一样好」的默认假设估的——实测中它因此
    // 给带时间窗的聚合选了更差的路径。`optimize` 只在统计信息缺失或已过期时才会真正分析，
    // 因此常规启动几乎不花时间；新建的空库也会被它立刻标记为「已有统计信息」。
    client.exec('PRAGMA optimize')
    console.info(`[database] open completed role=${role} duration=${Date.now() - startedAt}ms`)
    return { role, client, database: role === 'config' ? wrapConfigHandleWithInvalidation(database) : database }
  } catch (error) {
    client.close()
    throw error
  }
}

/**
 * 给配置库句柄包一层「写即失效」。
 *
 * 拦的是四个会改变配置的入口：`insert` / `update` / `delete` / `transaction`。命中就在真正执行
 * **之前**作废整份常驻读缓存（见 `./config-read-cache.ts`），于是同一次请求里排在写之后的读
 * 一定读到新值。`transaction` 的回调拿到的是另一个句柄（drizzle 自己造的），但我们在进
 * `transaction` 那一刻就已经失效过了，回调里写多少都一样。
 *
 * 用 Proxy 而不是在每个 store 里手调：新增一个写路径时没人会记得「顺手失效一下」，
 * 而这种漏失配是静默的——界面改了配置、代理却还按老值路由。包在这里，覆盖是穷尽的。
 */
function wrapConfigHandleWithInvalidation(database: Database): Database {
  const writeMethods = new Set<PropertyKey>(['insert', 'update', 'delete', 'transaction'])
  return new Proxy(database, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (!writeMethods.has(property) || typeof value !== 'function') return value
      return (...args: unknown[]) => {
        invalidateConfigReadCache()
        return value.apply(target, args)
      }
    },
  })
}

/**
 * 按角色设置 PRAGMA。
 *
 * 两个库的调优目标不一样，所以这里**不**共用一套参数：配置库要的是「写进去的不能丢」，
 * 观测库要的是「每个请求一次写入扛得住」加上「删了日志能真的还空间」。
 */
function applyPragmas(role: DatabaseRole, client: DatabaseSync): void {
  // 排队等锁而不是当场报 `SQLITE_BUSY`。默认值是 0——任何一次短暂的重叠写入都会直接
  // 失败，而这里有两类「第三方写手」：`stop` 的另一个进程可能正在收尾，用户也可能拿
  // 别的工具（sqlite3 CLI）打开同一个文件。没有这条，一次几毫秒的锁竞争就会变成
  // 「日志写不进去」或「启动失败」。5s 与 SQLite 生态里的常见取值一致。
  client.exec('PRAGMA busy_timeout = 5000')

  // `auto_vacuum` 必须排在 `journal_mode = WAL` **之前**。观测数据只增不减，删掉旧日志后
  // 腾出来的页要能还给文件系统，否则文件只会越来越大——这条 PRAGMA 就是那件事的开关，
  // 配套的回收动作见 `reclaimUnusedSpace`。
  //
  // 它只在「库还是空的」那一刻生效，而 `journal_mode = WAL` 一执行就会写库头、把库变成非空。
  // 顺序反了**不会报错**：先 WAL 再设 `auto_vacuum` 会被静默忽略（`PRAGMA auto_vacuum`
  // 读回来仍是 0），`incremental_vacuum` 变成一次空操作，「删了正文但文件一点
  // 没小」会一直真实发生却没有任何信号。实测同一份 117 MB 的观测库：顺序反了回收后仍是 117.3 MB，
  // 顺序对了回收后是 0.0 MB。
  //
  // 只给观测库设：配置库只增几十行，没有需要回收的空间。
  if (role === 'data') client.exec('PRAGMA auto_vacuum = INCREMENTAL')

  // WAL 两边都要：读不被写挡住。分析页在跑长聚合时，代理仍在写日志——回滚日志模式下这两件事
  // 会互相阻塞，而 WAL 下写只追加、读走快照。两个库都是「一边读一边写」的形态。
  client.exec('PRAGMA journal_mode = WAL')

  if (role === 'config') {
    // 配置写入是低频的（用户在界面上点出来的），每次多付一次 fsync 完全无所谓；
    // 而丢一条刚存的配置是不可接受的。这一条就是「配置更安全」在连接层的落点。
    client.exec('PRAGMA synchronous = FULL')
    return
  }

  // `synchronous = NORMAL`：WAL 下该档位不会因进程崩溃丢已提交数据，只有整机掉电才可能丢
  // 最后几个事务——代理每次请求都要写日志，这个取舍对写入延迟的收益是值得的。
  client.exec('PRAGMA synchronous = NORMAL')
  // 分析聚合几乎都带 `GROUP BY` / `ORDER BY`，SQLite 为此要建临时 B 树。默认走磁盘临时文件
  // （约 1.9 万行/秒的写盘往返），落在内存里则没有这段 IO。
  client.exec('PRAGMA temp_store = MEMORY')
  // 默认页缓存只有 2MB，150k 行的日志表随便扫一遍就把它冲干净了，而分析查询又会连着访问
  // 同样的页。64MB 上限对桌面应用是可接受的开销。
  client.exec('PRAGMA cache_size = -64000')
}

function finishRoleSpecificInitialization(role: DatabaseRole, client: DatabaseSync): void {
  if (role === 'config') {
    ensureDefaultLogicalModel(client)
    return
  }
  reconcileInterruptedRequests(client)
}

/**
 * 清理健康表里指向「配置库中已经不存在的行」的孤儿。
 *
 * 这是**唯一**一处同时持有两个句柄的地方，读它之前先读 `./data-schema.ts` 的文件头。
 * 简版背景：健康状态属于观测库（每个成功请求都要写一次），它的 `providerId` /
 * `providerModelId` 指向配置库的行，而 SQLite 的外键不能跨文件，所以「配置里删掉的供应商，
 * 健康表里还留着行」只能由应用自己收。
 *
 * 放在启动路径上是因为它是低频、可延迟的动作：运行期新产生的孤儿行由懒创建 + 覆盖写自然
 * 收敛（没有配置行的健康数据永远读不到），不值得为它维护删除钩子。读法是「把配置库里现存的
 * 主键全捞出来，再删数据库里不在其中的行」——两边都是小表（供应商与供应商模型数量按百计），
 * 一次全量对比比增量钩子可靠得多，也不会漏掉「用管理 API 之外的方式改过配置」的情况。
 */
function pruneOrphanHealthRows(config: OpenedDatabase, data: OpenedDatabase): void {
  const providerIds = readStringColumn(config.client, 'SELECT id FROM providers')
  const providerModelIds = readStringColumn(config.client, 'SELECT id FROM provider_models')
  const deletedProviders = deleteMissingKeys(data.client, 'provider_health', 'providerId', providerIds)
  const deletedProviderModels = deleteMissingKeys(data.client, 'provider_model_health', 'providerModelId', providerModelIds)
  if (deletedProviders === 0 && deletedProviderModels === 0) return

  console.info(`[database] pruned orphan health rows providers=${deletedProviders} providerModels=${deletedProviderModels}`)
}

function readStringColumn(client: DatabaseSync, statement: string): string[] {
  return client.prepare(statement).all().map(row => String(Object.values(row)[0]))
}

/**
 * 表名与列名全部来自调用方的字面量常量（`provider_health` / `providerId` 等），
 * 不存在任何外部输入，所以可以直接拼进 SQL。
 */
function deleteMissingKeys(client: DatabaseSync, table: string, column: string, keep: string[]): number {
  const keepSet = new Set(keep)
  const orphans = readStringColumn(client, `SELECT ${column} FROM ${table}`).filter(key => !keepSet.has(key))
  if (orphans.length === 0) return 0

  const placeholders = orphans.map(() => '?').join(', ')
  const result = client.prepare(`DELETE FROM ${table} WHERE ${column} IN (${placeholders})`).run(...orphans)
  return Number(result.changes)
}

/** 启动中途失败的兜底关闭：句柄顺序与打开顺序相反，且不允许任何一次关闭失败打断剩下的。 */
function closeQuietly(): void {
  const handles = [dataDatabase, configDatabase]
  dataDatabase = null
  configDatabase = null
  dataDirectory = null
  for (const handle of handles) {
    try {
      handle?.client.close()
    } catch {
      // 已经在失败路径上，这里再抛只会把真正的错误盖掉。
    }
  }
}

function getMigrationsFolder(role: DatabaseRole): string {
  // 迁移基线随核心包分发，但它和编译产物的相对深度在两种形态下并不一样：
  //
  //   - 打包后：electron-builder 把 `packages/core/drizzle` 映射进 asar
  //     （见 `apps/app/electron-builder.config.cjs`），服务进程的模块住在
  //     `app.asar/output/command/`，上溯两层就是 asar 根。
  //     核心服务是 `utilityProcess` 子进程，走主进程同一套模块加载，asar 里的路径
  //     对它和普通路径没有区别——所以这里只有**一种**布局。
  //   - 开发期：模块住在 `apps/app/output/command/`，上溯两层只会落到 `apps/app`，
  //     要到仓库根得上溯四层。
  //
  // 与其在代码里写死两套深度，不如从模块目录逐级上溯找那个包目录：两种形态都命中，
  // 将来产物布局再变也不会静默失配。从仓库根直接跑 core（测试、本地脚本）时模块目录
  // 反而不在链路里，所以最后用 cwd 兜一次。
  const relative = path.join('packages/core/drizzle', role)
  let directory = moduleDirectory
  for (let level = 0; level < 8; level += 1) {
    const candidate = path.join(directory, relative)
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  const fromWorkingDirectory = path.join(process.cwd(), relative)
  if (fs.existsSync(fromWorkingDirectory)) return fromWorkingDirectory
  // 全部落空时返回「产物形态下的期望位置」，让上层的报错指向一个可解释的路径。
  return path.join(moduleDirectory, relative)
}

/**
 * 保证内建默认逻辑模型存在。
 *
 * 这条记录是内建「模型直达」规则的落点：客户端发来的模型名大概率不是本机配的逻辑模型，
 * 没有它就没有任何可用的上游起点。
 *
 * 存在与否认的是 **modelId**（与服务端的回落匹配共用同一个常量）；数据记录 id 由这里现生成——
 * 它是本机的内部主键，别处一律通过 `getLogicalModelByModelId` 查出来，不要写死，也不要拿它
 * 当这个模型的标识去比较。
 *
 * 按 `modelId` 先查一次而不是 `INSERT OR IGNORE`：主键是记录 id（每次生成的都不一样），
 * 拿它做冲突判定等于永远不冲突，每次启动都会多插一行。
 */
function ensureDefaultLogicalModel(db: DatabaseSync): void {
  const existing = db.prepare('SELECT id FROM logical_models WHERE modelId = ? AND deletedTime IS NULL')
    .get(BUILT_IN_DEFAULT_LOGICAL_MODEL_ID)
  if (existing) return
  const time = BigInt(Date.now())
  db.prepare(`INSERT INTO logical_models
    (id, modelId, description, enabled, createdTime, updatedTime)
    VALUES (?, ?, ?, 1, ?, ?)`)
    .run(generateId('lm_'), BUILT_IN_DEFAULT_LOGICAL_MODEL_ID, BUILT_IN_DEFAULT_LOGICAL_MODEL_DESCRIPTION, time, time)
}

/**
 * 回收上一次运行遗留的「进行中」请求。
 *
 * 请求行在拿到结果之前就已写入，所以进程被杀掉（崩溃、强制退出）时会留下永远
 * 停在 `pending` 的行：它既不会被后续写入更新，也不会被保留期清理回收，只会让
 * 日志列表永久显示一条「进行中」。
 *
 * 收尾为 `cancelled` 是唯诚实的选项：我们确实没有观察到这次请求的结果，
 * 既不能假装成功，也没有任何失败证据可以归因。
 */
function reconcileInterruptedRequests(db: DatabaseSync): void {
  const result = db.prepare("UPDATE request_logs SET status = 'cancelled' WHERE status = 'pending'").run()
  if (result.changes > 0) console.info(`[database] reconciled interrupted request logs count=${result.changes}`)
}
