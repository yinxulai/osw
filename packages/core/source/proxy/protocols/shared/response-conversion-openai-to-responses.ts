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
 */

type ResponsesStatus = 'in_progress' | 'completed' | 'incomplete'

/** 工具调用输出项的类别；两类字段集不同，构造时按类别分流。 */
type ToolItemKind = 'function' | 'custom'

/**
 * Chat 的 `prompt_tokens_details` 是 `{ audio_tokens, cache_write_tokens, cached_tokens,
 * image_tokens, text_tokens }`，Responses 的 `input_tokens_details` 只有
 * `{ cache_write_tokens, cached_tokens }`。两者字段集不同，必须挑字段而不是整体搬运，
 * 否则会输出 Responses 规范里不存在的键。
 */
function openAiInputDetailsToResponses(inputDetails: unknown): Json | undefined {
  const details = asObject(inputDetails)
  if (!details) return undefined
  const cached = asNumber(details.cached_tokens)
  const created = asNumber(details.cache_write_tokens)
  if (cached === undefined && created === undefined) return undefined
  return {
    ...(created !== undefined ? { cache_write_tokens: created } : {}),
    ...(cached !== undefined ? { cached_tokens: cached } : {}),
  }
}

function openAiUsageToResponses(usage: Json | null): Json | undefined {
  if (!usage) return undefined
  const input = asNumber(usage.prompt_tokens) ?? asNumber(usage.input_tokens)
  const output = asNumber(usage.completion_tokens) ?? asNumber(usage.output_tokens)
  if (input === undefined && output === undefined) return undefined
  const inputDetails = openAiInputDetailsToResponses(usage.prompt_tokens_details ?? usage.input_tokens_details)
  const completionDetails = asObject(usage.completion_tokens_details) ?? asObject(usage.output_tokens_details)
  const reasoning = asNumber(completionDetails?.reasoning_tokens)
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
 * Chat 的 tool_call → Responses 的 `(kind, id, name, call_id, payload)`。
 *
 * `custom` 调用的载荷是自由文本而不是 JSON 字符串，所以字段名不同：
 * Responses 用 `input`（见 `CustomToolCall object`），Chat 也用 `input`
 * （见 `ChatCompletionMessageCustomToolCall`）。`function` 调用两边都叫 `arguments`。
 */
function openAiToolCallToResponses(call: Json): { kind: ToolItemKind, callId: string, name: string, payload: string } | null {
  const custom = asObject(call.custom)
  if (custom) {
    const name = asString(custom.name)
    if (!name) return null
    return { kind: 'custom', callId: asString(call.id) ?? '', name, payload: asString(custom.input) ?? '' }
  }
  const fn = asObject(call.function)
  const name = asString(fn?.name)
  if (!fn || !name) return null
  return { kind: 'function', callId: asString(call.id) ?? '', name, payload: asString(fn.arguments) ?? '' }
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
    const converted = openAiToolCallToResponses(call)
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
  kind: ToolItemKind
  callId: string
  name: string
  /** function 调用是 `arguments`（JSON 字符串），custom 调用是 `input`（自由文本），共用这一个累加器。 */
  payload: string
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
    items.push({ index: item.outputIndex, item: toolCallItem(item.kind, item.itemId, item.callId, item.name, item.payload, item.status ?? fallbackStatus, state.toolNames) })
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
  if (!item.added || item.closed) return
  item.closed = true
  item.status = status
  events.push(item.kind === 'custom'
    ? { type: 'response.custom_tool_call_input.done', item_id: item.itemId, output_index: item.outputIndex, input: item.payload }
    : { type: 'response.function_call_arguments.done', item_id: item.itemId, output_index: item.outputIndex, arguments: item.payload })
  events.push({
    type: 'response.output_item.done',
    output_index: item.outputIndex,
    item: toolCallItem(item.kind, item.itemId, item.callId, item.name, item.payload, status, toolNames),
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
    let item = state.toolItems.get(openAiIndex)
    if (!item) {
      const outputIndex = state.nextOutputIndex++
      // 流式下 `custom` 调用的名字与载荷都在 `custom` 子对象里，字段与 function 调用平行。
      const custom = asObject(call.custom)
      item = {
        outputIndex,
        itemId: `${state.id}_fc_${outputIndex}`,
        kind: custom ? 'custom' : 'function',
        callId: asString(call.id) ?? '',
        name: asString(custom?.name) ?? asString(asObject(call.function)?.name) ?? '',
        payload: '',
        added: false,
        closed: false,
      }
      state.toolItems.set(openAiIndex, item)
    }
    if (!item.added) {
      item.added = true
      // 流式下名字可能被拆成多个 delta；能查到映射就还原，查不到就先给原始名字，
      // 收尾的 output_item.done 里一定会是还原后的完整寻址。
      events.push({
        type: 'response.output_item.added',
        output_index: item.outputIndex,
        item: toolCallItem(item.kind, item.itemId, item.callId, item.name, item.payload, 'in_progress', state.toolNames),
      })
    }
    const custom = asObject(call.custom)
    const payloadDelta = custom ? asString(custom.input) : asString(asObject(call.function)?.arguments)
    if (payloadDelta) {
      item.payload += payloadDelta
      events.push(custom
        ? { type: 'response.custom_tool_call_input.delta', item_id: item.itemId, output_index: item.outputIndex, delta: payloadDelta }
        : { type: 'response.function_call_arguments.delta', item_id: item.itemId, output_index: item.outputIndex, delta: payloadDelta })
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
