/**
 * 本地日历日（`YYYY-MM-DD` 字符串）与 `Date` 的互转。
 *
 * 日期选择器的值是**一条本地日期串**，不是时间戳：使用者关心的口径是「哪一天」，
 * 具体时刻由调用方决定（比如过期时间取当天 23:59:59.999，那是 `draft.ts` 的事）。
 *
 * 不能用 `toISOString().slice(0, 10)` 走这条路：它先把本地时间换成 UTC，
 * 东八区的 8 月 1 日零点会变成「2026-07-31」。所以两个方向都按本地年月日构造。
 */

/** `YYYY-MM-DD` → 当天本地零点。格式不对、或日期不存在（如 `2 月 31 日`）时返回 undefined。 */
export function parseLocalDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  // 反查一遍：`new Date(2026, 1, 31)` 会顺手滚到 3 月 3 日，滚过去的日期不是用户填的日子。
  return formatLocalDate(date) === value ? date : undefined
}

/** 本地年月日 → `YYYY-MM-DD`。补零而不是依赖 `toISOString`，见文件头。 */
export function formatLocalDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** 给用户看的日期文案（随语言走）。空串或非法值返回 null，由调用方决定占位。 */
export function formatLocalDateDisplay(value: string, locale: string): string | null {
  const date = parseLocalDate(value)
  if (!date) return null
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}
