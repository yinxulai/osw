import { asArray, asNumber, asObject, asString, stringifyContent, type Json } from './conversion-utils'
import { ToolNameRegistry, toTargetName } from './tool-name-registry'

/**
 * OpenAI Responses 请求 → OpenAI Chat Completions 请求。
 *
 * 字段依据见 apps/docs/upstream/openai-responses.md 与 apps/docs/upstream/openai-completions.md。
 *
 * Responses 的 `input` 是「输入项列表」（EasyInputMessage / function_call /
 * function_call_output / custom_tool_call / custom_tool_call_output / reasoning /
 * item_reference 等），与 Chat Completions 的 `messages` 不是一一对应，需要按项类型分别映射：
 * - EasyInputMessage / message ↔ 普通 message
 * - 连续的 function_call / custom_tool_call ↔ 合并为一个 assistant 消息的 `tool_calls`
 * - function_call_output / custom_tool_call_output ↔ `role: tool` 消息
 * - reasoning / item_reference ↔ 丢弃（无对应语义）
 *
 * Responses 的 `tools` 里还有 `type: "namespace"` 的嵌套工具组，组内工具用
 * `(namespace, name)` 共同寻址；Chat 没有命名空间维度，因此把组内工具展平成顶层工具，
 * 并把对应关系写进 `toolNames` 供响应侧还原（见 `tool-name-registry.ts`）。
 */

/**
 * Responses 的 `input_image.detail` 比 Chat Completions 多一个 `original`。
 * Chat 只接受 `auto` / `low` / `high`，无法等价的值直接丢弃，不自行折算。
 */
function responsesImageDetailToOpenAi(detail: unknown): string | undefined {
  return detail === 'auto' || detail === 'low' || detail === 'high' ? detail : undefined
}

function responsesContentPartsToOpenAi(content: unknown): Json[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  const parts: Json[] = []
  for (const raw of asArray(content)) {
    const part = asObject(raw)
    if (!part) continue
    if (part.type === 'input_text' || part.type === 'output_text' || part.type === 'text') {
      const text = asString(part.text)
      if (text === undefined) continue
      parts.push({ type: 'text', text, ...(part.prompt_cache_breakpoint ? { prompt_cache_breakpoint: part.prompt_cache_breakpoint } : {}) })
    } else if (part.type === 'input_image') {
      // Responses 的 `image_url` 是裸字符串（旧版客户端会包成 `{ url }`），两个形态都收。
      const imageUrl = asString(part.image_url) ?? asString(asObject(part.image_url)?.url)
      const detail = responsesImageDetailToOpenAi(part.detail)
      if (imageUrl) {
        parts.push({
          type: 'image_url',
          image_url: { url: imageUrl, ...(detail ? { detail } : {}) },
          ...(part.prompt_cache_breakpoint ? { prompt_cache_breakpoint: part.prompt_cache_breakpoint } : {}),
        })
      }
    }
    // input_file / input_audio / refusal 等无对应能力，丢弃
  }
  return parts
}

function partsToMessageContent(parts: Json[]): string | Json[] | null {
  if (parts.length === 0) return null
  if (parts.length === 1 && parts[0].type === 'text' && parts[0].prompt_cache_breakpoint === undefined) {
    return parts[0].text as string
  }
  return parts
}

/**
 * 命名空间描述带的是「这一组工具是干什么的」，是模型选工具时的上下文；Chat 的工具没有
 * 分组维度，只能把它拼进每个组内工具的描述里，否则这段语义在转换中直接蒸发。
 */
function toolDescriptionToOpenAi(tool: Json, namespaceDescription?: string): string {
  return [namespaceDescription, asString(tool.description)]
    .filter((part): part is string => Boolean(part))
    .join('\n\n')
}

