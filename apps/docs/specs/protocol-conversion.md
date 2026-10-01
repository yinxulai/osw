# 协议兼容转换器

## 背景与定位

现有架构默认优先原生透传：客户端协议通常应与 Provider 模型端点协议一致。对明确开启端点级转换的绑定，代理也可以提供有限的协议转换能力；未开启转换时，协议不匹配的端点不会进入候选集合。

协议兼容转换器（Protocol Conversion）作为**可选能力**打破这一限制：为具体 ProviderModel 端点绑定创建并启用对应的 protocol_converter 后，代理将客户端协议的请求/响应报文转换为配置端点所要求的 upstream 协议，包括流式 SSE 事件的实时转换。这里的 upstream 是请求链路概念，不预设当前目标一定是供应商；Provider 仍仅表示配置实体。

> 转换是尽力而为的兼容层，不是完整语义等价。不支持的字段会被丢弃或降级，文档与 UI 中必须明确提示。

## 核心概念

### 转换开关

- 协议转换器位于**ProviderModel 端点绑定 × 客户端协议**级别，存储在 `protocol_converters`。每条记录代表一个可选的客户端协议转换器。
- 关闭（默认）：维持现状，绑定只服务 Provider 默认端点的原生协议。
- 开启：只允许明确配置的客户端协议经过转换后使用该绑定，不会让该 ProviderModel 的所有端点隐式开放转换。
- 转换配置关联 `provider_model_endpoints`，而不是直接关联 `provider_models`：同一 Provider 模型可以绑定多个 Provider 端点，每个端点支持的转换矩阵可以不同。

### 转换对（Conversion Pair）

- 一个转换对记作 `客户端协议 → 端点原生协议`，如 `anthropic-messages → openai-completions`
- 转换对由**端点原生协议**决定：开启开关后，端点自动获得「其他两种协议 → 本协议」的转换能力
- 每个转换对由独立的转换器模块实现，可单独标记支持度（完整 / 部分 / 不支持）

### 转换矩阵

矩阵的唯一权威是 `packages/core/source/proxy/protocols/shared/conversion-registry.ts`。当前注册的方向恰好是最常用的三个：

| 客户端协议 | Provider openai-completions | Provider openai-responses | Provider anthropic-messages |
|-----------|------------------------|----------------------|------------------------|
| openai-completions | 直连 | 未实现 | 已实现 |
| openai-responses | 已实现 | 直连 | 未实现 |
| anthropic-messages | 已实现 | 未实现 | 直连 |

已实现的三个方向：

1. `anthropic-messages → openai-completions`：让 Claude 系工具用 OpenAI 兼容渠道
2. `openai-responses → openai-completions`：让 Responses API 客户端用 Chat Completions 渠道
3. `openai-completions → anthropic-messages`：让 OpenAI 系工具用 Anthropic 渠道

其余三个方向的组合在注册表里不存在，会被当作「该协议下无可用端点」拒绝，不会静默降级。新增一个方向 = 在注册表的请求表与响应表里各加一行，不动流程代码。

## 请求处理流程

```
客户端请求 (协议 A)
  → 协议识别 (path) 得到 A
  → 候选过滤：
      原生匹配：providerEndpoint.protocol === A 且未开启转换 —— 原生候选
      转换匹配：存在 A → providerEndpoint.protocol 的已启用 protocol_converter —— 转换候选
  → 排序：原生候选优先于转换候选（同优先级内）
  → 尝试某个候选：
      原生候选：现有透传路径
      转换候选：请求体 A → B 转换 → 发送 → 响应体/SSE B → A 反向转换 → 返回客户端
```

### 候选过滤与排序规则

- 原生端点始终优先：只有当所有原生候选失败后，才尝试转换候选
- 转换候选之间按模型优先级排序
- 某方向转换器标记为「不支持」时，该组合不出现在候选中
- 过滤后为空仍返回「当前协议下无可用 ProviderModel」

