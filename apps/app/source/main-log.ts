/**
 * 主进程落盘日志。
 *
 * 主进程的 `console` 只有一条出路：`log-forwarder.ts` 把它送过 RPC（`logs.write`），由服务
 * 进程落进 `runtime_logs`。但服务进程**不在**的那些时刻——启动的最早几毫秒、崩溃后的重启
 * 间隙、正在收尾退出——那条 RPC 没有落点，`log-forwarder` 只能把行攒在内存里（上限 500 行，
 * 满了丢最早的）。而「应用整个消失」这类闪退，恰恰发生在这条通道最不牢靠的时刻：进程没了，
 * 内存里攒的行也随之蒸发，事后打开日志页面什么也看不到。
 *
 * 这个模块补上第二条、**不依赖任何其它进程**的通道：同步 append 到
 * `<数据目录>/logs/main.log`。进程无论怎么死，最后写进去的那几行都留在磁盘上。
 *
 * 三条约束：
 *   - **绝不反向影响主流程**。目录不可写、磁盘满、文件被删——任何一步失败都只吞掉。
 *     一个会因为写日志而崩的主进程，比少记几行糟得多。
 *   - **与 `log-forwarder` 互不干扰**。两者各自包一层 `console`，谁先装谁在内层，原样透传，
 *     同一行会被两条通道各记一次：一条进数据库（可查询），一条进文件（抗崩溃）。这是有意的
 *     冗余，代价是启动期几十行重复，换来的是「服务不在时也有据可查」。
 *   - **只记运行诊断**。正文、API Key、Authorization、Cookie 一律不进文件，与
 *     `docs/product/observability.md` 的口径一致；对象里的敏感键在这里再兜一层脱敏。
 *
 * 本模块**不 import electron**：目录由调用方传入，于是它可以在纯 Node 环境下单测。
 */

import fs from 'node:fs'
import path from 'node:path'

export type MainLogLevel = 'debug' | 'info' | 'warn' | 'error'

/** 单个日志文件的上限。超过就轮转一次，只保留一份 `.1` 备份。 */
const MAX_FILE_BYTES = 5 * 1024 * 1024

/** 单行消息里对象序列化后的截断长度，防止一次意外的大对象把文件写爆。 */
const MAX_ARG_LENGTH = 4_000

const LOG_DIRECTORY_NAME = 'logs'
const LOG_FILE_NAME = 'main.log'
const ROTATED_FILE_NAME = 'main.log.1'

/** 命中这些键名（大小写不敏感、含子串）的对象字段一律替换成 `[redacted]`。 */
const SENSITIVE_KEY_PATTERN = /authorization|api[-_]?key|cookie|token|password|passwd|secret|credential/i

let logDirectory: string | null = null
let logFilePath: string | null = null
let installed = false
let writtenBytes = 0
let quitReason: string | null = null
let heartbeatTimer: NodeJS.Timeout | null = null

/** console 方法到日志级别的映射，与 `log-forwarder.ts` 的 `LEVELS` 保持一致。 */
const LEVELS: ReadonlyArray<readonly [string, MainLogLevel]> = [
  ['log', 'info'],
  ['info', 'info'],
  ['warn', 'warn'],
  ['error', 'error'],
  ['debug', 'debug'],
]

function twoDigits(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** 本地时间戳。文件是给人看的，不用 ISO/UTC，方便直接和「几点几分发生的事」对上。 */
function formatTimestamp(date: Date): string {
  const y = date.getFullYear()
  const mo = twoDigits(date.getMonth() + 1)
  const d = twoDigits(date.getDate())
  const h = twoDigits(date.getHours())
  const mi = twoDigits(date.getMinutes())
  const s = twoDigits(date.getSeconds())
  const ms = String(date.getMilliseconds()).padStart(3, '0')
  return `${y}-${mo}-${d} ${h}:${mi}:${s}.${ms}`
}

/** 递归脱敏：只对普通对象/数组下钻，其它类型的值原样返回。 */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(item => redact(item, depth + 1))
  const source = value as Record<string, unknown>
  const output: Record<string, unknown> = {}
  for (const key of Object.keys(source)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : redact(source[key], depth + 1)
  }
  return output
}

/**
 * 把一行 console 参数压成字符串。
 *
 * 与 `log-forwarder.ts` / 核心的 `formatArgs` 同形，但这里多两层：对象先脱敏再序列化，
 * 单条结果超长就截断。重复一份而不是复用，是为了让 `main-log` 不依赖任何会拖进数据库
 * 模块的东西（理由同 `log-forwarder.ts`）。
 */
function formatArgs(args: unknown[]): string {
  return args
    .map(arg => {
      if (typeof arg === 'string') return arg
      if (arg instanceof Error) return arg.stack ?? arg.message
      try {
        return JSON.stringify(redact(arg))
      } catch {
        return String(arg)
      }
    })
    .join(' ')
    .slice(0, MAX_ARG_LENGTH)
}