function functionToolToOpenAi(tool: Json, name: string, namespaceDescription?: string): Json | null {
  if (!name) return null
  return {
    type: 'function',
    function: {
      name,
      description: toolDescriptionToOpenAi(tool, namespaceDescription),
      parameters: asObject(tool.parameters) ?? { type: 'object', properties: {} },
      ...(typeof tool.strict === 'boolean' ? { strict: tool.strict } : {}),
    },
  }
}

/**
 * 降级后的 custom 工具里那个自由文本参数。参数名固定为 `input`，与 custom 工具调用的
 * 载荷字段同名，响应侧还原时不必再猜。
 */
const CUSTOM_TOOL_INPUT_PARAMETER = {
  type: 'object',
  properties: {
    input: {
      type: 'string',
      description: 'The complete input for this tool as free-form text.',
    },
  },
  required: ['input'],
}

/**
 * custom 工具在 Chat Completions 里有对应的 `CustomTool`（见
 * apps/docs/upstream/openai-completions.md 的 `ChatCompletionCustomTool`），但它不在
 * 事实上的兼容子集里：OpenAI 自己之外，多数兼容供应商只实现 `type: "function"`，
 * 遇到 custom 直接以 `tools[N].type is invalid or missing` 拒绝整个请求。
 *
 * 所以这里统一降级成「只有一个字符串参数 `input`」的 function，并把上游名登记到
 * `ToolNameRegistry`，响应侧据此把 function 调用还原回 `custom_tool_call`。
 * 代价是 `format`（grammar）无法约束上游解码，模型可能产出不合语法的自由文本。
 *
 * 客户端给的描述里常常写着「不要用 JSON 包起来」（Codex 的 `apply_patch` 正是如此），
 * 而这里的 function 形态恰恰要求 JSON，必须补一句说明，否则模型会照描述裸写、参数不合法。
 */
function customToolToOpenAi(tool: Json, name: string, namespaceDescription: string | undefined, toolNames?: ToolNameRegistry): Json | null {
  if (!name) return null
  toolNames?.registerCustomTool(name)
  return {
    type: 'function',
    function: {
      name,
      description: [
        toolDescriptionToOpenAi(tool, namespaceDescription),
        'This tool takes free-form text. Put its complete input in the `input` string field, JSON-escaped.',
      ].filter(part => part.length > 0).join('\n\n'),
      parameters: CUSTOM_TOOL_INPUT_PARAMETER,
    },
  }
}

/** 单个 Responses 工具 → Chat 工具；Chat 不支持的类型返回 `null`。 */
function toolToOpenAi(tool: Json, name: string, namespaceDescription?: string, toolNames?: ToolNameRegistry): Json | null {
  if (tool.type === 'function') return functionToolToOpenAi(tool, name, namespaceDescription)
  if (tool.type === 'custom') return customToolToOpenAi(tool, name, namespaceDescription, toolNames)
  return null
}

/**
 * 顶层工具名在 Chat 里必须原样保留，因此要**先**占位：
 * - 展平结果不能把它们挤掉；
 * - 占位必须早于 `input` 转换：`input` 里可能带着 namespace 限定的历史调用，
 *   它也会登记展平名，若晚一步就会先到先得。
 * `custom` 工具与 `function` 工具一样，名字也原样下发且出现在 `tool_choice` 里，因此同样占位。
 */
function reserveTopLevelToolNames(raw: unknown, toolNames: ToolNameRegistry): void {
  for (const item of asArray(raw)) {
    const tool = asObject(item)
    if (tool?.type === 'function' || tool?.type === 'custom') toolNames.reserve(asString(tool.name) ?? '')
  }
}

