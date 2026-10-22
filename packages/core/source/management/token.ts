/**
 * 管理 API 的**本次应用启动**凭证。
 *
 * 为什么需要它：管理 API 只监听回环，但「只监听回环」不等于访问控制——本机任意一个网页
 * 都能向 `127.0.0.1` 发请求，同源策略只挡「读响应」、不挡「发请求」。所以只有两层便宜的
 * 边界（CORS 白名单 + Host 校验）是不够的，必须有一个真正只有自家前端才知道的东西
 * （见 issue #76 与 apps/docs/specs/security-privacy.md 的「访问控制」）。
 *
 * 为什么是「每次启动随机生成」而不是持久化的密钥：
 *
 *   - 不需要任何「生成 / 轮换 / 吊销」的界面与设置项，也不存在「用户把它删了怎么办」；
 *   - 重启即失效，进程崩溃留下的文件在下次启动时会被整体覆盖，没有长期有效的秘密躺在磁盘上；
 *   - 用户永远不用看到或复制它，它只在三个自家进程之间流转。
 *
 * **谁来生成**：宿主，在应用启动时生成一次（`RuntimeConfig.managementToken`）。
 * 这里只提供生成函数与落盘/读取/删除三件事，core 自己**不**调用 `generateManagementToken`：
 * 桌面形态的核心服务跑在一个可能崩溃重启的独立进程里，如果每重启一次就换一份，主进程
 * 手里那份立刻作废，渲染层随后的每一次请求都会 401。所以「一次应用启动」= 一份凭证。
 *
 * 落盘是**为了让另外两个自家进程拿到**（命令行 `stop` / `status`、无头截图入口），
 * 不是为了让用户去读。文件权限 0600，名字与 `runtime.json` 分开：那份文件是「谁在跑」的
 * 快照，凭证是另一种生命周期的东西（桌面形态根本没有 `runtime.json`，但仍然需要它）。
 */

import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export const MANAGEMENT_TOKEN_FILE_NAME = 'management.token'

/** 凭证请求头。名字带前缀，避免与将来可能出现的其他 `X-*` 头撞在一起。 */
export const MANAGEMENT_TOKEN_HEADER = 'x-osw-token'

/**
 * 生成一份新凭证：32 字节的随机量，base64url 编码（43 个字符，无需转义就能放进头部与
 * JSON 字符串）。
 *
 * 熵够不够不是这里的关键——攻击面是「本机网页猜不出来」而不是「抗离线爆破」，
 * 128 位就已经远超需要；选 32 字节只是因为它在任何编码里都不会引入格式麻烦。
 *
 * **调用方是宿主，且只在应用启动时调一次**。core 自己不调：它的 `startServer` 会在服务
 * 进程崩溃重启时再跑一遍，那不代表一次新的应用启动（见文件头）。
 */
export function generateManagementToken(): string {
  return randomBytes(32).toString('base64url')
}

export function managementTokenPath(dataDir: string): string {
  return path.join(dataDir, MANAGEMENT_TOKEN_FILE_NAME)
}

/**
 * 原子写 + 0600。
 *
 * 原子性同样是给读的一侧用的：`stop` 可能正好在启动写它的同一瞬间来读，宁可让它读到
 * 「还没有」，也不要读到半截凭证（那会被当成凭证不对，从而误报「管理服务拒绝请求」）。
 */
export async function writeManagementToken(dataDir: string, token: string): Promise<void> {
  const filePath = managementTokenPath(dataDir)
  await fs.mkdir(dataDir, { recursive: true })
  const temporaryPath = `${filePath}.tmp`
  await fs.writeFile(temporaryPath, token, { mode: 0o600, encoding: 'utf8' })
  await fs.rename(temporaryPath, filePath)
  // 覆盖一个已存在的文件时 `mode` 不生效（它只作用于创建），所以显式再紧一次权限。
  await fs.chmod(filePath, 0o600)
}

/** 读不出来一律返回 `null`：没有凭证的文件只意味着「这次调用不会成功」，不是异常。 */
export async function readManagementToken(dataDir: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(managementTokenPath(dataDir), 'utf8')
    const token = raw.trim()
    return token.length > 0 ? token : null
  } catch {
    return null
  }
}

export async function removeManagementToken(dataDir: string): Promise<void> {
  try {
    await fs.rm(managementTokenPath(dataDir))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
