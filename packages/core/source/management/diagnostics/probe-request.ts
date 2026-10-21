import type { ModelTestMode, Protocol } from '@common/schemas'
import { padPrompt } from '../../proxy/protocols/shared/diagnostic-body'
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
 * 诊断请求的可选项。两者都只影响**这一次**发出去的正文，不写任何配置。
 *
 * 提示词默认值、输出上限与补齐句子都是**协议级**的事实（三家协议的写法各不相同），
 * 因此它们住在 `protocols/shared/diagnostic-body.ts` 与各自的协议模块里，这一层只做分发。
 */
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

export { padPrompt }

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
