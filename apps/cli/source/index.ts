#!/usr/bin/env node
/**
 * 命令行入口：解析 → 分发 → 定退出码。
 *
 * 只做三件事，业务全在 `commands/`：
 *   1. 解析 argv（`options.ts`，纯函数）
 *   2. 用当前终端语言把解析错误渲染出来
 *   3. 把命令返回的退出码落成进程退出码
 *
 * 这里**不静态 import core**，也不静态 import core 的 settings：`node:sqlite` 是
 * Node 22.5+ 才有的内置模块，静态引用的后果是「版本太低」变成一条模块解析栈，
 * 而不是一句能看懂的提示（见 `commands/start.ts` 的探测与 `native-i18n.ts` 的注释）。
 *
 * 退出码：0 成功；1 执行失败（端口占用、连接不上等）；2 用法错误（未知命令/选项、取值非法）。
 */

import { parseArguments } from './options'
import { applySystemLocale, cliTranslator } from './native-i18n'
import { renderHelp } from './commands/help'
import { runStart } from './commands/start'
import { runStatus } from './commands/status'
import { runStop } from './commands/stop'
import { runUser } from './commands/user'

const USAGE_ERROR_EXIT_CODE = 2

async function main(argv: readonly string[]): Promise<number> {
  // 先定语言再解析：解析失败也要用正确的语言报错。
  applySystemLocale()

  const parsed = parseArguments(argv)
  if (!parsed.ok) {
    const t = cliTranslator()
    process.stderr.write(`${t(parsed.error.key, parsed.error.params)}\n`)
    process.stderr.write(`${t('native.cli.usage')}\n`)
    return USAGE_ERROR_EXIT_CODE
  }

  const values = parsed.values

  // `--help` / `--version` 优先于命令：`osw start --help` 想看的是帮助，
  // 不是把服务跑起来。
  if (values.help) {
    process.stdout.write(`${renderHelp()}\n`)
    return 0
  }
  if (values.version) {
    process.stdout.write(`${__CLI_VERSION__}\n`)
    return 0
  }

  // `--json` 只对 `status` 有意义。不静默忽略：写 `start --json` 的人多半以为自己会
  // 拿到 JSON，跑起来却不输出 JSON，比一句「这面旗标在这儿不能用」难查得多。
  if (values.json && values.command !== 'status') {
    process.stderr.write(`${cliTranslator()('native.cli.error.jsonNotApplicable', { command: values.command })}\n`)
    return USAGE_ERROR_EXIT_CODE
  }

  switch (values.command) {
    case 'start':
      return runStart(values)
    case 'stop':
      return runStop(values)
    case 'status':
      return runStatus(values)
    case 'user':
      return runUser(values)
    case 'version':
      // 只有版本号，没有前缀：它要能被脚本直接取用。
      process.stdout.write(`${__CLI_VERSION__}\n`)
      return 0
  }
}

/**
 * 收尾退出。
 *
 * 不直接 `process.exit()`：输出到管道时 `stdout` 是异步写，强退会把最后几行截掉
 * （`osw status` 恰好就是「输出几行然后立刻结束」的形状）。
 * 先设 `exitCode` 让进程自然收尾，同时挂一个 `unref` 的兜底定时器——
 * 它只在还有句柄占着事件循环时才会触发（例如 fetch 的连接池），自然退出时不起作用。
 */
function exitSoon(code: number): void {
  process.exitCode = code
  setTimeout(() => process.exit(code), 3_000).unref()
}

main(process.argv.slice(2))
  .then(exitSoon)
  .catch((error: unknown) => {
    // 走到这里说明命令本身抛了没接住的错（命令内部都该自己接住并给退出码）。
    // 保留栈：这种情况是代码缺陷，不是用户输入问题。
    console.error(error)
    exitSoon(1)
  })
