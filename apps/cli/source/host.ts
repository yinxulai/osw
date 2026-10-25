/**
 * 宿主适配：命令行侧的平台差异都收在这里。
 *
 * 参数解析（`options.ts`）与业务流程（`commands/`）里都不该出现 `process.platform`；
 * 需要平台知识时就调这里的函数，这样「Windows 上数据目录在哪」只有一个答案。
 */

import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getRuntimeProfile, type RuntimeEnvironment } from '@common/runtime-profile'

/**
 * 命令行形态固定跑在 production 档预设上。
 *
 * 桌面形态靠 `VITE_DEV_SERVER_URL` 判断自己是不是开发运行，那时数据目录会换成
 * `.osw-development`、端口换成 19300/19301；命令行没有「开发服务器」这个输入，
 * 所以只有一个答案。
 *
 * 这是**唯一**一处选择：数据目录名与默认端口都从这一档预设里取。别处再写一遍
 * `'production'` 或者写死一个目录名，都会把「两种形态共用同一份数据」这件事写坏
 * （`apps/docs/specs/platform/packaging.md` §5.5）。
 */
export const CLI_RUNTIME_ENVIRONMENT: RuntimeEnvironment = 'production'

/**
 * 指定数据目录的环境变量。
 *
 * 为什么需要它：`--data-dir` 得写在下一次启动的命令行里，而「装到服务器上」这种形态
 * 下启动命令往往不由人手输——它落在 systemd unit、docker run、supervisor 配置里，
 * 那些地方更习惯用环境变量传位置。两种情况又不能让用户二选一：`--data-dir` 是显式
 * 参数，环境变量是环境（优先级见 `resolveDataDirectory`）。
 *
 * 命名与 `OSW_SECRET_KEY`（`secret-store.ts`）对齐：同属「用环境替代落盘文件」的一类
 * 逃逸口，供容器/CI 使用。
 */
export const DATA_DIRECTORY_ENVIRONMENT_VARIABLE = 'OSW_DATA_DIR'

/**
 * 平台默认数据目录：`<用户主目录>/<预设数据目录名>`。
 *
 * 与桌面形态**同名同址**（`apps/docs/specs/platform/packaging.md` §5.5）：两种形态默认共用同一份配置与
 * 同一对数据库文件，这样「先用命令行跑起来、再开桌面端」不会看到两套空数据。
 *
 * 位置选在**用户主目录**而不是各平台的应用数据目录（`%APPDATA%` / `Application Support` /
 * `$XDG_CONFIG_HOME`）：数据目录的摆放规矩三个平台各一套，而这里真正的诉求只是「一个用户
 * 一份数据」，主目录对三个平台是同一个答案。目录名走预设而不是写死一个字面量——Linux 上
 * 曾经因此分叉成 `osw`（小写，看着更像 XDG 惯例）与桌面形态的 `OSW`，
 * 两个目录各自有半份数据。
 *
 * 三个平台都不新增**平台专属**的环境变量（`%APPDATA%` / `$XDG_CONFIG_HOME` 之类不参与判断）：
 * 改位置只有两条路——`--data-dir` 与 `OSW_DATA_DIR`。后者是为「启动命令不由人手输」的
 * 形态准备的（systemd unit、docker run、supervisor），见 `DATA_DIRECTORY_ENVIRONMENT_VARIABLE`。
 */
export function defaultDataDirectory(): string {
  return path.join(os.homedir(), getRuntimeProfile(CLI_RUNTIME_ENVIRONMENT).dataDirectoryName)
}

/**
 * 环境变量给的目录；没设或只给了空白时返回 `null`（当作没设）。
 *
 * 空白串必须当成「没设」而不是「当前目录」：`OSW_DATA_DIR=` 这种写法在
 * systemd 与 shell 里都很常见，把它 `path.resolve('')` 成 `process.cwd()` 会让服务
 * 悄悄在根目录或 `/` 下建库。
 */
function dataDirectoryFromEnvironment(): string | null {
  const fromEnvironment = process.env[DATA_DIRECTORY_ENVIRONMENT_VARIABLE]?.trim()
  return fromEnvironment ? path.resolve(fromEnvironment) : null
}

