/**
 * 凭证的**交付通道**：数据目录里的一个 `0600` 文件。
 *
 * 凭证本身每次启动随机生成（见 `./token.ts`），但校验是**无条件**的——管理 API 的每一条
 * `/api/*` 请求都必须带着它（见 `./gateway/access.ts`）。于是它必须有一条能让**同一用户的
 * 其他进程**拿到的路径，否则 `osw stop` / `osw status` 这些自家命令一条也发不出去。
 *
 * 为什么不写进 `runtime.json`（`apps/cli/source/runtime-state.ts`）：那份快照会被
 * `status --json` 原样打出去，凭证混在里面就等于进了 shell 历史、管道和用户的截图。
 * 分开一个文件，「给人看的快照」与「给程序用的秘密」各走各的路。
 *
 * ## 它挡得住谁、挡不住谁
 *
 * 挡得住：本机浏览器里的网页、沙箱内的应用、容器/WSL 里能连回环但读不到数据目录的进程、
 * **同机其他用户**（`0600` 只给属主）。
 *
 * 挡不住：**同一用户的**本机进程。它能读数据目录，也就能读这个文件——这不是疏漏，是
 * 边界本身的形状。给同用户进程设一道需要落在它自己可读位置的口令，只是把秘密换个地方
 * 放着。所以这里不声称「凭证能区分同用户的进程」，它只保证**一条没有例外的规则**：
 * 没有凭证，就没有 `/api/*`。
 *
 * ## 生命周期
 *
 * 写它的是管理服务的宿主进程（`./server.ts` 在 listen 成功之后写，`stopManagementServer`
 * 里删）。崩溃/被强杀的进程来不及删，留下的是一份**已经作废**的凭证：下一次启动会原子
 * 覆盖它，而它自己此刻既换不来访问权，也读不到任何东西。
 */

import fs from 'node:fs/promises'
import path from 'node:path'

export const MANAGEMENT_TOKEN_FILE_NAME = 'management.token'

export function managementTokenFilePath(dataDir: string): string {
  return path.join(dataDir, MANAGEMENT_TOKEN_FILE_NAME)
}

/**
 * 原子写，权限 `0600`。
 *
 * 先写 `.tmp` 再 rename：`stop` / `status` 可能在服务刚起来的瞬间就来读，让它读到「旧的
 * 完整内容」或「新的完整内容」，不能是一个写了一半的字符串（半个凭证换成 401，报出来的
 * 是「凭证不对」，与真实原因完全对不上）。
 *
 * `mode` 只在**创建**时生效，所以这里不依赖「覆盖时继承权限」——上一次留下的 `0600` 文件
 * 正好也是我们要的。
 */
export async function writeManagementToken(dataDir: string, token: string): Promise<void> {
  const filePath = managementTokenFilePath(dataDir)
  await fs.mkdir(dataDir, { recursive: true })
  const temporaryPath = `${filePath}.tmp`
  await fs.writeFile(temporaryPath, token, { mode: 0o600 })
  await fs.rename(temporaryPath, filePath)
}

/**
 * 读凭证。读不到返回 `null`。
 *
 * 「没有文件」是正常状态（服务没起来、或者已经干净退出），与 `runtime-state.ts` 同一套
 * 容错口径；权限之类的真异常往上抛，静默当成「没有」会把环境问题藏起来。
 *
 * `trim` 是防御性的：这个文件是人也能 `cat` 的，手工用 `echo` 造一份会带上换行。
 */
export async function readManagementToken(dataDir: string): Promise<string | null> {
  let raw: string
  try {
    raw = await fs.readFile(managementTokenFilePath(dataDir), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const token = raw.trim()
  return token.length === 0 ? null : token
}

/** 删除凭证文件。不存在不算错误——退出流程不该因为「本来就没有」而失败。 */
export async function removeManagementToken(dataDir: string): Promise<void> {
  try {
    await fs.rm(managementTokenFilePath(dataDir))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