### 转换失败语义

| 阶段 | 行为 |
|------|------|
| 客户端请求体无法解析/转换 | 返回 400，不切换（等价于请求格式错误） |
| Provider 返回可切换错误（429/5xx/网络等） | 正常分类，照常切换下一个候选 |
| Provider 返回 200 后响应体转换失败（非流式） | 记录错误日志，返回 502，不切换（数据已产生） |
| 流式转换中途失败 | 终止流，向客户端发送协议对应的错误事件后关闭，记录失败，不切换 |

### 流式转换

- SSE 事件需逐事件转换：如 Provider `chat.completion.chunk` → 客户端 `anthropic` 的 `message_start / content_block_delta / message_delta / message_stop` 事件序列
- 转换器维护有状态上下文（如 Anthropic 流需要合成 `message_start`、分配 content block index）
- usage 统计在转换层从上游格式解析后按客户端协议格式回填
- 空闲超时、切换边界规则与透传路径一致：一旦已向客户端下发转换后的事件，不再切换

#### 流式状态机约定

| 方向 | 约定 |
|------|------|
| OpenAI Completions → Anthropic Messages | content block index 由转换器统一分配：文本块占用首个 index，`tool_calls` 的 OpenAI index 通过映射表固定到各自的 Anthropic index，不允许直接复用 OpenAI 的 tool index |
| OpenAI Completions → Anthropic Messages | `message_start` 在首次出现内容时合成；`message_delta` + `message_stop` 仅在同时拿到 `finish_reason` 与 `usage` 后发出；上游提前结束（缺 `usage`）时在流结束时用最近一次 `finish_reason` 兜底关闭 |
| Anthropic Messages → OpenAI Completions | Anthropic 的 block index 会重新压缩为连续的 OpenAI `tool_calls` index；`thinking_delta`、`content_block_stop` 等无对应语义的事件被忽略；`message_delta` 缺少 `stop_reason` 时只回填 usage，由 `message_stop` 兜底补 `finish_reason` |
| OpenAI Completions → OpenAI Responses | 必须合成完整事件生命周期：`response.created` → `response.in_progress` → `output_item.added` → `content_part.added` → `output_text.delta`* → `output_text.done` → `content_part.done` → `output_item.done` → 终止事件；文本 item 在切换到 function call item 前必须先关闭 |
| OpenAI Completions → OpenAI Responses | 终止事件取决于上游 `finish_reason`：`length` / `content_filter` 用 `response.incomplete` 并携带 `incomplete_details.reason`（`max_output_tokens` / `content_filter`），其余用 `response.completed`；两种终止都携带完整 `output` 与 `usage`，item 自身的 `status` 与其 `output_item.done` 事件保持一致 |
| OpenAI Completions 上游 → 任意客户端 | 上游 `data: [DONE]` 只表示 OpenAI SSE 结束，转换器必须消费并丢弃，不能转发给 Anthropic Messages 或 OpenAI Responses 客户端 |
| 任意方向 | `flush()` 与 `finish()` 必须幂等；即使没有残留缓冲也要补齐收尾事件，保证客户端总能收到终止事件 |

## 数据模型变更

