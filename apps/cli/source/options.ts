/**
 * 命令行参数解析。
 *
 * 纯函数：不读环境变量、不碰文件系统、不写终端。错误也是**数据**——目录 key 加插值参数，
 * 而不是拼好的句子。解析器不该知道当前说的是哪种语言，句子由入口用取词函数渲染
 * （见 apps/docs/specs/platform/packaging.md §5.6：终端文案与界面文案共用同一份目录）。
 */

import type { TranslateParams } from '@common/i18n'
import type { UiCatalogKey } from '@common/i18n/catalogs'

export const CLI_COMMANDS = ['start', 'stop', 'status', 'version', 'user'] as const

export type CliCommand = (typeof CLI_COMMANDS)[number]

export interface CliArguments {
  /** 没给命令时是 `start`：`osw` 等价于 `osw start`。 */
  command: CliCommand
  /** `-h` / `--help`，任何位置出现都优先于其它一切。 */
  help: boolean
  /** `-v` / `--version`。 */
  version: boolean
  /** `null` 表示没传，由 `host.ts` 用平台默认数据目录补。 */
  dataDir: string | null
  /** 代理监听地址。 */
  host: string | null
  /**
   * 管理服务监听地址。
   *
   * 默认 `127.0.0.1`（只本机可达）。给成别的地址就是「装到服务器上给别人用」的形态，
   * 此时管理面默认要求登录——那条缺省由 core 按监听地址算出来（见
   * `packages/core/source/runtime/server-runtime.ts`），命令行不重复判一遍。
   */
  managementHost: string | null
  proxyPort: number | null
  managementPort: number | null
  /** 是否托管控制台产物，默认开；`--web` / `--no-web` 覆盖。 */
  serveWeb: boolean
  /** `--json`：机器可读输出。只对 `status` 有意义，由入口校验（见 `index.ts`）。 */
  json: boolean
  /** `user` 命令的位置参数：`['add', 'alice']`。其它命令一定为空。 */
  positionals: string[]
  /** `user add` 的口令从标准输入读，不交互、不回显。适合脚本与容器初始化。 */
  passwordStdin: boolean
}

export interface ArgumentError {
  key: UiCatalogKey
  params: TranslateParams
}

export type ParseResult = { ok: true; values: CliArguments } | { ok: false; error: ArgumentError }

export function parseArguments(argv: readonly string[]): ParseResult {
  const values: CliArguments = {
    command: 'start',
    help: false,
    version: false,
    dataDir: null,
    host: null,
    managementHost: null,
    proxyPort: null,
    managementPort: null,
    serveWeb: true,
    json: false,
    positionals: [],
    passwordStdin: false,
  }

  const fail = (key: UiCatalogKey, params: TranslateParams): ParseResult => ({ ok: false, error: { key, params } })

  let command: CliCommand | null = null
  let index = 0

  while (index < argv.length) {
    const token = argv[index]
    if (token === undefined) break
    index += 1

    // `--` 只是「后面不再有选项」的仪式性分隔符：这里没有「取值以 `-` 开头」的选项，
    // 所以它本身被忽略，但 `--` 之后的位置参数仍按位置参数处理。
    if (token === '--') continue

    if (!token.startsWith('-')) {
      // `user` 是本 CLI 唯带子命令的命令（`user add alice`），它的位置参数由命令自己解释；
      // 其余命令多出来的位置参数通常是 `osw start extra` 这类手误，静默忽略会让人以为生效了。
      if (command === null) {
        if (!isCommand(token)) return fail('native.cli.error.unknownCommand', { command: token })
        command = token
        continue
      }
      if (command !== 'user') return fail('native.cli.error.unknownCommand', { command: token })
      values.positionals.push(token)
      continue
    }

    // `--option=value` 与 `--option value` 都收：脚本里两种写法都很常见。
    const separator = token.indexOf('=')
    const name = separator === -1 ? token : token.slice(0, separator)
    const inlineValue = separator === -1 ? null : token.slice(separator + 1)

    if (name === '-h' || name === '--help' || name === '-v' || name === '--version') {
      if (inlineValue !== null) return fail('native.cli.error.unknownOption', { option: token })
      if (name === '-h' || name === '--help') values.help = true
      else values.version = true
      continue
    }

    if (name === '--web' || name === '--no-web') {
      if (inlineValue !== null) return fail('native.cli.error.unknownOption', { option: token })
      values.serveWeb = name === '--web'
      continue
    }

    if (name === '--json') {
      if (inlineValue !== null) return fail('native.cli.error.unknownOption', { option: token })
      values.json = true
      continue
    }

    if (name === '--password-stdin') {
      if (inlineValue !== null) return fail('native.cli.error.unknownOption', { option: token })
      values.passwordStdin = true
      continue
    }

    if (name !== '--data-dir' && name !== '--host' && name !== '--management-host' && name !== '--proxy-port' && name !== '--management-port') {
      return fail('native.cli.error.unknownOption', { option: name })
    }

    const raw = inlineValue ?? argv[index]
    if (raw === undefined || raw === '') return fail('native.cli.error.missingValue', { option: name })
    if (inlineValue === null) index += 1

    if (name === '--data-dir') {
      values.dataDir = raw
      continue
    }
    if (name === '--host') {
      values.host = raw
      continue
    }
    if (name === '--management-host') {
      values.managementHost = raw
      continue
    }

    const port = parsePort(raw)
    if (port === null) return fail('native.cli.error.invalidPort', { option: name, value: raw })
    if (name === '--proxy-port') values.proxyPort = port
    else values.managementPort = port
  }

  if (command !== null) values.command = command
  return { ok: true, values }
}

function isCommand(value: string): value is CliCommand {
  return (CLI_COMMANDS as readonly string[]).includes(value)
}

/** 只认十进制整数写法：`0x1f90`、`1e4`、` 80` 一律拒绝，避免端口被解析成意外的值。 */
function parsePort(raw: string): number | null {
  if (!/^[0-9]{1,5}$/.test(raw)) return null
  const port = Number(raw)
  return port >= 1 && port <= 65535 ? port : null
}