/**
 * Responses 的 `tools` 是「工具或工具组」的联合：
 * - `type: "function"` 顶层工具 ↔ 原样映射，名字必须保持不变
 * - `type: "custom"` 顶层工具 ↔ 降级成「单字符串参数」的 function（见
 *   {@link customToolToOpenAi}），名字同样必须保持，并登记到 `toolNames` 供响应侧还原
 * - `type: "namespace"` 工具组 ↔ 组内的 function / custom 逐个展平成顶层工具，并把
 *   `(namespace, name)` ↔ 展平名 登记到 `toolNames`
 * - `mcp` / `tool_search` / `file_search` / `web_search` 等托管工具 ↔ 无对应能力，丢弃
 *
 * 输出顺序与输入一致（不把展平结果归堆），这样工具列表在多次请求间保持稳定，
 * 不会白白抖掉上游的 prompt cache。
 */
function responsesToolsToOpenAi(raw: unknown, toolNames: ToolNameRegistry): Json[] {
  reserveTopLevelToolNames(raw, toolNames)
  const tools: Json[] = []
  for (const item of asArray(raw)) {
    const tool = asObject(item)
    if (!tool) continue
    if (tool.type === 'function' || tool.type === 'custom') {
      const converted = toolToOpenAi(tool, asString(tool.name) ?? '', undefined, toolNames)
      if (converted) tools.push(converted)
      continue
    }
    if (tool.type !== 'namespace') continue
    const namespace = asString(tool.name)
    if (!namespace) continue
    const namespaceDescription = asString(tool.description)
    for (const rawNested of asArray(tool.tools)) {
      const nested = asObject(rawNested)
      if (!nested) continue
      const nestedName = asString(nested.name)
      if (!nestedName) continue
      const converted = toolToOpenAi(nested, toolNames.flatten(namespace, nestedName), namespaceDescription, toolNames)
      if (converted) tools.push(converted)
    }
  }
  return tools
}

/**
 * Responses 的 `tool_choice` → Chat 的 `tool_choice`。
 *
 * 客户端写的是**它自己声明的**名字，而上游只认展平名，所以 function / custom 两种形态都要
 * 借 `toolNames.locate` 换名字；这两个对象都只有 `name`、没有 `namespace`，
 * 因此消歧靠「唯一命中才换」（见 `tool-name-registry.ts`）。
 *
 * 形态上只有 `function` 一种：custom 工具已在上游被降级成 function，`ToolChoiceCustom`
 * 也必须跟着改形态，否则「工具没了、tool_choice 还在」会直接被上游拒掉。
 *
 * 没有对应能力的形态：
 * - `allowed_tools` 的「允许集合」在 Chat 里不存在，只保留 `mode` 的强制语义（`auto` / `required`）；
 * - 强制内置工具（`ToolChoiceMcp` / `ToolChoiceTypes` 等）所对应的工具本身也已被丢弃，
 *   整个 `tool_choice` 一并丢弃（Chat 缺省即 `auto`），不臆造替代值。
 */
function responsesToolChoiceToOpenAi(choice: unknown, toolNames: ToolNameRegistry): unknown {
  if (choice === 'auto' || choice === 'none' || choice === 'required') return choice
  const record = asObject(choice)
  if (!record) return undefined
  if (record.type === 'function') {
    const name = asString(record.name)
    if (!name) return undefined
    return { type: 'function', function: { name: toolNames.locate(name) ?? name } }
  }
  if (record.type === 'custom') {
    const name = asString(record.name)
    if (!name) return undefined
    // custom 工具已降级成 function（见 `customToolToOpenAi`），因此强制选择也跟着用
    // `function` 形态；继续下发 `type: "custom"` 会让拒绝 custom 的上游连这个字段一起拒掉。
    return { type: 'function', function: { name: toolNames.locate(name) ?? name } }
  }
  if (record.type === 'allowed_tools' && (record.mode === 'auto' || record.mode === 'required')) return record.mode
  return undefined
}