- 新增 `provider_endpoints`：Provider 按原生协议维护默认端点。
- `provider_model_endpoints`：将 ProviderModel 绑定到 ProviderEndpoint，可选配置模型专属 `url`；为空时回退到 `provider_endpoints.url`，供应商端点也没有地址时保存会被拒绝（`ENDPOINT_URL_MISSING`）。
- 反向同样受保护：撤销或停用供应商上某个协议的地址会连带摘掉所有挂在该协议上的模型（哪怕模型自己有地址），因此供应商保存也会拒绝（`ENDPOINT_URL_IN_USE`）。
- 新增 `protocol_converters`：按 ProviderModel 端点绑定和客户端协议配置 `enabled`；目标 upstream 协议通过 `provider_model_endpoints.providerEndpointId -> provider_endpoints.protocol` 得到。
- `request_logs.clientProtocol` 记录客户端协议；请求级不再保存 upstream 协议摘要；每次 attempt 的真实 upstream 协议必须记录在 `request_attempts.upstreamProtocol`，与客户端协议不同即表示发生了转换。
- Token 和其他用量按视角保存到 `request_usages`（请求级）与 `attempt_usages`（尝试级），原始 `usage` 报文以 `type = 'raw'` 的行保存在同一组表里；不再有通用指标 KV 表。
- `request_attempts.upstreamProtocol` 为 nullable，记录本次尝试实际使用的端点协议，不依赖当前端点配置推导；upstream 返回的请求标识记录在 `upstreamRequestId`。
- **转换事实不单独建表。** `request_logs.clientProtocol` 与 `request_attempts.upstreamProtocol` 不相等即为「发生了转换」的充要判据；上游跳以什么形态作答读 `request_attempts.upstreamTransport`，耗时读 `request_attempts.durationMilliseconds`。原因：一份独立的转换表只能重复保存前两张表已持有的信息，且其中的耗时列会与 `request_attempts.durationMilliseconds` 形成一份会漂移的副本；“没发生转换”与“转换记录丢失”在该表里也不可区分。转换前后的载荷由 `request_contents`（客户端侧）与 `attempt_contents`（上游侧）分别唯一提供。
- 修改器仅记录协议转换边界之后的报文：请求侧记录协议转换后的 upstream 原始请求与修改后供应商请求；响应侧记录协议转换后的 client 原始响应与修改后客户端响应。修改器不处理客户端原始请求、供应商原始响应或转换器内部的中间报文。

## UI 设计

#### 请求详情报文链路

请求详情必须按真实报文经过的阶段展示，而不是把所有请求头和正文简单平铺。修改器不是客户端协议转换器的一部分：它始终位于协议转换完成之后，分别处理发送到真实供应商前的请求，以及返回到客户端前的响应。

普通请求：

```text
客户端原始请求
  → 协议转换（无操作，仅保持原协议）
  → 请求修改器
  → 真实供应商
  → 协议转换（无操作，仅保持原协议）
  → 响应修改器
  → 客户端
```

协议转换请求：

```text
客户端原始请求
  → 协议转换后的上游请求
  → 请求修改器
  → 真实供应商
  → 协议转换后的客户端响应
  → 响应修改器
  → 客户端
```

其中：

- 客户端原始请求是客户端发来的报文，不执行修改器；
- 请求修改器处理协议转换后的最终 upstream 请求，处理结果才发送到真实供应商；
- 真实供应商响应先经过反向协议转换，得到客户端协议形态的响应；
- 响应修改器处理协议转换后的最终 client 响应，处理结果才写回客户端；
- 修改器不处理供应商原始响应，也不处理协议转换器内部的中间响应。

普通请求没有跨协议转换时，两个转换步骤均可视为原协议下的 identity 操作。这样可以统一管线语义：请求修改器始终贴近真实供应商请求，响应修改器始终贴近最终客户端响应。

每个报文阶段显示协议标签、阶段描述以及“转换前/转换结果”和“修改后”状态。没有执行修改器时只显示执行摘要，不重复保存相同正文；没有发生协议转换时不显示虚假的转换阶段。

#### 模型编辑表单

- 每个 ProviderModel 端点绑定条目内提供客户端协议转换配置：「添加转换协议」+ 说明文案「仅允许选中的客户端协议经过转换后使用此端点（兼容层，部分参数可能丢失）」

### 逻辑模型页

- 每个 ProviderModel 条目的协议徽标区：
  - 原生协议：现有实心徽标（如 `OpenAI Completions`）
  - 转换支持的协议：特殊徽标——带转换图标的描边样式（如 `⟳ Anthropic Messages`），hover 提示「经协议转换支持」
