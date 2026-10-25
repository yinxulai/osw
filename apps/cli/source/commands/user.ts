/**
 * `user`：管理登录账号。
 *
 *   osw user list
 *   osw user add <username> [--password-stdin]
 *   osw user remove <username>
 *
 * 它**不走 HTTP**，直接开数据库写——理由有两条：
 *
 *   1. 它要能在服务没起来的时候用。服务器形态第一次部署时，服务因为「还没有账号」
 *      而拒绝监听（见 `packages/core/source/runtime/server-runtime.ts`），此时没有任何
 *      HTTP 接口可调，而「建第一个账号」恰恰是那一步的解锁动作。走 HTTP 就死锁了。
 *   2. 本机的数据库文件本来就是这个用户的数据，能读到它的进程有权改它。多绕一层
 *      管理 API 只是多一份要维护的协议。
 *
 * 口令怎么进来：**默认交互输入**（不回显），`--password-stdin` 从标准输入读一行，给
 * 脚本与容器初始化用。刻意没有 `--password <值>`：命令行参数会留在 shell 历史与
 * `ps` 的输出里，而这是这台服务器的管理口令。
 */

import { cliTranslator } from '../native-i18n'
import { describeError } from '../errors'
import { resolveDataDirectory } from '../host'
import type { CliArguments } from '../options'

export async function runUser(values: CliArguments): Promise<number> {
  const t = cliTranslator()
  const action = values.positionals[0] ?? 'list'
  const username = values.positionals[1] ?? null

  if (!(await nodeSqliteAvailable())) {
    console.error(t('native.cli.error.sqliteTitle'))
    console.error(t('native.cli.error.sqliteBody', { version: process.versions.node }))
    return 1
  }

  if (action === 'add' && username === null) {
    console.error(t('native.cli.user.missingUsername'))
    return 2
  }
  if (action === 'remove' && username === null) {
    console.error(t('native.cli.user.missingUsername'))
    return 2
  }
  if (action !== 'add' && action !== 'list' && action !== 'remove') {
    console.error(t('native.cli.user.unknownAction', { action }))
    return 2
  }

  // 动态 import：core 的数据库层静态引用 `node:sqlite`，静态加载会让「Node 版本不够」
  // 变成一坨模块解析栈（与 `commands/start.ts` 同一条理由）。
  const { initDatabases, closeDatabases } = await import('@server/database')
  const { createAccount, deleteAccount, listAccounts } = await import('@server/database/user-store')

  const dataDir = resolveDataDirectory(values.dataDir)
  try {
    await initDatabases(dataDir)
  } catch (error) {
    console.error(t('native.cli.user.databaseFailed', { message: describeError(error) }))
    return 1
  }

  try {
    if (action === 'list') return await list(dataDir)
    if (action === 'remove') return await remove(username as string, dataDir)
    return await add(username as string, values.passwordStdin, dataDir)
  } finally {
    await closeDatabases()
  }

  async function list(directory: string): Promise<number> {
    const accounts = await listAccounts()
    if (accounts.length === 0) {
      console.log(t('native.cli.user.empty', { dataDir: directory }))
      return 0
    }
    console.log(t('native.cli.user.listTitle'))
    for (const account of accounts) {
      // 布局固定：没有登录记录时用 `—` 占位，而不是少打一段（与 `status` 同一条规矩）。
      const lastLogin = account.lastLoginTime === null ? '—' : new Date(account.lastLoginTime).toISOString()
      console.log(`  ${account.username.padEnd(20)}${lastLogin}`)
    }
    console.log(t('native.cli.user.listHint', { dataDir: directory }))
    return 0
  }

  async function add(name: string, fromStdin: boolean, directory: string): Promise<number> {
    const password = fromStdin ? await readLineFromStdin() : await promptPassword()
    if (password === null) {
      console.error(t('native.cli.user.passwordMissing'))
      return 1
    }
    try {
      await createAccount(name, password)
    } catch (error) {
      console.error(t('native.cli.user.addFailed', { message: describeError(error) }))
      return 1
    }
    console.log(t('native.cli.user.added', { username: name, dataDir: directory }))
    console.log(t('native.cli.user.addedHint'))
    return 0
  }

  async function remove(name: string, directory: string): Promise<number> {
    const accounts = await listAccounts()
    const target = accounts.find(account => account.username === name)
    if (!target) {
      console.error(t('native.cli.user.notFound', { username: name }))
      return 1
    }
    try {
      await deleteAccount(target.id)
    } catch (error) {
      // 「最后一个不能删」是这里最常撞到的一条，存储层已经给了能看懂的领域错误。
      console.error(t('native.cli.user.removeFailed', { message: describeError(error) }))
      return 1
    }
    console.log(t('native.cli.user.removed', { username: name, dataDir: directory }))
    return 0
  }
}

/**
 * 从标准输入读一行。
 *
 * 用 `readline` 而不是 `process.stdin.read()`：后者在管道里可能一次只给半个分片，
 * 而且要自己处理换行。读完立刻关掉，否则进程会一直等 stdin 关闭而退不出去。
 */
async function readLineFromStdin(): Promise<string | null> {
  const { createInterface } = await import('node:readline')
  const reader = createInterface({ input: process.stdin, terminal: false })
  for await (const line of reader) {
    reader.close()
    return line.trim()
  }
  return null
}

/**
 * 交互式输入口令（不回显）。
 *
 * 没有 `readline` 的隐藏输入选项可用（那是终端的活），所以这里自己关回显：`raw` 模式下
 * 逐字符吃，只把 `\r` 当结束。刻意不做退格处理——`raw` 模式下退格是 `\x7f`，处理它是
 * 「实现一个行编辑器」，而这里要的只是「别让口令出现在屏幕上」。
 */
async function promptPassword(): Promise<string | null> {
  const { stdin, stdout } = process
  // 不是终端（被重定向）时读不到逐字符输入，直接退回按行读——用户显式给了
  // `--password-stdin` 的场合走不到这里。
  if (!stdin.isTTY) return readLineFromStdin()

  stdout.write(cliTranslator()('native.cli.user.passwordPrompt'))
  stdin.setRawMode(true)
  stdin.resume()

  return new Promise<string | null>(resolve => {
    let value = ''
    const finish = (result: string | null): void => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off('data', onData)
      stdout.write('\n')
      resolve(result)
    }
    const onData = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      // `Ctrl+C`：raw 模式下收不到 SIGINT，必须自己认。
      if (text.includes('\u0003')) {
        finish(null)
        return
      }
      if (text.includes('\r') || text.includes('\n')) {
        finish(value)
        return
      }
      value += text
    }
    stdin.on('data', onData)
  })
}

async function nodeSqliteAvailable(): Promise<boolean> {
  try {
    await import('node:sqlite')
    return true
  } catch {
    return false
  }
}
