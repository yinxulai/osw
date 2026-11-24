import { firstNumber } from './usage'
import { asArray, asNumber, asObject, asString, type Json } from './conversion-utils'
import type { ToolNameRegistry } from './tool-name-registry'

/**
 * OpenAI Chat Completions 响应 → OpenAI Responses 响应。
 *
 * 字段依据见 apps/docs/upstream/openai-responses.md 与 apps/docs/upstream/openai-completions.md。
 *
 * Responses 的响应体不是 Chat Completions 的字段改名，而是「事件/输出项」模型：
 * 非流式返回 `output[]` 项列表，流式则要补齐 output_item / content_part /
 * output_text / 工具调用参数的完整生命周期事件。转换器据此重建一套
 * 合法的 Responses 事件序列，而不是只翻译文本增量。
 *
 * 请求侧的 namespace 工具组被展平成顶层工具名（见 `tool-name-registry.ts`），
 * 所以这里发工具调用项时要拿着同一个 `toolNames` 把名字还原成
 * `(namespace, name)` 寻址，否则客户端认不出这是它声明的哪个工具。
 * function 与 custom 两类调用共用这条还原规则。
 *
 * 同一个 `toolNames` 还记着「哪些 custom 工具被降级成了 function」（见
 * `request-conversion-responses-to-openai.ts`）：上游把这些工具当 function 调回来时，
 * 这里要还原成 `custom_tool_call`，并把 `{"input": "..."}` 参数解回自由文本。
 */

type ResponsesStatus = 'in_progress' | 'completed' | 'incomplete'

/** 工具调用输出项的类别；两类字段集不同，构造时按类别分流。 */
type ToolItemKind = 'function' | 'custom'

/**
 * Chat 的 `prompt_tokens_details` 是 `{ audio_tokens, cache_write_tokens, cached_tokens,
 * image_tokens, text_tokens }`，Responses 的 `input_tokens_details` 只有
 * `{ cache_write_tokens, cached_tokens }`。两者字段集不同，必须挑字段而不是整体搬运，
 * 否则会输出 Responses 规范里不存在的键。
 *
 * 两套明细可能同时出现，并且 Chat 那套是占位 0。每个键单独走 `firstNumber`，
 * 不能先用 `??` 选中整个对象。
 */
function openAiInputDetailsToResponses(promptDetails: unknown, inputDetails: unknown): Json | undefined {
  const prompt = asObject(promptDetails)
  const input = asObject(inputDetails)
  const cached = firstNumber(prompt?.cached_tokens, input?.cached_tokens) ?? undefined
  const created = firstNumber(prompt?.cache_write_tokens, input?.cache_write_tokens) ?? undefined
  if (cached === undefined && created === undefined) return undefined
  return {
    ...(created !== undefined ? { cache_write_tokens: created } : {}),
    ...(cached !== undefined ? { cached_tokens: cached } : {}),
  }
}

function openAiUsageToResponses(usage: Json | null): Json | undefined {
  if (!usage) return undefined
  // 与 Anthropic 方向、用量观察器同一条规则：占位 0 让位给后面的正数，全是 0 才回落到 0。
  const input = firstNumber(usage.prompt_tokens, usage.input_tokens) ?? undefined
  const output = firstNumber(usage.completion_tokens, usage.output_tokens) ?? undefined
  if (input === undefined && output === undefined) return undefined
  const inputDetails = openAiInputDetailsToResponses(usage.prompt_tokens_details, usage.input_tokens_details)
  const reasoning = firstNumber(
    asObject(usage.completion_tokens_details)?.reasoning_tokens,
    asObject(usage.output_tokens_details)?.reasoning_tokens,
  ) ?? undefined
  return {
    ...(input !== undefined ? { input_tokens: input } : {}),
    ...(inputDetails ? { input_tokens_details: inputDetails } : {}),
    ...(output !== undefined ? { output_tokens: output } : {}),
    ...(reasoning !== undefined ? { output_tokens_details: { reasoning_tokens: reasoning } } : {}),
    ...(input !== undefined || output !== undefined ? { total_tokens: (input ?? 0) + (output ?? 0) } : {}),
  }
}

