/**
 * 运行日志的**模块归属**。
 *
 * 写日志的地方都按 `console.<level>('[前缀] 正文')` 的约定带一个方括号前缀，这个模块把
 * 前缀收敛到 `LogScope` 这颗产品能讲的树上。收敛是**一次性写进数据库**的：`runtime_logs`
 * 存的是解析后的模块，而不是每次读取时现算——前缀是会在重构里改的自由字符串，账要记在
 * 写入那一刻。
 *
 * 只认**行首**的方括号前缀：正文里出现的 `[xxx]`（例如 `value=[1,2]`）不算模块。前缀没
 * 登记、或者压根没有前缀，一律归 `other` —— 宁可漏判成一个兜底桶，也不要靠猜把一行算到
 * 别的模块头上。
 */

import type { LogScope } from '@common/schemas'

interface ScopeRule {
  /**
   * 精确匹配的完整前缀（不含方括号）。
   *
   * 用精确匹配而不是 `startsWith`：`proxy` 与 `proxy-lifecycle`、`management` 与
   * `management-lifecycle` 必须各归各的，前缀匹配会把后者吞进前者。
   */
  prefix: string
  scope: LogScope
}

/**
 * 前缀 → 模块。新增一个写日志的前缀时在这里登记；没登记的会落到 `other`，不会报错。
 *
 * 按「它属于哪块产品能力」分，不按代码目录分——`tray` / `updater` 这些文件夹不在服务里，
 * 但它们都长在**桌面宿主进程**上，界面上归一类才有意义。
 */
const RULES: ScopeRule[] = [
  { prefix: 'proxy', scope: 'proxy' },
  { prefix: 'proxy-lifecycle', scope: 'proxy' },
  { prefix: 'management', scope: 'management' },
  { prefix: 'management-lifecycle', scope: 'management' },
  { prefix: 'runtime', scope: 'runtime' },
  { prefix: 'service-host', scope: 'runtime' },
  { prefix: 'osw', scope: 'runtime' },
  { prefix: 'rpc', scope: 'runtime' },
  { prefix: 'telemetry', scope: 'runtime' },
  { prefix: 'database', scope: 'database' },
  { prefix: 'store', scope: 'database' },
  { prefix: 'static-web', scope: 'management' },
  { prefix: 'tray', scope: 'desktop' },
  { prefix: 'updater', scope: 'desktop' },
  { prefix: 'secrets', scope: 'desktop' },
  { prefix: 'auto-launch', scope: 'desktop' },
  { prefix: 'screenshots', scope: 'desktop' },
  { prefix: 'i18n', scope: 'desktop' },
  { prefix: 'cli', scope: 'desktop' },
]

const SCOPE_BY_PREFIX = new Map(RULES.map(rule => [rule.prefix, rule.scope]))

/** 行首的 `[前缀]`：前缀本身不含 `[` / `]` / 换行。 */
const LEADING_PREFIX = /^\[([^\[\]\r\n]+)\]/

/** 把一行日志的正文解析成它所属的模块。解析不出（无前缀 / 未登记）时返回 `other`。 */
export function resolveLogScope(message: string): LogScope {
  const matched = LEADING_PREFIX.exec(message)
  if (matched === null) return 'other'
  return SCOPE_BY_PREFIX.get(matched[1].trim()) ?? 'other'
}
