import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import { LOCALES, type Locale } from '@common/i18n'
import { createAppTranslator } from '@common/i18n/catalogs'

/**
 * 把 OSW 维护的 env 文件**加载进登录 shell**。
 *
 * 背景：有一类客户端（Copilot CLI 的 BYOK、以及别处同类做法）把地址与凭证**只**读自进程环境，
 * 没有任何配置文件能承载它们——文件里写什么都没有用。对这类客户端，能改的就只有用户的 shell：
 * 由 OSW 维护一份 `KEY=VALUE` 的 env 文件，再在登录 shell 的启动文件里留一个**带哨兵标记**的
 * 区段去 `source` 它。
 *
 * 幂等性是这里的全部难点，也是为什么要有哨兵：
 *
 *   - 同一个块只该存在一份；重复 `source` 一次不会怎样，但一堆一模一样的块会污染用户的启动文件；
 *   - 块里的路径要能跟着改——用户把 env 文件挪走（或换了主目录）时，重写这一块即可，
 *     不必去猜哪一行是「我们上次写的」。
 *
 * 所以写入规则只有一条：**找得到哨兵就整段替换，找不到就追加**。绝不按内容猜、绝不插入第二块。
 * 块之外的内容一字不动——那是用户自己的启动脚本。
 */

/** 哨兵：`upsertManagedBlock` 靠它定位自己上次写下的那一段。跨平台共用同一对，便于迁移与识别。 */
const BLOCK_START = '# >>> osw managed env >>>'
const BLOCK_END = '# <<< osw managed env <<<'

export type ShellPlatform = 'posix' | 'windows'

/** 当前平台走哪套加载机制（PowerShell profile / POSIX 启动文件）。 */
export function currentShellPlatform(): ShellPlatform {
  return process.platform === 'win32' ? 'windows' : 'posix'
}

/**
 * 登录 shell 启动文件的候选顺序（越靠前越优先）。
 *
 * 选择规则：**优先改写已经存在的那一个**——用户实际在用的启动文件才是唯一有效的落点；
 * 一个都不存在时才新建排在最前的那个（macOS / 现代 Linux 的默认 shell 是 zsh，所以默认落在
 * `.zshrc`；`$SHELL` 指明是 bash 时把 bash 的启动文件排到前面）。
 *
 * 不做「探测这台机器有没有 zsh」这种猜测：`$SHELL` 已经说明了用户登录后进的是哪个 shell，
 * 拿它排优先级比扫一遍 PATH 更靠谱，也不会在测试里依赖真实环境。
 */