/**
 * Chat 的 `finish_reason` → Responses 的 `incomplete_details.reason`。
 *
 * Responses 用「终态 + 原因」表达截断：`status: "incomplete"` 配 `incomplete_details.reason`
 * （可取 `max_output_tokens` / `content_filter` 等），正常结束则是 `status: "completed"`
 * 且不带 `incomplete_details`。
 */
function responsesIncompleteReason(finishReason: string | undefined): string | undefined {
  if (finishReason === 'length') return 'max_output_tokens'
  if (finishReason === 'content_filter') return 'content_filter'
  return undefined
}

/** 终态下 output item 自身的 status：被截断时同为 incomplete。 */
function terminalItemStatus(finishReason: string | undefined): Exclude<ResponsesStatus, 'in_progress'> {
  return responsesIncompleteReason(finishReason) ? 'incomplete' : 'completed'
}

function openAiContentToText(content: unknown): string {
  if (typeof content === 'string') return content
  return asArray(content).map(part => asString(asObject(part)?.text) ?? '').join('')
}

function outputTextPart(text: string): Json {
  return { type: 'output_text', text, annotations: [] }
}

function messageItem(id: string, text: string, status: ResponsesStatus): Json {
  return { id, type: 'message', status, role: 'assistant', content: status === 'in_progress' ? [] : [outputTextPart(text)] }
}

/**
 * 工具名 → Responses 的 `(namespace, name)` 寻址。
 * 请求转换登记过的命名空间工具才查得到；非命名空间工具、模型臆造的工具名原样输出。
 */
function restoreToolName(name: string, toolNames?: ToolNameRegistry): { name: string, namespace?: string } {
  const identity = toolNames?.restore(name)
  if (!identity) return { name }
  return { name: identity.name, namespace: identity.namespace }
}

/**
 * 被降级的 custom 工具在上游是 function 调用，参数是一段 JSON：`{"input": "..."}`。
 * 这里把它的自由文本取回来。
 *
 * 三级回落：正常情况取 `input`；模型偶尔会把自由文本包进别的单字段对象；两者都不成立时
 * 认为模型直接输出了自由文本。**不猜**——猜错会把补丁、SQL 这类载荷悄悄改坏，
 * 原样交给客户端至少还能看出上游到底回了什么。
 */
function customInputFromArguments(argumentsText: string): string {
  if (!argumentsText) return ''
  try {
    const parsed: unknown = JSON.parse(argumentsText)
    if (typeof parsed === 'string') return parsed
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>
      if (typeof record.input === 'string') return record.input
      const values = Object.values(record)
      if (values.length === 1 && typeof values[0] === 'string') return values[0]
    }
  } catch {
    // 不是 JSON：模型直接吐了自由文本，正好就是要的形态。
  }
  return argumentsText
}

/**
 * 一个上游 function 调用在客户端眼里是什么。
 *
 * 返回 `kind: undefined` 表示「名字还只是某个被降级的 custom 工具名的前缀」——名字可能
 * 分片到达，此刻无法判断，等后续 delta；结论一旦得出就不会再变。
 */
function classifyFunctionCall(name: string, toolNames?: ToolNameRegistry): { kind?: ToolItemKind, coerced: boolean } {
  if (!toolNames) return { kind: 'function', coerced: false }
  if (toolNames.isCustomTool(name)) return { kind: 'custom', coerced: true }
  if (toolNames.startsWithCustomTool(name)) return { coerced: false }
  return { kind: 'function', coerced: false }
}

/**
 * Chat 的 tool_call → Responses 的 `(kind, id, name, call_id, payload)`。
 *
 * `custom` 调用的载荷是自由文本而不是 JSON 字符串，所以字段名不同：
 * Responses 用 `input`（见 `CustomToolCall object`），Chat 也用 `input`
 * （见 `ChatCompletionMessageCustomToolCall`）。`function` 调用两边都叫 `arguments`。
 *
 * 上游原生支持 custom 工具时走 `call.custom`；而本服务在请求侧把 custom 工具降级成了
 * function（见 `request-conversion-responses-to-openai.ts`），这类调用在 `call.function`
 * 里回来、名字登记在 `toolNames`，要做回 `custom_tool_call` 并解开 `input`。
 */
