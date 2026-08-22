# 协议兼容转换器

## 背景与定位

现有架构默认优先原生透传：客户端协议通常应与 Provider 模型端点协议一致。对明确开启端点级转换的绑定，代理也可以提供有限的协议转换能力；未开启转换时，协议不匹配的端点不会进入候选队列。

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

### MVP 转换矩阵

| 客户端协议 | Provider openai-completions | Provider openai-responses | Provider anthropic-messages |
|-----------|------------------------|----------------------|------------------------|
| openai-completions | 直连 | 转换（P2） | 转换（P1） |
| openai-responses | 转换（P1） | 直连 | 转换（P2） |
| anthropic-messages | 转换（P1） | 转换（P2） | 直连 |

P1 优先实现三个最高频方向：

1. `anthropic-messages → openai-completions`：让 Claude 系工具用 OpenAI 兼容渠道
2. `openai-responses → openai-completions`：让 Responses API 客户端用 Chat Completions 渠道
3. `openai-completions → anthropic-messages`：让 OpenAI 系工具用 Anthropic 渠道

## 请求处理流程

```
客户端请求 (协议 A)
  → 协议识别 (path) 得到 A
  → 队列过滤：
      原生匹配：providerEndpoint.protocol === A 且未开启转换 —— 原生候选
      转换匹配：存在 A → providerEndpoint.protocol 的已启用 protocol_converter —— 转换候选
  → 排序：原生候选优先于转换候选（同优先级内）
  → 尝试某个候选：
      原生候选：现有透传路径
      转换候选：请求体 A → B 转换 → 发送 → 响应体/SSE B → A 反向转换 → 返回客户端
```

### 队列过滤与排序规则

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

## 数据模型变更

- 新增 `provider_endpoints`：Provider 按原生协议维护默认端点。
- `provider_model_endpoints`：将 ProviderModel 绑定到 ProviderEndpoint，可选配置模型专属 `url`；为空时回退到 `provider_endpoints.url`。
- 新增 `protocol_converters`：按 ProviderModel 端点绑定和客户端协议配置 `enabled`；目标 upstream 协议通过 `provider_model_endpoints.providerEndpointId -> provider_endpoints.protocol` 得到。
- `request_logs.clientProtocol` 记录客户端协议；请求级 `request_logs.upstreamProtocol` 仅作为可选摘要；每次 attempt 的真实 upstream 协议必须记录在 `request_attempts.upstreamProtocol`，与客户端协议不同即表示发生了转换。
- 新增 `request_metrics`：按请求保存可扩展数值指标；Token 和其他用量保存到 `request_usages`。
- `request_attempts.upstreamProtocol` 为 nullable，记录本次尝试实际使用的端点协议，不依赖当前端点配置推导；upstream 返回的请求标识记录在 `upstreamRequestId`。
- `RequestConversion` 独立记录 client/upstream 两侧协议、Header、正文和流式状态，不嵌入 `request_contents`。
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

### 队列控制页

- 每个 ProviderModel 条目的协议徽标区：
  - 原生协议：现有实心徽标（如 `OpenAI`）
  - 转换支持的协议：特殊徽标——带转换图标的描边样式（如 `⟳ Anthropic`），hover 提示「经协议转换支持」
- 排序展示上，模型条目可同时出现原生徽标 + 若干转换徽标，原生在前
- 手动切换选择器中，候选项同样以徽标区分原生/转换，避免用户误选

### 请求日志

- 协议列在发生转换时显示 `Anthropic → OpenAI` 组合标签
- 筛选器按客户端协议过滤（保持现有语义）

## 转换器模块设计

```
source/server/conversion/
  index.ts                  # 转换器注册表：CONVERTERS[fromProtocol][toProtocol]
  types.ts                  # Converter 接口与支持度枚举
  request/
    anthropic-to-openai-completions.ts
    responses-to-openai-completions.ts
    openai-completions-to-anthropic.ts
  response/                 # 非流式响应反向转换
  stream/                   # SSE 逐事件有状态转换
```

`Converter` 接口（每个方向一组）：

```ts
interface ProtocolConverter {
  support: 'full' | 'partial' | 'unsupported'
  convertRequest(body: unknown): unknown          // 客户端 → Provider
  convertResponse(body: unknown): unknown         // Provider → 客户端（非流式）
  createStreamConverter(): StreamConverter        // Provider SSE → 客户端 SSE
}
```

- 转换器为纯函数 + 流式状态机，不依赖网络与数据库，便于单测
- handler 在透传路径之外新增转换路径分支，复用现有的认证注入、URL 解析、错误分类、日志与用量统计逻辑

## 字段映射原则

- **保守转换**：无法映射的字段丢弃并记录 debug 日志，不报错
- **修改器边界**：请求修改器在 upstream 请求转换完成后、发送真实供应商前执行；响应修改器在真实供应商响应完成反向协议转换、写回客户端前执行。修改器不介入协议转换器内部的中间报文。
- **系统提示词**：`system` 顶层字段 ↔ `messages` 中 `role: system` 首条消息
- **工具调用**：OpenAI `tool_calls` ↔ Anthropic `tool_use` / `tool_result` content block 双向映射
- **多模态**：图片 base64 双向映射；视频等单侧能力降级为文本提示
- **采样参数**：`temperature` / `top_p` / `max_tokens` 直接映射；`stop` ↔ `stop_sequences`
- **usage**：按目标协议格式回填（OpenAI `usage.prompt_tokens` ↔ Anthropic `usage.input_tokens`）
- 不做角色扮演式 hack（不注入「你在扮演 Claude」之类的提示词）

## 验收标准

- [ ] ProviderModel 端点绑定启用对应转换后，`anthropic-messages` 客户端请求能经 `openai-completions` 端点成功返回，非流式与流式均正常
- [ ] 队列同时存在原生候选与转换候选时，原生候选优先；原生全部失败后自动落到转换候选
- [ ] 转换候选失败（429/5xx）时照常切换，错误分类与透传一致
- [ ] 客户端请求体不合法时返回 400 且不切换
- [ ] 流式转换中途中断时，客户端收到协议对应的错误事件，连接正常关闭
- [ ] 队列控制页能区分原生徽标与转换徽标
- [ ] 请求日志正确显示 `客户端协议 → Provider 协议`
- [ ] 开关关闭的模型行为与现状完全一致（回归）