- 排序展示上，模型条目可同时出现原生徽标 + 若干转换徽标，原生在前
- 手动切换选择器中，候选项同样以徽标区分原生/转换，避免用户误选

### 请求日志

- 协议列在发生转换时显示 `Anthropic Messages → OpenAI Completions` 组合标签
- 筛选器按客户端协议过滤（保持现有语义）

## 转换器模块设计

```
packages/core/source/proxy/protocols/
  shared/
    conversion-utils.ts                          # JSON 取值/序列化工具，畸形输入统一降级
    conversion-registry.ts                       # 转换矩阵：3 个请求方向 + 3 个镜像响应方向
    request-conversion.ts                        # convertRequestBody 入口：按方向分发
    request-conversion-openai-to-anthropic.ts
    request-conversion-anthropic-to-openai.ts
    request-conversion-responses-to-openai.ts
    response-conversion.ts                       # convertResponseBody + createSseConverter 入口
    response-conversion-openai-to-anthropic.ts   # 非流式 + 有状态 SSE
    response-conversion-anthropic-to-openai.ts   # 非流式 + 有状态 SSE
    response-conversion-openai-to-responses.ts   # 非流式 + 有状态 SSE（Responses 事件生命周期）
    tool-name-registry.ts                        # 一次上游尝试的转换上下文：展平名 ↔ (namespace, name)，含 locate / restore 双向查询
    types.ts                                     # StreamConverter / NativeProtocolAdapter / ProtocolConversionAdapter
  registry.ts                                    # 转换器注册表：按 (endpointProtocol, clientProtocol) 分发
```

每个方向的实现都拆成「请求转换」与「响应转换」两个文件，响应转换文件同时导出非流式转换函数、状态工厂（`create*State`）、逐事件转换函数（`*Events`）与收尾函数（`finish*`），便于对状态机做单元测试而无需构造完整 SSE 流。

**一次尝试的转换上下文**：可逆展平需要响应侧拿到请求侧登记过的对照表，而转换器是模块级单例（进程启动创建一次、服务全部并发请求），所以上下文**不能存在转换器上**，只能作为参数逐层透传：`attempt-executor.ts` 每次尝试新建 `ToolNameRegistry` → 请求修改器 → `convertRequestBody` → 方向转换器；同一实例再传给响应修改器 → `convertResponseBody` / `createSseConverter`。省略时按「不记录上下文」处理，展平仍然生效、只是响应侧不还原。

`ProtocolConversionAdapter` 接口（每个方向一个，见 `shared/types.ts`）：

```ts
interface ProtocolConversionAdapter {
  readonly kind: 'conversion'
  readonly requiresResponseConversion: true
  prepareRequest(context, providerModelName, toolNames?): Buffer
  convertResponse(body: Buffer, toolNames?): Buffer               // Provider → 客户端（非流式）
  createStreamConverter(toolNames?): StreamConverter              // Provider SSE → 客户端 SSE
  finishStream(converter: StreamConverter): string
}
```

- 转换器为纯函数 + 流式状态机，不依赖网络与数据库，便于单测
- 适配器按方向在 `registry.ts` 里模块加载时创建一次并全局复用，因此只能是无状态的；请求级上下文只能走参数
- handler 在透传路径之外新增转换路径分支，复用现有的认证注入、URL 解析、错误分类、日志与用量统计逻辑

## 字段映射原则

