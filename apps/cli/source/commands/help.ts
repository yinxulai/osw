/**
 * `--help` 的输出。
 *
 * 左列（旗标、取值占位、命令名）是**代码**，来自本文件而不是目录；取值的默认值来自
 * `host.ts` 的预设与平台默认数据目录，与真正启动时算出来的那份一致，
 * 避免帮助里写一套、实际跑另一套。
 *
 * 列宽只按左列算（都是 ASCII 定宽），所以中英文目录各占一行也不会错位。
 */

import type { TranslateParams } from '@common/i18n'
import { getRuntimeProfile } from '@common/runtime-profile'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { cliTranslator } from '../native-i18n'
import { CLI_RUNTIME_ENVIRONMENT, defaultDataDirectory } from '../host'
import { CLI_COMMANDS, type CliCommand } from '../options'

const OPTION_COLUMN_WIDTH = 26
const COMMAND_COLUMN_WIDTH = 9

const COMMAND_KEYS: Record<CliCommand, UiCatalogKey> = {
  start: 'native.cli.command.start',
  stop: 'native.cli.command.stop',
  status: 'native.cli.command.status',
  user: 'native.cli.command.user',
  version: 'native.cli.command.version',
}

interface OptionRow {
  flag: string
  key: UiCatalogKey
  params?: TranslateParams
}

export function renderHelp(): string {
  const t = cliTranslator()
  const profile = getRuntimeProfile(CLI_RUNTIME_ENVIRONMENT)
  const defaultHost = '127.0.0.1'

  const optionRows: OptionRow[] = [
    { flag: '-h, --help', key: 'native.cli.option.help' },
    { flag: '-v, --version', key: 'native.cli.option.version' },
    { flag: '--data-dir <path>', key: 'native.cli.option.dataDir', params: { default: defaultDataDirectory() } },
    { flag: '--host <host>', key: 'native.cli.option.host', params: { default: defaultHost } },
    {
      flag: '--management-host <host>',
      key: 'native.cli.option.managementHost',
      params: { default: defaultHost },
    },
    { flag: '--proxy-port <port>', key: 'native.cli.option.proxyPort', params: { default: profile.proxyPort } },
    {
      flag: '--management-port <port>',
      key: 'native.cli.option.managementPort',
      params: { default: profile.managementPort },
    },
    { flag: '--web', key: 'native.cli.option.web' },
    { flag: '--no-web', key: 'native.cli.option.noWeb' },
    { flag: '--json', key: 'native.cli.option.json' },
    { flag: '--password-stdin', key: 'native.cli.option.passwordStdin' },
  ]

  const lines: string[] = [
    t('native.cli.usage'),
    '',
    t('native.cli.commands'),
    ...CLI_COMMANDS.map(command =>
      `  ${command.padEnd(COMMAND_COLUMN_WIDTH)}${t(COMMAND_KEYS[command])}`,
    ),
    '',
    t('native.cli.options'),
    ...optionRows.map(row => `  ${row.flag.padEnd(OPTION_COLUMN_WIDTH)}${t(row.key, row.params)}`),
    '',
    // 管理面以前固定只监听回环、也没有鉴权，那时这里写的是「想远程访问请走 SSH 隧道」。
    // 现在管理面可以监听别的地址，但**默认要求登录**——把这条说在明处，比让人
    // 开了 `--management-host 0.0.0.0` 之后才发现要账号好得多。
    `  ${t('native.cli.managementAuthHint')}`,
  ]

  return lines.join('\n')
}