function openAiToolCallToResponses(call: Json, toolNames?: ToolNameRegistry): { kind: ToolItemKind, callId: string, name: string, payload: string } | null {
  const custom = asObject(call.custom)
  if (custom) {
    const name = asString(custom.name)
    if (!name) return null
    return { kind: 'custom', callId: asString(call.id) ?? '', name, payload: asString(custom.input) ?? '' }
  }
  const fn = asObject(call.function)
  const name = asString(fn?.name)
  if (!fn || !name) return null
  const argumentsText = asString(fn.arguments) ?? ''
  const callId = asString(call.id) ?? ''
  if (toolNames?.isCustomTool(name)) return { kind: 'custom', callId, name, payload: customInputFromArguments(argumentsText) }
  return { kind: 'function', callId, name, payload: argumentsText }
}

/**
 * 组装一个工具调用输出项（名字已还原成 Responses 的寻址）。
 *
 * 两类项字段集不同，不能套同一个骨架：`FunctionCall` 有 `status`、载荷叫 `arguments`；
 * `CustomToolCall` 没有 `status`、载荷叫 `input`
 * （见 apps/docs/upstream/openai-responses.md 的 `FunctionCall` 与 `CustomToolCall`）。
 */
function toolCallItem(kind: ToolItemKind, itemId: string, callId: string, name: string, payload: string, status: ResponsesStatus, toolNames?: ToolNameRegistry): Json {
  const address = restoreToolName(name, toolNames)
  if (kind === 'custom') {
    return { id: itemId, type: 'custom_tool_call', call_id: callId, ...address, input: payload }
  }
  return { id: itemId, type: 'function_call', status, call_id: callId, ...address, arguments: payload }
}

export function openAiResponseToResponses(body: Json, toolNames?: ToolNameRegistry): Json {
  const id = asString(body.id) ?? ''
  const first = asObject(asArray(body.choices)[0])
  const message = asObject(first?.message)
  const finishReason = asString(first?.finish_reason)
  // 非流式也会带上 finish_reason：length / content_filter 同样要还原成 incomplete 终态。
  const incompleteReason = responsesIncompleteReason(finishReason)
  const itemStatus = terminalItemStatus(finishReason)
  const output: Json[] = []

  const text = openAiContentToText(message?.content)
  if (text) output.push(messageItem(`${id}_msg`, text, itemStatus))

  asArray(message?.tool_calls).forEach((rawCall, index) => {
    const call = asObject(rawCall)
    if (!call) return
    const converted = openAiToolCallToResponses(call, toolNames)
    if (!converted) return
    output.push(toolCallItem(converted.kind, `${id}_fc_${index}`, converted.callId, converted.name, converted.payload, itemStatus, toolNames))
  })

  const usage = openAiUsageToResponses(asObject(body.usage))
  return {
    id,
    object: 'response',
    created_at: asNumber(body.created) ?? Math.floor(Date.now() / 1000),
    status: itemStatus,
    model: asString(body.model) ?? '',
    output,
    ...(incompleteReason ? { incomplete_details: { reason: incompleteReason } } : {}),
    ...(usage ? { usage } : {}),
  }
}

interface ResponsesToolItemState {
  outputIndex: number
  itemId: string
  /**
   * 输出项类别；`undefined` 表示名字还没到齐、暂时分不清（见 `classifyFunctionCall`）。
   * 未分类时 `output_item.added` 也推迟，否则客户端会先收到一个类型错误的 item。
   */
  kind?: ToolItemKind
  /**
   * `kind === 'custom'` 且是「上游被降级成 function」的工具。这类调用收到的是 JSON 参数，
   * 不是客户端的自由文本，因此不在流中逐段外发，收尾时一次解开。
   */
  coerced: boolean
  callId: string
  name: string
  /** function 调用是 `arguments`（JSON 字符串），custom 调用是 `input`（自由文本），共用这一个累加器。 */
  payload: string
  /** 已经以 delta 事件发出去的载荷长度；分类推迟期间累积的载荷要在这里补齐。 */
  emitted: number
  added: boolean
  closed: boolean
  /** 关闭时确定的 item 终态，用于聚合 output 时保持一致 */
  status?: Exclude<ResponsesStatus, 'in_progress'>
}

