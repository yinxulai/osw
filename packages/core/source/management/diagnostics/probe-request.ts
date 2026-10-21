import type { ModelTestMode, Protocol } from '@common/schemas'
import { buildDiagnosticBody as buildAnthropicDiagnosticBody } from '../../proxy/protocols/anthropic-messages/diagnostic-body'
import { buildDiagnosticBody as buildOpenAiCompletionsDiagnosticBody } from '../../proxy/protocols/openai-completions/diagnostic-body'
import { buildDiagnosticBody as buildOpenAiResponsesDiagnosticBody } from '../../proxy/protocols/openai-responses/diagnostic-body'

/**
 * 诊断请求体怎么拼：**三种协议各一种写法，一处写完**。
 *
 * 这一层只管「发出去的那句话」，不碰网络、不碰数据库、不碰观测。渠道诊断
 * （`/api/model-test/run`）与草稿连接测试（`/api/model/connectivity-test`）共用它，
 * 因为两者要回答的是同一类问题——「这条链路能不能把我这句话送到上游」——只是
 * 一个测已保存的配置、一个测没保存的草稿（见 `apps/docs/specs/diagnostics.md` §2）。
 *
 * 正因为共用，它必须住在两侧都能依赖的位置：原先它长在渠道诊断的路由文件里，
 * 连接测试反过来 import 另一个路由文件，路由与路由之间因此有了一条没人说得清的
 * 依赖（谁能想到「模型对话框里的连接测试」的请求格式由「渠道诊断」定义）。
 */

/**
 * 速度诊断的提示词与输出上限。
 *
 * 测速度需要一段**够长**的输出：一句话的回答里，出字快慢全被首字节和连接开销盖住。
 * 数数是最省事的长输出——它不需要模型「想」，也不需要采样温度，不同渠道之间可比。
 */
const SPEED_PROMPT = 'Count from 1 to 200, separated by single spaces. Output only the numbers.'

/**
 * 速度诊断给直连 Anthropic 的输出上限。
 *
 * `/v1/messages` 把 `max_tokens` 当必填，不给就是 400；而转换层在不给时会补一个 4096
 * 的上限，一句「Hi」理论上有成本风险。所以普通诊断压到最小值，速度诊断放大到够数完
 * 1 到 200——16 个 Token 会把数数掐断，那时量到的就不是出字速度，而是上限速度。
 */
const SPEED_MAX_TOKENS = 512

/** 普通诊断给直连 Anthropic 的输出上限。只要一个字节，越小越省。 */
const DEFAULT_MAX_TOKENS = 16

/** 各模式在用户没写提示词时用的默认值。 */
const DEFAULT_PROMPTS: Record<ModelTestMode, string> = {
  streaming: 'Hi',
  speed: SPEED_PROMPT,
}

/**
 * 「输入长度」靠这段中性句子补齐。
 *
 * 它必须是可忽略的填充文本：诊断量的是链路的耗时与出字，不是模型读得懂不懂。
 * 用一句固定的英文而不是随机串，是为了让同一组配置在不同渠道之间可比。
 */
const LENGTH_PADDING_SENTENCE = 'Ignore the following filler text, it only exists to make this diagnostic request longer. '

/** 诊断请求的可选项。两者都只影响**这一次**发出去的正文，不写任何配置。 */
export interface DiagnosticBodyOptions {
  /** 自定义提示词；不传/空串时按模式取默认值。 */
  prompt?: string
  /** 提示词补齐到的字符数；0 表示不补。 */
  inputLength?: number
  /**
   * 要不要在正文里要流式。默认 `true`——渠道诊断恒为流式。
   *
   * 只有一种情况需要改它：供应商模型对话框里的「连接测试」（`routes/diagnostics/model-connectivity.ts`）。
   * 那个探针用 `requestHttpBuffered` 发一次一问一答的请求、只看状态码，压根不读流；
   * 让它拿到 SSE 只会把一次握手变成一次「读到流自己结束才算完」的等待，量到的耗时也不再是握手耗时。
   */
  stream?: boolean
}

/**
 * 把提示词补齐到指定长度。
 *
 * 「输入长度」量的是**长上下文下的链路表现**（预填充耗时、网关缓冲），所以补的是中性的
 * 填充句子而不是重复同一个字符：多数网关会把重复字符压掉，那样长度就白加了。
 * 只补不截：用户写的提示词已经超过目标长度时，尊重他写的那份。
 */
export function padPrompt(prompt: string, inputLength: number): string {
  if (inputLength <= 0 || prompt.length >= inputLength) return prompt
  // 分隔符也算长度：先扣掉那 `\n\n`，否则补出来的正文总比用户填的目标多两个字。
  const separator = '\n\n'
  const paddingLength = inputLength - prompt.length - separator.length
  if (paddingLength <= 0) return prompt
  const repeats = Math.ceil(paddingLength / LENGTH_PADDING_SENTENCE.length)
  return `${prompt}${separator}${LENGTH_PADDING_SENTENCE.repeat(repeats).slice(0, paddingLength)}`
}

/**
 * 诊断请求正文。
 *
 * `converted` 表示这次请求会被协议转换层改写：转换后的目标多是 OpenAI 形态，
 * 而 OpenAI 的 o 系模型只认 `max_completion_tokens`，塞 `max_tokens` 反而会换来一个 400，
 * 所以走转换时一律不加输出上限。
 *
 * **永远是流式。** 诊断只有两件事要回答：首字节隔了多久才到、上游到底产出了多少 Token。
 * 两件都只存在于 SSE 里——整包响应没有「第一块」这个时刻，而用量挂在流的收尾帧上（见下）。
 * 所以这里不给「非流式」留分支：一个能通但什么都量不到的模式不值得占一个下拉项。
 *
 * 流式写在**请求体**里而不是头上：三种协议都靠 `stream: true` 表达这件事，
 * 上游也只认这个字段（Anthropic 同样是给 `stream` 才回 SSE）。
 */
export function buildDiagnosticBody(protocol: Protocol, modelId: string, converted: boolean, mode: ModelTestMode = 'streaming', options: DiagnosticBodyOptions = {}): string {
  switch (protocol) {
    case 'openai-completions':
      return buildOpenAiCompletionsDiagnosticBody(modelId, options, mode)
    case 'openai-responses':
      return buildOpenAiResponsesDiagnosticBody(modelId, options)
    case 'anthropic-messages':
      return buildAnthropicDiagnosticBody(modelId, converted, mode, options)
  }
}
