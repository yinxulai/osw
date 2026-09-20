/**
 * 安装标识的本地读写。
 *
 * 它是数据目录里一个独立的小文件，与 `instance.lock`、`secrets.json` 同级，**不进配置数据库**：
 * 写进库里就会跟着用户配置一起被导出、被备份、被打进供应商包，而它既不是配置也不是业务数据。
 * 删掉这个文件的下一个行为是「换了一台新设备」——这是正确语义，也是用户重置身份的现成手段
 * （见 `docs/product/telemetry.md` §4）。
 *
 * 这个文件只负责「读到一个稳定的 UUID」，不做上报、不读设置。标识本身是**匿名**的：
 * 不派生、不哈希、不轮换，就直接发送这个 UUID——某个后端把它叫 `distinct_id`、
 * 另一个叫 `client_id`，都是那边的说法，不是这里的语义，所以这里只说「安装标识」。
 */

import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export const TELEMETRY_ID_FILE_NAME = 'telemetry-id'

/**
 * UUID 形状校验用的是**宽松**写法（不检查版本位与变体位）。
 *
 * 下游对标识只要求「UUID 形状」；这里卡得太死，会让一份手工改过的文件被当成损坏而去重算标识
 * ——那等于悄悄换了个身份，比放过一个不规范的 UUID 更糟。
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function telemetryIdPath(dataDir: string): string {
  return path.join(dataDir, TELEMETRY_ID_FILE_NAME)
}

/** 读现有的标识；文件不存在、读不动、内容不是 UUID 都返回 `null`。 */
export async function readTelemetryId(dataDir: string): Promise<string | null> {
  try {
    const raw = (await fs.readFile(telemetryIdPath(dataDir), 'utf8')).trim()
    return UUID_PATTERN.test(raw) ? raw.toLowerCase() : null
  } catch {
    return null
  }
}

/**
 * 取本机标识，没有就生成一个并落盘。
 *
 * **落盘失败时返回 `null`，而不是「用一个内存里的临时标识继续上报」。** 那样做的后果是每次启动
 * 都长出一个新安装，把「活跃安装数」变成「启动次数」——一份看起来正常的错误数据，比少一批数据
 * 有害得多。
 */
export async function loadOrCreateTelemetryId(dataDir: string): Promise<string | null> {
  const existing = await readTelemetryId(dataDir)
  if (existing !== null) return existing

  const created = randomUUID()
  try {
    await fs.mkdir(dataDir, { recursive: true })
    await fs.writeFile(telemetryIdPath(dataDir), `${created}\n`, { flag: 'wx', mode: 0o600 })
    return created
  } catch (error) {
    // `wx` 撞上了已经存在的文件：另一个进程刚写进去（桌面端与命令行共用数据目录时会这样）。
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return readTelemetryId(dataDir)
    console.debug('[telemetry] could not persist the install id', error)
    return null
  }
}
