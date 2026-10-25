import { enUS, zhCN } from 'react-day-picker/locale'

/**
 * 语言 → 日历标签（月份、星期、翻页按钮的 aria 文案）。
 *
 * 单独一份而不是写在使用处：两个日期选择器（区间 / 单选）都要这份映射，
 * 各抄一份的话，新增语言时必然漏改其中一个，表现为「日历的部分文案没跟着切」。
 */
export const CALENDAR_LOCALES = { en: enUS, 'zh-CN': zhCN } as const