- **保守转换**：无法映射的字段丢弃即可，不报错；判断某字段是否被丢以报文为准（转换前后载荷分别由 `request_contents` / `attempt_contents` 记录）
- **修改器边界**：请求修改器在 upstream 请求转换完成后、发送真实供应商前执行；响应修改器在真实供应商响应完成反向协议转换、写回客户端前执行。修改器不介入协议转换器内部的中间报文。
- **系统提示词**：`system` 顶层字段 ↔ `messages` 中 `role: system` 首条消息
- **工具调用**：OpenAI `tool_calls` ↔ Anthropic `tool_use` / `tool_result` content block 双向映射；assistant 消息同时含文本与工具调用时两者都要保留，连续的 `role: tool` 结果必须合并进同一条消息的多个 `tool_result` block，以维持 OpenAI 要求的「工具结果紧随 assistant」顺序
- **工具选择**：`tool_choice` 四种形态双向映射（`auto` / `required` ↔ `any` / `none` / 指定工具）；`parallel_tool_calls: false` ↔ `disable_parallel_tool_use: true`
- **工具命名空间**：Responses 的 `type: "namespace"` 工具组把 function / custom 工具嵌套在一个共享命名空间下，Chat Completions 与 Anthropic 都没有对应容器，因此**可逆展平**：组内 function / custom 逐个提升为顶层工具，名字按 `namespace__name` 拼接（非法字符换下划线、截到 64 字符以符合 Chat 命名约束），组成员同名时追加 `__2` / `__3` 等序号，命名空间自己的 `description` 并入每个成员描述的开头。展平不是纯字符串改写：展平名 ↔ `(namespace, name)` 的对照表记在**一次上游尝试的内存上下文**里（`ToolNameRegistry`，请求转换写入、响应转换读取，随尝试结束丢弃），响应侧据此把 `namespace` 字段还原回 `function_call` / `custom_tool_call` 项。所以客户端看到的工具寻址与 Responses 原生语义一致，模型只看到 Chat 合法的扁平名字；顶层工具名优先原样保留，展平结果让位（顶层占位必须早于 `input` 转换，因为历史消息里的 namespace 限定调用也会登记展平名）。
- **工具选择的展平改写**：`tool_choice` 是「客户端写名字、上游按名字找工具」，所以展平后必须跟着改写目标名字（`ToolNameRegistry.locate`：原始名 → 展平名），否则上游会报「未知工具」。消歧保守：顶层工具名原样下发；同名工具落在多个命名空间时**不改写**（`ToolChoiceFunction` / `ToolChoiceCustom` 只有 `name`，没有命名空间维度，猜错工具比让上游报错更糟）。`ToolChoiceAllowed` 在 Chat 里没有「允许集合」概念，退化为其 `mode`（`auto` / `required`）；强制内置工具的变体（`mcp` / `web_search` 等）对应的工具本身已被丢弃，不臆造替代值。
- **自定义工具（custom tool）**：`type: "custom"` 没有 JSON Schema 参数，输入是自由文本，Responses ↔ Chat 双向映射；`format` 两侧嵌套层级不同（Responses 是 `{ type, definition, syntax }`，Chat 多一层 `{ type: "grammar", grammar: { definition, syntax } }`），必须逐字段重建；`syntax` 不是 `lark` / `regex` 时整个 `format` 丢弃。调用项同理：`custom_tool_call` ↔ `tool_calls[].type: "custom"`，载荷字段叫 `input`（不是 `arguments`），且 `CustomToolCall` 没有 `status` 字段，不能照抄 `function_call` 的骨架。
- **Responses 输入项**：`input` 数组中的 `function_call` / `function_call_output` / `custom_tool_call` / `custom_tool_call_output` 既可出现在顶层项，也可内嵌在 `message.content` 中，两种形态都要识别，连续的调用项合并进同一条 assistant 消息的 `tool_calls`；`reasoning` / `item_reference` 无对应语义，直接丢弃
- **采样参数**：`temperature` / `top_p` 直接映射；长度上限读 `max_completion_tokens` 优先于已弃用的 `max_tokens`（Responses 为 `max_output_tokens`），目标协议没有对应字段时降级为目标协议的必填上限；`stop` ↔ `stop_sequences`；`reasoning.effort` ↔ `reasoning_effort`
- **结束原因**：`stop` ↔ `end_turn` / `stop_sequence`、`length` ↔ `max_tokens`、`tool_calls` ↔ `tool_use`、`content_filter` ↔ `refusal`；Anthropic `model_context_window_exceeded` 归到 `length`（同为「被上限截断」），`pause_turn` 等单侧取值退回 `stop`
- **usage 明细**：按目标协议格式回填并裁剪字段集，不整体搬运；不能把 OpenAI 总输入与 Anthropic 未缓存输入直接等同。`*_tokens_details` 只保留目标协议声明的键（如 OpenAI 输入明细有 5 个键，Responses `input_tokens_details` 只有 `cache_write_tokens` / `cached_tokens`）；Anthropic `message_delta.usage` 的输入侧字段允许为 null，不得覆盖 `message_start` 已给出的计数
- **多模态**：图片 base64 双向映射；`detail` 只传递目标协议支持的取值（Responses 的 `original` 在 Chat Completions 不存在，丢弃而非折算）；视频等单侧能力降级为文本提示
- **不映射的单侧能力**：Anthropic `tool_result.is_error`、`tool_choice.allowed_tools`（只保留 `mode`，见上）、Chat 的 `input_audio` / `file` 内容段在另一协议无对应语义，按保守转换丢弃；Responses 工具对象的 `allowed_callers` / `async` / `defer_loading` / `output_schema`，以及 `tool_search` / `mcp` / `file_search` / `web_search` 等托管工具也不属于函数调用语义，只保留 `name` / `description` / `parameters` / `strict`。单向能力：从 Chat 上游回到 **Anthropic** 客户端时，`tool_calls[].type: "custom"` 认不出（Anthropic 没有自由文本工具概念），整个调用项丢弃；而在 Responses 客户端方向上是可逆映射的
- 不做角色扮演式 hack（不注入「你在扮演 Claude」之类的提示词）