export interface OpenAiToResponsesState {
  started: boolean
  completed: boolean
  id: string
  model: string
  created: number
  messageItemId: string
  messageOutputIndex: number
  textStarted: boolean
  textClosed: boolean
  textStatus?: Exclude<ResponsesStatus, 'in_progress'>
  text: string
  /** OpenAI tool_calls[].index → Responses 输出项状态 */
  toolItems: Map<number, ResponsesToolItemState>
  nextOutputIndex: number
  usage?: Json
  finishReason?: string
  /** 本次尝试的请求上下文：把展平的工具名还原回 `(namespace, name)` */
  toolNames?: ToolNameRegistry
}

export function createOpenAiToResponsesState(toolNames?: ToolNameRegistry): OpenAiToResponsesState {
  return {
    started: false,
    completed: false,
    id: '',
    model: '',
    created: Math.floor(Date.now() / 1000),
    messageItemId: 'msg',
    messageOutputIndex: -1,
    textStarted: false,
    textClosed: false,
    text: '',
    toolItems: new Map(),
    nextOutputIndex: 0,
    ...(toolNames ? { toolNames } : {}),
  }
}

function buildOutput(state: OpenAiToResponsesState): Json[] {
  const fallbackStatus = terminalItemStatus(state.finishReason)
  const items: Array<{ index: number; item: Json }> = []
  if (state.textStarted) items.push({ index: state.messageOutputIndex, item: messageItem(state.messageItemId, state.text, state.textStatus ?? fallbackStatus) })
  for (const item of state.toolItems.values()) {
    if (!item.added) continue
    items.push({ index: item.outputIndex, item: toolCallItem(item.kind ?? 'function', item.itemId, item.callId, item.name, item.payload, item.status ?? fallbackStatus, state.toolNames) })
  }
  return items.sort((left, right) => left.index - right.index).map(entry => entry.item)
}

function buildResponse(state: OpenAiToResponsesState, status: ResponsesStatus, incompleteReason?: string): Json {
  const terminal = status !== 'in_progress'
  return {
    id: state.id,
    object: 'response',
    created_at: state.created,
    status,
    model: state.model,
    output: terminal ? buildOutput(state) : [],
    ...(incompleteReason ? { incomplete_details: { reason: incompleteReason } } : {}),
    ...(terminal && state.usage ? { usage: state.usage } : {}),
  }
}

function ensureStarted(state: OpenAiToResponsesState, events: Json[]): void {
  if (state.started) return
  state.started = true
  events.push({ type: 'response.created', response: buildResponse(state, 'in_progress') })
  events.push({ type: 'response.in_progress', response: buildResponse(state, 'in_progress') })
}

function openTextItem(state: OpenAiToResponsesState, events: Json[]): void {
  state.textStarted = true
  state.messageItemId = `${state.id}_msg`
  state.messageOutputIndex = state.nextOutputIndex++
  events.push({ type: 'response.output_item.added', output_index: state.messageOutputIndex, item: messageItem(state.messageItemId, '', 'in_progress') })
  events.push({ type: 'response.content_part.added', item_id: state.messageItemId, output_index: state.messageOutputIndex, content_index: 0, part: outputTextPart('') })
}

/** 文本块结束后依次发出 text.done / content_part.done / output_item.done。 */
function closeTextItem(state: OpenAiToResponsesState, events: Json[], status: Exclude<ResponsesStatus, 'in_progress'>): void {
  if (!state.textStarted || state.textClosed) return
  state.textClosed = true
  state.textStatus = status
  events.push({ type: 'response.output_text.done', item_id: state.messageItemId, output_index: state.messageOutputIndex, content_index: 0, text: state.text })
  events.push({ type: 'response.content_part.done', item_id: state.messageItemId, output_index: state.messageOutputIndex, content_index: 0, part: outputTextPart(state.text) })
  events.push({ type: 'response.output_item.done', output_index: state.messageOutputIndex, item: messageItem(state.messageItemId, state.text, status) })
}

