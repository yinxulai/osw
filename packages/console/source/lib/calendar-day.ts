/**
 * 按本地日历日移动时间戳，结果落在目标日的本地零点。
 *
 * 夏令时切换日不是 24 小时：`timestamp ± days * 86_400_000` 在回拨日会停在当天 23:00，
 * 在春令时日会落到次日 01:00，连着往前减 6 天还会整段多出一天。用年月日构造，
 * `setHours(0, 0, 0, 0)` 在切换当天同样会偏一小时。
 */
export function shiftLocalCalendarDays(timestamp: number, days: number): number {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime()
}
