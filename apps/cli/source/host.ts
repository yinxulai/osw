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
 * （`apps/docs/specs/packaging.md` §5.5）。
 */
export const CLI_RUNTIME_ENVIRONMENT: RuntimeEnvironment = 'production'

/**
 * 平台默认数据目录：`<用户主目录>/<预设数据目录名>`。
 *
 * 与桌面形态**同名同址**（`apps/docs/specs/packaging.md` §5.5）：两种形态默认共用同一份配置与
 * 同一对数据库文件，这样「先用命令行跑起来、再开桌面端」不会看到两套空数据。
 *
 * 位置选在**用户主目录**而不是各平台的应用数据目录（`%APPDATA%` / `Application Support` /
 * `$XDG_CONFIG_HOME`）：数据目录的摆放规矩三个平台各一套，而这里真正的诉求只是「一个用户
 * 一份数据」，主目录对三个平台是同一个答案。目录名走预设而不是写死一个字面量——Linux 上
 * 曾经因此分叉成 `osw`（小写，看着更像 XDG 惯例）与桌面形态的 `OSW`，
 * 两个目录各自有半份数据。
 *
 * 三个平台都不新增环境变量：用户改位置只能靠 `--data-dir`。
 */
export function defaultDataDirectory(): string {
  return path.join(os.homedir(), getRuntimeProfile(CLI_RUNTIME_ENVIRONMENT).dataDirectoryName)
}

/** 用户显式传的 `--data-dir` 一律转成绝对路径：之后的日志与运行时文件都按绝对路径说话。 */
export function resolveDataDirectory(input: string | null): string {
  return input === null ? defaultDataDirectory() : path.resolve(input)
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
 * 见 `apps/docs/specs/desktop.md`）。IPv6 字面量在 URL 里要加方括号、在 `net.connect` 里不能加，
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
