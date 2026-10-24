import { samplePayload } from '@common/router/presets'
import type { RuntimeLogicalModel } from '@common/router/types'

/**
 * 试运行输入框的口径：初值、行数、以及真正发出去的那份负载。
 *
 * 这三件事都只跟「文本 → 负载」有关，与画布和 React 无关，因此单独一层：
 * 面板只负责把文本原样交给这里，出错时的提示也照原样传回去。
 */

/** 输入框的初值：一份能直接跑的示例负载，打开抽屉就能按「运行」。 */
export function initialPayloadText(): string {
  return JSON.stringify(samplePayload, null, 2)
}

/**
 * 输入框的行数随内容增长（上限 28 行、下限 8 行），剩下的交给抽屉整体滚动。
 * 这样小窗口里不会出现「输入框自己滚 + 结果区自己滚」的双滚动条。
 */
export function payloadRowsFor(text: string): number {
  return Math.min(28, Math.max(8, text.split('\n').length + 1))
}

/**
 * 把输入框里的文本解析成这一次试运行要发出去的负载。
 *
 * 逻辑模型列表由页面注入（代理看到的与画布上的是同一份）；文本不是对象时按空对象处理，
 * 与「用户写了个字符串 / 数字」的既有行为一致。非法 JSON 照原样抛出语法错误，
 * 由调用方决定怎么显示——这里不认识界面语言。
 */
export function parseRunPayload(text: string, logicalModels: readonly RuntimeLogicalModel[]): Record<string, unknown> {
  const payload = JSON.parse(text) as unknown
  const normalizedPayload = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  normalizedPayload.logicalModels = logicalModels
  return normalizedPayload
}
