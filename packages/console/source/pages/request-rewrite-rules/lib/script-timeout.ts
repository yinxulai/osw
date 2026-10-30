import { REWRITE_SCRIPT_TIMEOUT_DEFAULT, REWRITE_SCRIPT_TIMEOUT_LIMIT } from '@common/schemas'

/**
 * 把脚本超时输入框的草稿字符串归一成合法毫秒数。
 *
 * 非有限数、零或负数一律落到默认值；否则取整并钳到上限。失焦时才调用——
 * 边输入边归一会把「删光重敲」的中间态立刻回填成默认值，反而没法编辑。
 */
export function normalizeScriptTimeout(draft: string): number {
  const parsed = Number(draft)
  if (!Number.isFinite(parsed) || parsed <= 0) return REWRITE_SCRIPT_TIMEOUT_DEFAULT
  return Math.min(Math.round(parsed), REWRITE_SCRIPT_TIMEOUT_LIMIT)
}
