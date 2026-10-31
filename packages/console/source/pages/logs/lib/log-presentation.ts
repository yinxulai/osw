import type { UiCatalogKey } from '@common/i18n/catalogs'
import type { LogEntry, LogScope } from '@common/schemas'

/** 时间戳按界面语言格式化到毫秒；表格与导出都以它为准，不硬编码时区。 */
export function formatLogTimestamp(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  }).format(timestamp)
}

export interface LogLevelMeta {
  /** 级别文字（大写，终端式）。 */
  label: string
  /** 级别徽标的底色 + 文字色。 */
  badgeClass: string
  /** 行左侧强调条的颜色——严重级别在日志流里一眼扫得到，比一个小徽标更快。 */
  accentClass: string
}

/**
 * 每个级别的展示口径收在一处：文字、徽标、左侧强调条。
 *
 * 严重程度由**左侧强调条**承担（error/warn 的红黄一列扫下来就看得见），徽标只做二次确认；
 * 这样即使一屏全是 info，偶尔一条 error 也会从左边跳出来，而不用逐行读徽标。
 */
export const LOG_LEVEL_META: Record<LogEntry['level'], LogLevelMeta> = {
  error: { label: 'ERROR', badgeClass: 'bg-destructive/10 text-text-destructive', accentClass: 'border-l-destructive/70' },
  warn: { label: 'WARN', badgeClass: 'bg-warning/10 text-text-warning', accentClass: 'border-l-warning/70' },
  info: { label: 'INFO', badgeClass: 'bg-info/10 text-info', accentClass: 'border-l-info/55' },
  log: { label: 'LOG', badgeClass: 'bg-inset text-text-tertiary', accentClass: 'border-l-border' },
  debug: { label: 'DEBUG', badgeClass: 'bg-inset text-text-quaternary', accentClass: 'border-l-border/60' },
}

/**
 * 每个模块的标签 i18n key——字面量映射，而不是 `t(`logs.scope.${scope}`)`。
 *
 * 模板拼接对 i18n 目录门禁是不可见的，那批 key 会被判成死 key；这张映射表是门禁认得的引用形态
 * （与工具栏的 `SCOPE_OPTIONS` 同一套做法）。
 */
export const LOG_SCOPE_LABEL_KEY: Record<LogScope, UiCatalogKey> = {
  proxy: 'logs.scope.proxy',
  management: 'logs.scope.management',
  runtime: 'logs.scope.runtime',
  database: 'logs.scope.database',
  desktop: 'logs.scope.desktop',
  other: 'logs.scope.other',
}
