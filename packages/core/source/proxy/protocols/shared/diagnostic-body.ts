import type { ModelTestMode } from '@common/schemas'

/**
 * 速度诊断的提示词与输出上限。
 *
 * 测速度需要一段**够长**的输出：一句话的回答里，出字快慢全被首字节和连接开销盖住。
 * 数数是最省事的长输出——它不需要模型「想」，也不需要采样温度，不同渠道之间可比。
 */
export const SPEED_PROMPT = 'Count from 1 to 200, separated by single spaces. Output only the numbers.'

/**
 * 速度诊断给直连 Anthropic 的输出上限。
 *
 * `/v1/messages` 把 `max_tokens` 当必填，不给就是 400；而转换层在不给时会补一个 4096
 * 的上限，一句「Hi」理论上有成本风险。所以普通诊断压到最小值，速度诊断放大到够数完
 * 1 到 200——16 个 Token 会把数数掐断，那时量到的就不是出字速度，而是上限速度。
 */
export const SPEED_MAX_TOKENS = 512

/** 普通诊断给直连 Anthropic 的输出上限。只要一个字节，越小越省。 */
export const DEFAULT_MAX_TOKENS = 16

/** 各模式在用户没写提示词时用的默认值。 */
export const DEFAULT_PROMPTS: Readonly<Record<ModelTestMode, string>> = {
  streaming: 'Hi',
  speed: SPEED_PROMPT,
}

/** 用户没写提示词时按模式取默认值；写了就用他写的那份（去掉首尾空白）。 */
export function resolveDiagnosticPrompt(mode: ModelTestMode, prompt: string | undefined): string {
  return prompt?.trim() || DEFAULT_PROMPTS[mode]
}

const LENGTH_PADDING_SENTENCE = 'Ignore the following filler text, it only exists to make this diagnostic request longer. '

export function padPrompt(prompt: string, inputLength: number): string {
  if (inputLength <= 0 || prompt.length >= inputLength) return prompt
  const separator = '\n\n'
  const paddingLength = inputLength - prompt.length - separator.length
  if (paddingLength <= 0) return prompt
  const repeats = Math.ceil(paddingLength / LENGTH_PADDING_SENTENCE.length)
  return `${prompt}${separator}${LENGTH_PADDING_SENTENCE.repeat(repeats).slice(0, paddingLength)}`
}