function responsesTextFormatToResponseFormat(text: unknown): Json | undefined {
  const format = asObject(asObject(text)?.format)
  if (!format) return undefined
  if (format.type === 'json_object') return { type: 'json_object' }
  // 两侧对 `name` 的约束相同（`a-z A-Z 0-9 _ -`，最长 64），而响应不回显这个名字，
  // 所以归一化是纯收益：客户端写得不规范也不会被上游拒掉。
  const name = toTargetName(asString(format.name) ?? '')
  if (format.type === 'json_schema' && name) {
    const schema = asObject(format.schema) ?? {}
    return {
      type: 'json_schema',
      json_schema: {
        name,
        schema,
        ...(typeof format.strict === 'boolean' ? { strict: format.strict } : {}),
        ...(asString(format.description) !== undefined ? { description: format.description } : {}),
      },
    }
  }
  return undefined
}

/** 追加一个工具调用到上一条 assistant 消息，或新建一条。 */
function appendToolCall(messages: Json[], call: Json): void {
  const last = asObject(messages[messages.length - 1])
  if (last?.role === 'assistant' && last.content === null && Array.isArray(last.tool_calls)) {
    ;(last.tool_calls as Json[]).push(call)
    return
  }
  messages.push({ role: 'assistant', content: null, tool_calls: [call] })
}

function functionCallToToolCall(source: Json, toolNames: ToolNameRegistry): Json | null {
  const name = asString(source.name)
  if (!name) return null
  const args = source.arguments
  // 带 `namespace` 的调用是工具组里的工具，模型在请求里看到的是展平名，历史消息必须
  // 用同一个展平名，否则模型会看到一个自己从没被给过的工具名。
  const namespace = asString(source.namespace)
  return {
    id: asString(source.call_id) ?? asString(source.id) ?? '',
    type: 'function',
    function: {
      name: namespace ? toolNames.flatten(namespace, name) : name,
      arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
    },
  }
}

/**
 * Responses 的 `custom_tool_call` → Chat 的 **function** 调用。
 *
 * 工具定义在请求里已经降级成单字符串参数的 function（见 `customToolToOpenAi`），
 * 历史调用必须跟着用同一种形态，否则模型会看到一个自己从没拿到过的 `custom` 工具。
 * `input` 是自由文本，这里按 `{"input": "..."}` 序列化成 function 参数。
 */
function customToolCallToToolCall(source: Json, toolNames: ToolNameRegistry): Json | null {
  const name = asString(source.name)
  if (!name) return null
  const namespace = asString(source.namespace)
  return {
    id: asString(source.call_id) ?? asString(source.id) ?? '',
    type: 'function',
    function: {
      name: namespace ? toolNames.flatten(namespace, name) : name,
      arguments: JSON.stringify({ input: asString(source.input) ?? '' }),
    },
  }
}

function pushToolOutput(messages: Json[], source: Json): void {
  messages.push({ role: 'tool', tool_call_id: asString(source.call_id) ?? '', content: stringifyContent(source.output) })
}

function pushRoleMessage(role: string, content: string | Json[] | null, messages: Json[]): void {
  if (content === null) return
  if (role === 'system' || role === 'developer') {
    messages.push({ role: 'system', content })
    return
  }
  messages.push({ role: role === 'assistant' ? 'assistant' : 'user', content })
}

/**
 * 处理 message 项的内容。Responses 规范把 function_call / function_call_output 定义为
 * 顶层输入项，但历史客户端（以及本仓库既有用例）会把它们嵌在 content 数组里，
 * 因此两种形态都要支持：遇到工具项时先冲刷已缓冲的普通内容，保证顺序不变。
 * custom 工具调用同属工具项，与 function 调用共用同一顺序规则。
 */
function convertMessageContent(role: string, content: unknown, messages: Json[], toolNames: ToolNameRegistry): void {
  if (typeof content === 'string') {
    if (content) pushRoleMessage(role, content, messages)
    return
  }
  let buffered: Json[] = []
  const flush = (): void => {
    if (buffered.length === 0) return
    pushRoleMessage(role, partsToMessageContent(buffered), messages)
    buffered = []
  }
  for (const rawPart of asArray(content)) {
    const part = asObject(rawPart)
    if (!part) continue
    if (part.type === 'function_call' || part.type === 'custom_tool_call') {
      flush()
      const call = part.type === 'function_call' ? functionCallToToolCall(part, toolNames) : customToolCallToToolCall(part, toolNames)
      if (call) appendToolCall(messages, call)
      continue
    }
    if (part.type === 'function_call_output' || part.type === 'custom_tool_call_output') {
      flush()
      pushToolOutput(messages, part)
      continue
    }
    buffered.push(...responsesContentPartsToOpenAi([rawPart]))
  }
  flush()
}

