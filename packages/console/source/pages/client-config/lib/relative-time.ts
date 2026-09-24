import type { AppTranslator } from '@/i18n/provider'

/**
 * 版本时间读成人话（刚刚 / N 分钟前 / N 小时前 / N 天前）。
 *
 * 只做到「天」为止：版本列表关心的是「这是不是我刚才那一下」，再往上精确到日期反而更难扫，
 * 而且这个列表任何时候都能靠顺序判断新旧，时间只是辅助。
 */
export function formatVersionTime(t: AppTranslator, timestamp: number): string {
  const difference = Date.now() - timestamp
  if (difference < 60_000) return t('clientConfig.time.justNow')
  if (difference < 3_600_000) return t('clientConfig.time.minutesAgo', { count: Math.floor(difference / 60_000) })
  if (difference < 86_400_000) return t('clientConfig.time.hoursAgo', { count: Math.floor(difference / 3_600_000) })
  return t('clientConfig.time.daysAgo', { count: Math.floor(difference / 86_400_000) })
}