/**
 * 关闭一个工具调用项：先发载荷完成事件，再发 output_item.done。
 *
 * 载荷事件按类别分流：`function_call` 是 `response.function_call_arguments.delta/done`（载荷字段
 * `arguments`），`custom_tool_call` 是 `response.custom_tool_call_input.delta/done`（载荷字段 `input`）。
 * 后者是前者的对位事件，但本地参考文档（apps/docs/upstream/openai-responses.md）的事件清单并不完整
 * （连 `response.function_call_arguments.*` 都没收录），因此此处按 `output_item.done` 里
 * 已经确定的 item 结构对齐字段，不额外臆造别的键。
 */
function closeToolItem(item: ResponsesToolItemState, events: Json[], status: Exclude<ResponsesStatus, 'in_progress'>, toolNames?: ToolNameRegistry): void {
  if (item.closed) return
  // 名字始终没到齐时无从分类，按 function 收尾：这是唯一不会丢掉载荷的选择。
  if (item.kind === undefined) item.kind = 'function'
  const kind = item.kind
  if (!item.added) {
    item.added = true
    events.push({
      type: 'response.output_item.added',
      output_index: item.outputIndex,
      item: toolCallItem(kind, item.itemId, item.callId, item.name, '', 'in_progress', toolNames),
    })
  }
  item.closed = true
  item.status = status

  if (kind === 'custom') {
    const input = item.coerced ? customInputFromArguments(item.payload) : item.payload
    // 解开的自由文本才是这一项的载荷；聚合 output 时不能再用上游那段 JSON。
    if (item.coerced) item.payload = input
    // 降级工具的载荷从没以 delta 发过，这里补一条完整增量，保证
    // 「各条 delta 拼接 === done.input」对客户端仍然成立。
    const pending = item.coerced ? input : item.payload.slice(item.emitted)
    if (pending) {
      events.push({ type: 'response.custom_tool_call_input.delta', item_id: item.itemId, output_index: item.outputIndex, delta: pending })
      item.emitted = item.payload.length
    }
    events.push({ type: 'response.custom_tool_call_input.done', item_id: item.itemId, output_index: item.outputIndex, input })
    events.push({
      type: 'response.output_item.done',
      output_index: item.outputIndex,
      item: toolCallItem('custom', item.itemId, item.callId, item.name, input, status, toolNames),
    })
    return
  }

  const pending = item.payload.slice(item.emitted)
  if (pending) {
    events.push({ type: 'response.function_call_arguments.delta', item_id: item.itemId, output_index: item.outputIndex, delta: pending })
    item.emitted = item.payload.length
  }
  events.push({ type: 'response.function_call_arguments.done', item_id: item.itemId, output_index: item.outputIndex, arguments: item.payload })
  events.push({
    type: 'response.output_item.done',
    output_index: item.outputIndex,
    item: toolCallItem('function', item.itemId, item.callId, item.name, item.payload, status, toolNames),
  })
}

function closeOpenItems(state: OpenAiToResponsesState, events: Json[]): void {
  const status = terminalItemStatus(state.finishReason)
  closeTextItem(state, events, status)
  for (const item of state.toolItems.values()) closeToolItem(item, events, status, state.toolNames)
}

function complete(state: OpenAiToResponsesState, events: Json[]): void {
  if (state.completed) return
  ensureStarted(state, events)
  closeOpenItems(state, events)
  state.completed = true
  // 被 token 上限或内容过滤截断时，Responses 规范要求以 response.incomplete + incomplete_details
  // 收尾，其余情况才是 response.completed；两者都带完整 output 与 usage。
  const incompleteReason = responsesIncompleteReason(state.finishReason)
  events.push(incompleteReason
    ? { type: 'response.incomplete', response: buildResponse(state, 'incomplete', incompleteReason) }
    : { type: 'response.completed', response: buildResponse(state, 'completed') })
}