/** 超过上限就把它挪成 `.1`（覆盖旧的备份），再从头写。 */
function rotateIfNeeded(): void {
  if (logFilePath === null) return
  try {
    if (!fs.existsSync(logFilePath)) return
    if (fs.statSync(logFilePath).size < MAX_FILE_BYTES) return
    const rotated = path.join(logDirectory as string, ROTATED_FILE_NAME)
    fs.rmSync(rotated, { force: true })
    fs.renameSync(logFilePath, rotated)
    writtenBytes = 0
  } catch {
    // 轮转失败不该影响继续写；大不了这个文件继续长大。
  }
}

/**
 * 写一行到文件。**同步**——这正是本模块存在的意义：异步写会在崩溃时丢掉缓冲区里还没落盘的行。
 *
 * 未安装（还没拿到目录）时静默返回：调用点遍布生命周期各处，不该要求它们判断是否已初始化。
 */
export function appendMainLog(level: MainLogLevel, message: string): void {
  const filePath = logFilePath
  if (filePath === null) return
  const prefix = `${formatTimestamp(new Date())} [pid ${process.pid}] [${level}] `
  // 多行消息（堆栈）逐行补前缀：文件按行 grep 时，每一行都能独立定位到时间与进程。
  const body = message.replace(/\r?\n/g, `\n${' '.repeat(prefix.length)}`)
  const line = `${prefix}${body}\n`
  try {
    fs.appendFileSync(filePath, line, 'utf8')
    writtenBytes += Buffer.byteLength(line)
    if (writtenBytes >= MAX_FILE_BYTES) rotateIfNeeded()
  } catch {
    // 磁盘满 / 目录被删：静默吞掉，绝不让日志把主流程带崩。
  }
}

/**
 * 记录退出原因。任何一处触发退出的路径都应该先调它，这样 `before-quit` / `process.exit`
 * 那一刻能把「谁要退出、为什么」写进文件——这正是闪退事后最想知道的一句话。
 */
export function noteQuitReason(reason: string): void {
  quitReason = reason
  appendMainLog('info', `[lifecycle] quit requested reason=${reason}`)
}

/** 读取当前记录的退出原因（可能为 `null`：进程是被外部信号/系统杀掉的，没有经过任何调用点）。 */
export function getQuitReason(): string | null {
  return quitReason
}

/** 给诊断信息用的日志文件路径；未安装时为 `null`。 */
export function mainLogFilePath(): string | null {
  return logFilePath
}

/**
 * 心跳：定期往文件里打一行「还活着」。
 *
 * 闪退最缺的是一条时间线。有了心跳，事后就能从最后一条心跳和它后面的行判断出进程死在哪一刻、
 * 死时内存多大——是启动期就没了，还是跑了几个小时之后。间隔取 60 秒，一行几十字节，无感。
 */
export function startMainHeartbeat(intervalMilliseconds = 60_000): void {
  if (heartbeatTimer !== null) return
  heartbeatTimer = setInterval(() => {
    const memory = process.memoryUsage()
    appendMainLog(
      'debug',
      `[heartbeat] uptime=${Math.round(process.uptime())}s rss=${Math.round(memory.rss / 1024 / 1024)}mb heapUsed=${Math.round(memory.heapUsed / 1024 / 1024)}mb`,
    )
  }, intervalMilliseconds)
  // 心跳不该拖住退出：Node 的默认行为是等所有 timer 结束，这里显式放开。
  heartbeatTimer.unref()
}

export function stopMainHeartbeat(): void {
  if (heartbeatTimer === null) return
  clearInterval(heartbeatTimer)
  heartbeatTimer = null
}

/**
 * 安装捕获：接管 `console` 并写文件头。幂等，重复调用只生效第一次。
 *
 * 必须在**任何一行输出之前**调用（`index.ts` 里紧跟 `app.setPath('userData', ...)`），
 * 否则文件会缺掉最早、往往也最关键的那几行（比如启动横幅里的版本与数据目录）。
 */
export function installMainLogCapture(directory: string): void {
  if (installed) return
  installed = true

  logDirectory = path.join(directory, LOG_DIRECTORY_NAME)
  try {
    fs.mkdirSync(logDirectory, { recursive: true })
    logFilePath = path.join(logDirectory, LOG_FILE_NAME)
  } catch {
    // 目录建不出来（权限/磁盘）就退回「不落盘」，但 console 透传照旧。
    logDirectory = null
    logFilePath = null
  }

  rotateIfNeeded()
  appendMainLog(
    'info',
    `[lifecycle] main log started app=${process.versions.electron ? 'electron' : 'node'} pid=${process.pid} node=${process.versions.node} electron=${process.versions.electron ?? '-'}`,
  )

  const target = console as unknown as Record<string, (...args: unknown[]) => void>
  for (const [method, level] of LEVELS) {
    const original = target[method].bind(console)
    target[method] = (...args: unknown[]) => {
      appendMainLog(level, formatArgs(args))
      original(...args)
    }
  }

  // 最后一行最不容易丢：`exit` 是同步上下文，`appendFileSync` 恰好能在里面跑完。
  process.on('exit', code => {
    const reason = quitReason ?? 'unknown'
    appendMainLog('info', `[lifecycle] process exit code=${code} reason=${reason}`)
  })
  // `warning` 平时看不见，但 `MaxListenersExceededWarning` 这类正是长跑应用出问题的前兆。
  process.on('warning', warning => {
    appendMainLog('warn', `[process] ${warning.name}: ${warning.message}`)
  })
}