### 不可逆字段与已知限制

转换器是**无状态**的：一次请求的转换上下文（`ToolNameRegistry`）只覆盖一次尝试，进程不保存任何跨请求的会话状态，也不落库。因此以下 Responses 字段无法映射到 Chat Completions，按保守转换丢弃，且**不会**被降级成「假装能用」的近似值 —— 客户端拿到的是目标协议的原生语义，需要跨请求能力的场景不适用于本转换对：

| 字段 | 为什么丢 | 影响 |
|---|---|---|
| `previous_response_id` | Chat Completions 没有服务端会话概念，转换器也不保存响应 | 客户端必须每次自带完整 `input`；只靠 id 续话会丢上下文 |
| `store` | 无服务端存储，转换后永远不落库 | 依赖「服务端存了、下次能取」的用法不可用 |
| `conversation` | 同上 | 同上 |
| `item_reference` | 需要服务端已有该项才能解析 | 输入项直接丢弃 |
| `include: ["reasoning.encrypted_content"]` | Chat 不产出加密推理内容，没有可回传的载荷 | 该 `include` 值无效果 |
| Anthropic `tool_result.is_error` | 反向目标协议没有该标志 | 错误标志丢失，内容仍在 |

同一个转换器**必须保持无状态**：适配器在模块加载时创建一次、服务全部并发请求（见上文「一次尝试的转换上下文」），任何跨请求状态都会在并发下串请求。要支持服务端会话必须新建一层存储，而不是在转换器里加缓存。

流式 `custom_tool_call` 的事件名依据不足：本地规范收录的 Responses SSE 事件只有 `response.content_part.*` / `response.output_item.*` / `response.output_text.*`，`response.function_call_arguments.*` 与 `response.custom_tool_call_input.*` 都没有权威定义。转换器按 `output_item.done` 的 item 结构对齐字段（`arguments` / `input`）发出，名称与 Responses 官方 SDK 惯例一致，但**未经验证**；接入真实上游后需要按实际报文复核。字段取值本身是确定的，只有事件名属于推测。

### Prompt Cache 兼容边界

输入 token 统一按以下口径处理：