export function openAiChunkToResponsesEvents(chunk: Json, state: OpenAiToResponsesState): Json[] {
  const events: Json[] = []
  const first = asObject(asArray(chunk.choices)[0])
  const delta = asObject(first?.delta)
  state.id = asString(chunk.id) ?? state.id
  state.model = asString(chunk.model) ?? state.model
  state.created = asNumber(chunk.created) ?? state.created

  const text = openAiContentToText(delta?.content)
  if (text) {
    ensureStarted(state, events)
    if (!state.textStarted) openTextItem(state, events)
    state.text += text
    events.push({ type: 'response.output_text.delta', item_id: state.messageItemId, output_index: state.messageOutputIndex, content_index: 0, delta: text })
  }

  for (const rawCall of asArray(delta?.tool_calls)) {
    const call = asObject(rawCall)
    if (!call) continue
    ensureStarted(state, events)
    // 文本与工具调用分属不同输出项，切换前先收尾文本项
    closeTextItem(state, events, 'completed')

    const openAiIndex = asNumber(call.index) ?? 0
    const custom = asObject(call.custom)
    const fn = asObject(call.function)
    let item = state.toolItems.get(openAiIndex)
    if (!item) {
      const outputIndex = state.nextOutputIndex++
      item = {
        outputIndex,
        itemId: `${state.id}_fc_${outputIndex}`,
        // `custom` 子对象只在上游原生支持 custom 工具时出现，形态当场就定了；
        // function 子对象要先看名字，才能分辨是不是本服务降级出去的 custom 工具。
        ...(custom ? { kind: 'custom' as const, coerced: false } : classifyFunctionCall(asString(fn?.name) ?? '', state.toolNames)),
        callId: asString(call.id) ?? '',
        name: asString(custom?.name) ?? asString(fn?.name) ?? '',
        payload: '',
        emitted: 0,
        added: false,
        closed: false,
      }
      state.toolItems.set(openAiIndex, item)
    } else {
      // OpenAI 允许把 function.name / custom.name 拆进后续 delta，按片段拼接。
      // 原生 custom 调用的名字在 `custom.name` 里，降级过的仍在 `function.name` 里。
      const nameFragment = item.kind === 'custom' && !item.coerced ? asString(custom?.name) : asString(fn?.name)
      if (nameFragment) item.name += nameFragment
      // 名字到齐了就能分类；仍只是前缀就继续等。
      if (item.kind === undefined) Object.assign(item, classifyFunctionCall(item.name, state.toolNames))
    }

    const payloadDelta = custom ? asString(custom.input) : asString(fn?.arguments)
    if (payloadDelta) item.payload += payloadDelta

    // 还没分类：载荷先攒着，added 与 delta 都等分类之后再说。
    if (item.kind === undefined) continue

    if (!item.added) {
      item.added = true
      // 能查到映射就还原，查不到就先给原始名字。递增的 delta 在下面补发，
      // 收尾的 output_item.done 里一定会是还原后的完整寻址。
      events.push({
        type: 'response.output_item.added',
        output_index: item.outputIndex,
        item: toolCallItem(item.kind, item.itemId, item.callId, item.name, '', 'in_progress', state.toolNames),
      })
    }
    // 降级过的 custom 工具收到的是 JSON 参数（`{"input":"..."}`），不是客户端的自由文本，
    // 逐段外发会让客户端拿到一段段 JSON；收尾时一次解开（见 closeToolItem）。
    if (item.coerced) continue
    if (item.payload.length > item.emitted) {
      const delta = item.payload.slice(item.emitted)
      item.emitted = item.payload.length
      events.push(item.kind === 'custom'
        ? { type: 'response.custom_tool_call_input.delta', item_id: item.itemId, output_index: item.outputIndex, delta }
        : { type: 'response.function_call_arguments.delta', item_id: item.itemId, output_index: item.outputIndex, delta })
    }
  }

  const finish = asString(first?.finish_reason)
  if (finish) state.finishReason = finish
  const usage = openAiUsageToResponses(asObject(chunk.usage))
  if (usage) state.usage = usage

  if (state.finishReason) closeOpenItems(state, events)
  // 与 Anthropic 方向一致：拿到 finish_reason 与 usage 后收尾；usage 缺失时留待 flush
  if (state.finishReason && state.usage) complete(state, events)
  return events
}

export function finishOpenAiToResponses(state: OpenAiToResponsesState): Json[] {
  if (!state.started || state.completed) return []
  const events: Json[] = []
  complete(state, events)
  return events
}