function convertInputItem(item: unknown, messages: Json[], toolNames: ToolNameRegistry): void {
  if (typeof item === 'string') {
    if (item) messages.push({ role: 'user', content: item })
    return
  }
  const record = asObject(item)
  if (!record) return

  if (record.type === 'function_call') {
    const call = functionCallToToolCall(record, toolNames)
    if (call) appendToolCall(messages, call)
    return
  }
  if (record.type === 'custom_tool_call') {
    const call = customToolCallToToolCall(record, toolNames)
    if (call) appendToolCall(messages, call)
    return
  }
  if (record.type === 'function_call_output' || record.type === 'custom_tool_call_output') {
    pushToolOutput(messages, record)
    return
  }
  if (record.type === 'reasoning' || record.type === 'item_reference') return

  const role = asString(record.role)
  if (!role) return
  convertMessageContent(role, record.content, messages, toolNames)
}

/**
 * Responses 请求 → Chat Completions 请求。
 *
 * 明确**不支持**的跨请求字段：`previous_response_id` / `store` / `conversation` /
 * `item_reference` / `include: ["reasoning.encrypted_content"]`。这些都要求服务端保存会话，
 * 而 Chat Completions 没有会话概念，转换器又必须无状态（适配器是模块级单例、服务全部并发请求），
 * 所以直接丢弃、不编造近似值；丢了什么可以从 `request_contents` 与 `attempt_contents` 的差异看出来。
 * 详细清单见 apps/docs/specs/proxy/protocol-conversion.md「不可逆字段与已知限制」。
 */
export function responsesToOpenAiRequest(body: Json, model: string, toolNames: ToolNameRegistry = new ToolNameRegistry()): Json {
  // 占位要早于 input 转换：历史里的 namespace 限定调用也会往同一张表里登记展平名。
  reserveTopLevelToolNames(body.tools, toolNames)
  const messages: Json[] = []
  const instructions = asString(body.instructions)
  if (instructions) messages.push({ role: 'system', content: instructions })

  if (typeof body.input === 'string') {
    if (body.input) messages.push({ role: 'user', content: body.input })
  } else {
    for (const item of asArray(body.input)) convertInputItem(item, messages, toolNames)
  }

  const result: Json = { model, messages }

  for (const field of ['prompt_cache_key', 'prompt_cache_retention', 'prompt_cache_options', 'metadata', 'user', 'parallel_tool_calls'] as const) {
    if (body[field] !== undefined) result[field] = body[field]
  }

  const maxTokens = asNumber(body.max_output_tokens)
  if (maxTokens !== undefined) result.max_tokens = maxTokens
  const temperature = asNumber(body.temperature)
  if (temperature !== undefined) result.temperature = temperature
  const topP = asNumber(body.top_p)
  if (topP !== undefined) result.top_p = topP
  if (body.stream === true) result.stream = true

  const effort = asString(asObject(body.reasoning)?.effort)
  if (effort) result.reasoning_effort = effort

  const tools = responsesToolsToOpenAi(body.tools, toolNames)
  if (tools.length > 0) result.tools = tools

  const toolChoice = responsesToolChoiceToOpenAi(body.tool_choice, toolNames)
  if (toolChoice !== undefined) result.tool_choice = toolChoice

  const responseFormat = responsesTextFormatToResponseFormat(body.text)
  if (responseFormat) result.response_format = responseFormat

  return result
}