- OpenAI `prompt_tokens` / `input_tokens` 表示总输入。
- Anthropic `input_tokens` 只表示未缓存输入，总输入为 `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`。
- OpenAI Completions → Anthropic Messages 时，从总输入中扣除 `cached_tokens` 和 `cache_write_tokens`；异常数据使用 0 作为未缓存输入下限。
- Anthropic Messages → OpenAI Completions 时，将未缓存、缓存读取和缓存创建三部分相加，并把读取/写入分别放入 `*_tokens_details`。
- 非流式与 SSE 最终 usage 必须使用相同公式。Anthropic SSE 的输入 usage 可能位于 `message_start`、输出 usage 位于 `message_delta`，转换器必须合并后输出。

请求缓存控制采用保守的 best-effort 映射：

| 来源能力 | 目标映射 | 限制 |
|---|---|---|
| OpenAI `prompt_cache_options.mode=implicit` | Anthropic 顶层 `cache_control: { type: "ephemeral" }` | 仅表示启用自动缓存，不保证目标模型支持 |
| Anthropic 顶层 `cache_control` | OpenAI `prompt_cache_options.mode=implicit` | 仅表示启用自动缓存 |
| OpenAI 文本/图片 `prompt_cache_breakpoint.mode=explicit` | Anthropic block `cache_control: { type: "ephemeral" }` | 仅转换显式断点 |
| Anthropic 文本 block `cache_control` | OpenAI content block `prompt_cache_breakpoint.mode=explicit` | TTL 不可等价时丢弃 |
| Responses `prompt_cache_key` / `prompt_cache_retention` / `prompt_cache_options` | Chat Completions 同名字段 | 同属 OpenAI 协议族时原样保留 |
| 工具定义上的缓存断点 | 不映射 | OpenAI 工具对象没有已验证的显式 breakpoint 字段位置 |
| Gemini 显式 CachedContent 资源 | 不映射 | 当前转换器不创建、引用或管理缓存资源生命周期 |

缓存字段是否生效仍取决于具体 API、端点和模型版本。转换器不伪造 cache key，不把 Anthropic `5m` / `1h` TTL 猜测为 OpenAI TTL，也不把 Google OpenAI-compatible 端点当作原生 Gemini CachedContent API。观测层兼容 OpenAI read/write details、Anthropic read/write 与 TTL 明细，以及 Gemini `cachedContentTokenCount` / `total_cached_tokens`。

## 验收清单

以下条目需要在真实供应商上人工逐条回归；未完成前不计入发布验收。

- [ ] ProviderModel 端点绑定启用对应转换后，`anthropic-messages` 客户端请求能经 `openai-completions` 端点成功返回，非流式与流式均正常
- [ ] 候选模型中同时存在原生候选与转换候选时，原生候选优先；原生全部失败后自动落到转换候选
- [ ] 转换候选失败（429/5xx）时照常切换，错误分类与透传一致
- [ ] 客户端请求体不合法时返回 400 且不切换
- [ ] 流式转换中途中断时，客户端收到协议对应的错误事件，连接正常关闭
- [ ] 逻辑模型页能区分原生徽标与转换徽标
- [ ] 请求日志正确显示 `客户端协议 → Provider 协议`
- [ ] `openai-responses` 客户端 + `openai-completions` 端点：命名空间工具（含组内 custom 成员）可用，模型返回的调用在响应里带正确的 `namespace`，`tool_choice` 指定组内工具时上游不报「未知工具」
- [ ] 同上组合：`custom` 工具（自由文本 / Grammar）的声明、调用与 `custom_tool_call_output` 历史往返一致，流式事件名与 Responses 官方 SDK 实际行为一致
- [ ] Anthropic 客户端 + Chat 上游：上游返回 `tool_calls[].type: "custom"` 时不产生无名 `tool_use` 块，也不留半截未闭合的 content block
- [ ] 开关关闭的模型行为与现状完全一致（回归）