/** 用户在帮助里看到的默认值：环境变量优先，否则平台默认目录。 */
export function effectiveDefaultDataDirectory(): string {
  return dataDirectoryFromEnvironment() ?? defaultDataDirectory()
}

/**
 * 数据目录的最终取值，优先级从高到低：
 *
 * 1. `--data-dir`（显式参数，转成绝对路径）
 * 2. `OSW_DATA_DIR`（环境，同样转成绝对路径）
 * 3. `<用户主目录>/<预设数据目录名>`
 *
 * 显式参数压过环境：同一台机器上 `OSW_DATA_DIR` 常常是全局设的，而
 * `osw start --data-dir /tmp/x` 是「就这一次」的意思，后者才该赢。
 */
export function resolveDataDirectory(input: string | null): string {
  if (input !== null) return path.resolve(input)
  return effectiveDefaultDataDirectory()
}

/**
 * 控制台静态产物的根目录：包内的 `output/web`。
 *
 * 用 `import.meta.url` 而不是 `import.meta.dirname`：Vite 会把模块拆进分包，
 * 两个形态（入口/分包）都要求**平铺**在 `output/` 下，`./web` 才指向同一个目录
 * （`vite.config.ts` 里 `chunkFileNames` 保持平铺就是为它）。这是「按固定层数定位资源」
 * 的一处假设，所以只在 `--web` 时才解析，并且由 `commands/start.ts` 校验 `index.html`
 * 是否真的在——缺产物时报一句能看懂的错，而不是启动一个打开是空白页的服务。
 *
 * 刻意不写 `new URL('./web', import.meta.url)`：Vite 默认的构建环境叫 client，
 * 它会试着把这种写法当成资源引用去解析（`apps/app/vite.shared.ts` 里对 `process.env`
 * 的记录是同一类问题）。
 */
export function consoleWebRoot(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'web')
}

/**
 * 把监听地址转成「可以连过去」的地址。
 *
 * 通配地址不是可连接地址：`0.0.0.0` / `::` 要回落成回环地址才连得上（桌面端同一条规则，
 * 见 `apps/docs/specs/platform/desktop.md`）。IPv6 字面量在 URL 里要加方括号、在 `net.connect` 里不能加，
 * 所以这里是**去方括号**的那个方向，加括号由 `formatHostForDisplay` 负责。
 */
export function connectHost(host: string): string {
  if (host === '0.0.0.0') return '127.0.0.1'
  if (host === '::' || host === '::0' || host === '[::]') return '::1'
  if (host.startsWith('[') && host.endsWith(']')) return host.slice(1, -1)
  return host
}

/** 拼 `主机:端口` 里的主机段：显示用，IPv6 字面量补上方括号。 */
export function formatHostForDisplay(host: string): string {
  const target = connectHost(host)
  return target.includes(':') ? `[${target}]` : target
}

/**
 * 监听地址是否只对本机可达。
 *
 * 用于「把代理暴露给了整个局域网」这件事的安全提示（`commands/start.ts`）：判断必须落在
 * **监听地址**上，而不是可连接地址——`0.0.0.0` 归一化成 `127.0.0.1` 之后看着像回环，
 * 实际是全网可达。所以这里刻意不复用 `connectHost`。
 *
 * `localhost` 也算回环：名字解析到哪儿由系统决定，但按用户意图它就是「本机」。
 */
export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized === 'localhost' || normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true
  if (normalized.startsWith('127.')) return true
  // IPv4 映射地址（`::ffff:127.0.0.1`）：双栈监听时回环请求常见的形态。
  return normalized.startsWith('::ffff:') && normalized.slice('::ffff:'.length).startsWith('127.')
}

/** 拼 `主机:端口`。地址类输出统一走它，方括号转义只在这里做一次。 */
export function formatEndpoint(host: string, port: number): string {
  return `${formatHostForDisplay(host)}:${port}`
}

/** 拼服务地址。 */
export function formatUrl(host: string, port: number): string {
  return `http://${formatEndpoint(host, port)}`
}
