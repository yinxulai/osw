/**
 * 这一段报文里有没有**真实生成内容**——首字延迟靠它打点。
 *
 * 「真实内容」既包括正文，也包括推理内容：推理 Token 同样是上游生成的、同样会流到客户端，
 * 只认正文会让推理模型的首字延迟虚高到整段思考结束。上游报的输出 Token 本来就含推理 Token，
 * 分子认它、首字却不认它，两个量就对不上了。
 *
 * 只说明「连接还活着」或「我结束了」的帧——纯角色帧、纯用量帧、`[DONE]`——一律不算。
 *
 * 与用量读取不同，这里**不按协议分适配器**：一帧报文里可能同时有 `choices` 和 `type`，
 * 而判据是「任意一条通道出现了内容」，聚合比择优更贴近语义；拆开反而要处理「多家同时命中」。
 */
export function hasOutput(data: Record<string, unknown>): boolean {
  const choices = Array.isArray(data.choices) ? data.choices : []
  for (const choice of choices) {
    const record = asRecord(choice)
    const delta = asRecord(record?.delta)
    const message = asRecord(record?.message)
    if (hasValue(delta?.content) || hasValue(delta?.tool_calls) || hasValue(delta?.function_call) || hasValue(delta?.refusal)
      || hasValue(delta?.reasoning_content) || hasValue(delta?.reasoning)
      || hasValue(record?.text) || hasValue(message?.content)
      || hasValue(message?.reasoning_content) || hasValue(message?.reasoning)) return true
  }

  const type = typeof data.type === 'string' ? data.type : ''
  if (type === 'content_block_delta') {
    const delta = asRecord(data.delta)
    if (!delta) return false
    // Anthropic 的思考块走 `thinking_delta`，与正文块平级，同样是真实内容。
    return (delta.type === 'text_delta' && hasValue(delta.text)) || (delta.type === 'thinking_delta' && hasValue(delta.thinking))
  }
  if (type === 'response.output_text.delta' || type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
    return hasValue(data.delta)
  }
  if (type === 'response.function_call_arguments.delta' || type === 'response.custom_tool_call_input.delta') {
    return hasValue(data.delta)
  }
  return false
}

export function hasValue(value: unknown): boolean {
  if (typeof value === 'string') return value.length > 0
  return value !== null && value !== undefined
}

/**
 * 从一帧报文里取出「上游生成的正文」并拼起来。
 *
 * 只取正文，不取 `usage`、`role`、`finish_reason` 这类元信息——它们不是生成内容，
 * 计入会把估算抬高。取值来源与 {@link hasOutput} 一一对应：那里回答「有没有真实内容」，
 * 这里回答「内容是什么」。
 *
 * 推理内容（`reasoning_content` / `thinking` 等）同样计入：上游报的输出 Token 本来就含推理
 * Token，估算也必须含，否则推理模型在长思考段的实时速度会被系统性低估。
 */
export function extractOutputText(data: Record<string, unknown>): string {
  let text = ''
  const append = (value: unknown): void => {
    if (typeof value === 'string') text += value
    else if (value !== null && value !== undefined && typeof value !== 'object') text += String(value)
  }

  const choices = Array.isArray(data.choices) ? data.choices : []
  for (const choice of choices) {
    const record = asRecord(choice)
    const delta = asRecord(record?.delta)
    const message = asRecord(record?.message)
    append(delta?.content)
    append(delta?.reasoning_content)
    append(delta?.reasoning)
    append(record?.text)
    append(message?.content)
    append(message?.reasoning_content)
    append(message?.reasoning)
    if (hasValue(delta?.tool_calls)) append(stringifyForEstimate(delta?.tool_calls))
    if (hasValue(delta?.function_call)) append(stringifyForEstimate(delta?.function_call))
  }

  const type = typeof data.type === 'string' ? data.type : ''
  if (type === 'content_block_delta') {
    const delta = asRecord(data.delta)
    if (delta?.type === 'text_delta') append(delta.text)
    else if (delta?.type === 'thinking_delta') append(delta.thinking)
    else if (delta?.type === 'input_json_delta') append(delta.partial_json)
  } else if (type === 'response.output_text.delta'
    || type === 'response.reasoning_summary_text.delta'
    || type === 'response.reasoning_text.delta'
    || type === 'response.function_call_arguments.delta'
    || type === 'response.custom_tool_call_input.delta') {
    append(data.delta)
  }
  return text
}

/** 工具调用的入参是结构化数据，估算时按它的 JSON 文本长度算（量级上够用）。 */
function stringifyForEstimate(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

/**
 * 估一个输出 Token 的「权重」：把 {@link estimateOutputTokenWeight} 按段累计起来。
 *
 * 上游把生成内容分散在若干帧里（每个分块可能只有几个字），逐帧估、逐帧累加，
 * 与「把整段正文拼起来再估一次」应当接近，但流式场景下只有逐帧才拿得到中途的数。
 * 所以权重按**字符本身**度量，而不是按帧——同一段正文切成几块都应估出同一个数。
 *
 * @see estimateOutputTokenWeight
 */
export function estimateOutputTokenWeight(text: string): number {
  let weight = 0
  for (const character of text) {
    const code = character.codePointAt(0)
    if (code === undefined) continue
    // CJK、全角标点等字符一个就顶一个多字节 Token；ASCII 大约 4 个字符才一个 Token。
    weight += isDenseScript(code) ? 1 : 0.25
  }
  return weight
}

/**
 * 这个码位是否属于「一字一 Token」量级的密集文字（CJK、日文假名、韩文、全角标点）。
 *
 * 只用于估算：目的是让中文/日文正文不会被按英文的 4 字 1 Token 严重低估。
 * 范围与仓库里别处的 CJK 判据一致（见测试脚本的字体范围），但这里只需覆盖常见区块。
 */
function isDenseScript(code: number): boolean {
  return (code >= 0x3000 && code <= 0x303f) // CJK 标点
    || (code >= 0x3040 && code <= 0x30ff) // 平假名 / 片假名
    || (code >= 0x3400 && code <= 0x4dbf) // CJK 扩展 A
    || (code >= 0x4e00 && code <= 0x9fff) // CJK 基本区
    || (code >= 0xf900 && code <= 0xfaff) // CJK 兼容表意
    || (code >= 0xff00 && code <= 0xffef) // 全角字符
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