export function shellProfileCandidates(platform: ShellPlatform, home: string, env: NodeJS.ProcessEnv): string[] {
  // 路径必须按**入参指定的平台**拼，不能借宿主的 `path.join`：第二个参数是显式的 `platform`，
  // 「在 Windows 上算 POSIX 启动文件」是这个函数的正常用法，而 `join` 只会给宿主的分隔符——
  // 于是 `shellProfileCandidates('posix', '/Users/me', …)` 在 Windows 上产出 `\Users\me\.zshrc`，
  // 一个在任何平台都不存在的路径。（这个函数的消费者 `defaultShellProfileCandidates` 传的是
  // 当前平台，所以线上看不出来；但它的契约里 `platform` 是参数，就得按参数走。）
  const join = platform === 'windows' ? win32.join : posix.join

  if (platform === 'windows') {
    // PowerShell 的 `$PROFILE` 默认落在 `我的文档` 下，分 PowerShell 7（PowerShell）与
    // 旧版 Windows PowerShell 两处；两个都列，优先用户实际存在的那个。
    const documents = join(home, 'Documents')
    return [
      join(documents, 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
      join(documents, 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'),
    ]
  }

  const zsh = [join(home, '.zshrc')]
  // 登录 bash 读 `.bash_profile`（macOS）/`.profile`，交互式非登录读 `.bashrc`；
  // 两个都列，让「存在哪个就改哪个」自己选对。
  const bash = [join(home, '.bash_profile'), join(home, '.bashrc')]
  const fallback = [join(home, '.profile')]

  const shell = (env.SHELL ?? '').toLowerCase()
  if (shell.includes('bash')) return [...bash, ...zsh, ...fallback]
  return [...zsh, ...bash, ...fallback]
}

/**
 * env 文件顶部的说明，按当前语言生成。
 *
 * 这份文件的读者是**误打误撞打开它的用户**，所以要说清三件事：谁生成的、怎么被加载的、为什么别手改。
 * 每一行都以 `#` 开头——它是一份 shell env 文件，`#` 才是合法注释，其他写法都会让 shell 报错。
 *
 * 幂等性依赖的是「整段永远出现在文件最前面、且可被识别」：写入前先把**任意语言**的旧抬头剥掉，
 * 再拼上当前语言的新抬头（见 `service.ts` 的 `withEnvFileHeader`）。所以即使文件是上一个语言写的，
 * 也不会叠加出两段抬头。
 */
export function envFileHeader(locale: Locale): string {
  const t = createAppTranslator(locale)
  return [
    t('clientConfig.envFile.header.title'),
    '#',
    t('clientConfig.envFile.header.delivery'),
    '#',
    t('clientConfig.envFile.header.loading'),
    '#',
    t('clientConfig.envFile.header.rewritten'),
  ].join('\n')
}

/**
 * 剥掉文件开头**任意语言**的 OSW 抬头，返回剩下的正文（抬头与正文之间的空行一并去掉）。
 *
 * 为什么认全部语言而不是只认当前语言：用户换了界面语言后重写同一份文件，只认当前语言的抬头时，
 * 上一语言的抬头会被当成「用户自己写的内容」原样留下，于是文件里叠出两段抬头。认全语言才能
 * 先剥后写，把语言切换处理成一次普通的「替换抬头」。
 */
export function stripEnvFileHeader(content: string): string {
  for (const locale of LOCALES) {
    const header = envFileHeader(locale)
    if (content === header) return ''
    if (content.startsWith(`${header}\n`)) {
      const rest = content.slice(header.length + 1)
      // 抬头与正文之间有一个分隔空行（见 `service.ts` 的 `withEnvFileHeader`）：一并去掉，
      // 否则每次重写都会多留一行空的。
      return rest.startsWith('\n') ? rest.slice(1) : rest
    }
  }
  return content
}

/** 一条要进进程环境的键值。名字就是环境变量名（`.env` 里 `KEY=VALUE` 的 `KEY`）。 */
export interface ManagedEnvEntry {
  name: string
  value: string
}

/**
 * 生成哨兵区段的内容。
 *
 * POSIX 用 `.`（点命令）而不是 `source`：`.zshrc`/`.bashrc`/`.profile` 都可能是被 `sh` 读到的，
 * 而 `.` 在两个 shell 里都可用；POSIX 的 `.` 按**内容**解析文件，与扩展名无关，所以直接点源
 * `osw.env` 是安全的。
 *
 * Windows 则**不能**点源：Windows PowerShell 的 `.` 只对 `.ps1` 这类脚本文件有效，其余扩展名会被
 * 转交 ShellExecute「用默认程序打开文件」。`osw.env` 在装了 VS Code 的机器上关联到 `Code.exe`，
 * 于是每开一个终端就多拉起一个编辑器窗口（继承当前控制台，把主进程日志刷满终端），
 * 而 `KEY=VALUE` 本身也不是合法 PowerShell 语法，变量一个都没设上。
 *
 * 所以 Windows 侧**不走文件**：要设的键就是客户端定义里那几个（Copilot CLI 的三个
 * `COPILOT_PROVIDER_*` / `COPILOT_MODEL`），值在写入时就已经知道，直接一行一个
 * `SetEnvironmentVariable` 内联进 profile ——比让 PowerShell 去读文件、拆 `KEY=VALUE`、
 * 反解引号简单得多，也少一整类解析失败的可能。
 */
export function managedBlock(platform: ShellPlatform, envPaths: readonly string[], entries: readonly ManagedEnvEntry[]): string {
  return platform === 'windows' ? windowsManagedBlock(entries) : posixManagedBlock(envPaths)
}

function posixManagedBlock(envPaths: readonly string[]): string {
  const lines = envPaths.map(envPath => `[ -f "${envPath}" ] && . "${envPath}"`)
  return [BLOCK_START, ...lines, BLOCK_END].join('\n')
}

/**
 * PowerShell 侧的加载：每个变量一行，值用单引号字面量写死。
 *
 * 为什么不做「读文件再解析」：键是注册表里固定的那几个，值是写入时现成的，没有必要让
 * profile 每次开终端都去读一遍文件、拆 `KEY=VALUE`、再反解转义——那是把自己写出的格式
 * 又当成外部输入来解析（多一层可能出错的地方，也多一屏看不懂的代码）。
 *
 * 代价是值（含 API Key）会落在 profile 里；它已经是同一份明文，且 env 文件仍在原处由
 * 别处读取，两者由同一次写入维护，不会各说各话。
 */
function windowsManagedBlock(entries: readonly ManagedEnvEntry[]): string {
  const lines = entries.map(entry => `[Environment]::SetEnvironmentVariable(${powerShellLiteral(entry.name)}, ${powerShellLiteral(entry.value)}, 'Process')`)
  return [BLOCK_START, ...lines, BLOCK_END].join('\n')
}

/** PowerShell 单引号字符串里唯一的转义是 `''`——其余字符（含 `$`、`"`、`\`）都是字面量。 */
function powerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * 把哨兵区段写进启动文件文本：**找到就整段替换，找不到就追加**。
 *
 * 纯函数（只吃文本、只吐文本），文件读写留给调用方——这样幂等规则能单独测，
 * 不必真的去改用户的 `~/.zshrc`。
 */
export function upsertManagedBlock(text: string, block: string): string {
  const lines = text.split('\n')
  const start = lines.indexOf(BLOCK_START)
  const end = lines.indexOf(BLOCK_END)

  if (start >= 0 && end > start) {
    // 替换区间连同结尾那一行；后面原样保留。
    const before = lines.slice(0, start)
    const after = lines.slice(end + 1)
    return [...before, ...block.split('\n'), ...after].join('\n')
  }

  // 没找到（或只有半个哨兵——被人手删了半截）：追加一段，与原文之间留一个空行。
  if (text === '') return `${block}\n`
  const separator = text.endsWith('\n') ? '' : '\n'
  return `${text}${separator}\n${block}\n`
}

/** 启动文件文本里是否已经有我们写下的哨兵区段。 */
export function hasManagedBlock(text: string): boolean {
  const lines = text.split('\n')
  return lines.includes(BLOCK_START) && lines.includes(BLOCK_END)
}

/** 定位要写入的启动文件：存在的文件里挑优先级最高的那个，都不存在就取第一候选。 */
export function resolveShellProfilePath(existingPaths: readonly string[], candidates: readonly string[]): string {
  const existing = new Set(existingPaths)
  return candidates.find(candidate => existing.has(candidate)) ?? candidates[0]!
}

/** 当前用户的默认启动文件候选（供 service 读取磁盘状态后选择）。 */
export function defaultShellProfileCandidates(): string[] {
  return shellProfileCandidates(currentShellPlatform(), homedir(), process.env)
}
