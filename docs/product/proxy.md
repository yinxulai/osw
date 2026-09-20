# 本地代理服务

> 本文只描述代理的**行为契约**：协议识别、候选过滤与排序、自动切换、手动切换、错误分类、流式边界、空闲超时与透传规则。
> 这些契约不随实现重构而变。承载这些行为的模块结构、分层职责、扩展接口与「协议 × 传输」双轴见 [proxy-engine.md](./proxy-engine.md)；出站网络访问见 [outbound-proxy.md](./outbound-proxy.md)；路由落点怎么算出来见 [route-design.md](./route-design.md) §2.10。

## 服务基本信息

- 默认监听 `127.0.0.1` 的可配置端口，不暴露到局域网
- 客户端只需配置一个统一的服务根地址（如 `http://127.0.0.1:port`），无需按协议区分；填进客户端的 Base URL 按客户端习惯补路径——OpenAI 兼容客户端填 `<origin>/v1`（它自己拼 `/chat/completions` 等），Anthropic 客户端填 `<origin>`（它自己拼 `/v1/messages`），见 [desktop.md](./desktop.md) §接入配置页
- 支持普通 HTTP 请求和 SSE 流式响应透传
- 不强制接管系统代理；推荐用户在 AI 工具中配置本地 Base URL
- 可选的应用级上游出站代理用于 OSW 访问模型供应商，覆盖真实模型请求、连接测试和模型列表获取；协议、绕过规则和安全边界详见 [outbound-proxy.md](./outbound-proxy.md)

## 协议识别

代理根据请求 path 自动匹配协议类型：

| 协议 | 匹配方法 + 路径 |
|------|----------|
| `openai-completions` | POST `/v1/chat/completions`、`/chat/completions`、`/v1/completions`、`/completions`、`/v1/embeddings`、`/embeddings` |
| `openai-responses` | POST `/v1/responses`、`/responses`（传输为 HTTP） |
| `anthropic-messages` | POST `/v1/messages`、`/messages` |

- 当前实现只有以上三种协议，路径表以 `packages/core/source/proxy/protocols/*/descriptor.ts` 为准；Gemini、Custom 等其它协议不在能力范围内
- 若 path 无法匹配任何已知协议，返回 404 并提示未识别的 API 路径
- `/v1/models` 是代理自身提供的本地服务接口，不透传到上游

## 本地服务接口

### `/v1/models`

返回 MVP 唯一启用的兜底逻辑模型 `default`，方便支持模型列表拉取的工具自动发现。客户端也可以继续使用自身配置的其他模型名，未匹配的名称仍由 `default` 处理。

响应格式兼容 OpenAI Models API：

```json
{
  "object": "list",
  "data": [
    {
      "id": "default",
      "object": "model",
      "created": 0,
      "owned_by": "osw"
    }
  ]
}
```

> MVP 中 `data` 数组只包含 `default` 一项，`id` 为逻辑模型名。模型发现结果不构成请求模型白名单；后续支持多逻辑模型时，再按启用状态返回多个逻辑模型。

## 路由策略

### 单逻辑模型

v0.3 MVP 只有兜底逻辑模型 `default`。ProviderModel 通过 `scheduling_policies` 绑定到逻辑模型；每个请求根据当前生效的路由定义算出的落点逻辑模型绑定关系和客户端协议动态计算一个**自动切换候选列表**。请求中的 `model` 字段必须是非空字符串；代理把它交给当前生效的定义（工作流图或规则表，由 `settings.routeMode` 决定，见 [route-design.md](./route-design.md) §2.11）算出落点——内建默认策略就是「命中某个已启用逻辑模型的 id 或 name 就用它，否则回落到内建默认逻辑模型 `default`」（详见 [route-design.md](./route-design.md) §2.7）。转发时，客户端模型名会被替换为当前 ProviderModel 的 `modelName`。

- 所有未匹配请求只使用 `scheduling_policies` 中绑定到 `default` 的候选项；后续每个逻辑模型都可以维护自己的绑定集合和顺序
- 同一个 ProviderModel 可以绑定到多个逻辑模型，并在不同逻辑模型中拥有不同的优先级、权重和启用状态
- 候选列表中的每个 ProviderModel 都通过端点绑定获得 upstream 协议、有效 URL、upstream API 模型名和所属 Provider。
- 请求来时，自动根据协议过滤候选，按顺序尝试，失败自动切换到下一个
- 转发到上游时，`model` 字段会被替换为当前 ProviderModel 的 **modelName**
- 支持用户手动切换到候选列表中的某个 ProviderModel：新请求使用新模型，正在进行的请求不中断

> ProviderModel 是可复用的供应商模型实体，但调度资格和顺序由 `scheduling_policies(logicalModelId, providerModelId)` 决定；MVP 中只有绑定到 `default`、绑定启用且存在可用端点的 ProviderModel 才进入候选池。

### 路由步骤

1. **协议识别**：根据请求 path 自动匹配协议类型
2. **路由求解与候选过滤**：把请求交给当前生效的路由定义（`resolveRoute()`，工作流图或规则表）算出落点逻辑模型列表（内建默认策略下就是「命中已启用逻辑模型的 id 或 name 即直连，否则回落到内建默认逻辑模型 `default`」），再从落点逻辑模型的自动切换候选列表中筛选出**协议匹配**且**可用**的 ProviderModel（未禁用、ProviderModel 未冷却、Provider 未冷却）；前一个落点没有可用候选时依次尝试下一个落点
3. **确定起始位置**：如果用户手动指定了当前 ProviderModel，则从该模型开始；目标已禁用、冷却或协议不匹配时返回明确错误，不静默选择其他起始项；否则从候选列表头部开始
4. **顺序尝试**：按当前逻辑模型绑定行的 `priority ASC, weight DESC, createdTime ASC, providerModelId ASC` 稳定排序依次尝试；v0.3 `priority` 策略不使用权重做随机调度。不同逻辑模型分别读取自己的绑定行，因此可以拥有不同顺序
5. **模型名替换**：每个 ProviderModel 转发前，将请求体中的 model 替换为该模型的 `modelName`
6. **失败切换**：遇到可切换错误时，自动尝试候选列表中的下一个 ProviderModel

### 过滤规则

- 协议不匹配的 ProviderModel 跳过（例如 OpenAI 协议的请求不会尝试只有 Anthropic 端点的 ProviderModel）
- 被标记为冷却或禁用的 Provider 或 ProviderModel 跳过
- 如果过滤后候选为空，返回“当前协议下无可用 ProviderModel”的错误响应（枚举与过滤规则以 `packages/core/source/proxy/planners/` 为准）

### 自动切换规则

- 同一请求不在同一 ProviderModel 上重复重试
- 按候选顺序依次尝试，遇到可切换错误则切到下一个
- 所有候选都失败时，状态码保留上游失败的性质：其中有上游回了「请求本身不成立」类 4xx（400 / 413 / 414 / 422）就回该 4xx，其余情况回 `502`；两种情况下都在日志中聚合所有尝试

### 手动切换（核心特性）

用户可以在控制台手动指定当前使用候选列表中的哪个 ProviderModel：

- **新请求立即生效**：切换后发起的新请求，从指定的 ProviderModel 开始尝试
- **进行中请求不中断**：已经在转发的请求（包括流式）继续使用原来的 ProviderModel，不受切换影响
- **自动切换仍有效**：手动指定的 ProviderModel 失败后，仍按候选顺序自动往下切换
- **手动切换不改变候选顺序**：优先级排序不变，只是设置一个「当前起始点」
- 手动切换是运行时状态，不持久化，重启后恢复为从候选列表头部开始

## 可切换错误分类

| 类型 | 行为 | 说明 |
|------|------|------|
| 网络错误、连接超时、空闲超时 | 自动切换 | 上游不可达或长时间无数据返回 |
| 408、429、5xx | 自动切换 | 上游明确不可用或限流 |
| 模型不存在 | 自动切换 | 该 Provider 配置的 `modelName` 可能配置错误 |
| 401 / 403 | 自动切换 + 告警 | 切换并标记该供应商配置可能错误 |
| 400 / 413 / 414 / 422 | 自动切换；全部候选都失败时回给客户端 | 换一家可能支持这个参数，因此先切换；若没有一家接受，则请求本身不成立，回该 4xx 而不是 502，客户端据此修正而不是重试 |

全部候选都失败时，客户端拿到的 `errorCode` 恒为 `ALL_PROVIDERS_FAILED`（它说的是代理层的结论：没有任何候选能服务这个请求）；「责任在谁」由 HTTP 状态码承担——4xx 表示请求本身不成立，`502` 表示服务端或连接层故障。白名单是显式枚举的，不能笼统用「4xx」代替：401 / 403（凭证）、404（模型或路径）、408（上游等待超时）、429（限流）都可能换一家就成立，客户端重试也确实合理。

错误分类应可配置，MVP 提供合理默认值。

### 空闲超时说明

- 超时指的是**空闲超时**（idle timeout）：两次数据到达之间的最大时间间隔
- 连接建立后，如果远端在 Provider 配置的 `timeoutSeconds`（运行时换算为毫秒）内没有返回任何数据（包括响应头和响应体），触发超时
- 流式响应只要上游持续返回数据（SSE chunk、body chunk），即使总时长很长也不会超时
- 连接超时（建立 TCP 连接的时间）也受同一超时时间限制

## 流式请求切换边界

- **可以切换**：尚未收到上游响应头，或上游返回错误状态码且响应体尚未发给客户端时
- **不可切换**：一旦 200 响应头或 SSE 数据已经开始返回给客户端，不再切换，避免输出内容混杂
- 流式中途断开记录为供应商失败，但不向另一个供应商续传同一次请求

## 透传规则

- 保留客户端的原始方法和端到端请求头；移除 `connection`、`transfer-encoding` 等逐跳 header
- 移除客户端认证信息，注入 Provider 配置的认证头；`content-length` 按最终请求体重新计算
- OpenAI / Anthropic 使用有效 ProviderModel 端点绑定 URL，并将请求体 `model` 改写为 ProviderModel 的 `modelName`
- 响应状态码、端到端响应头和响应体逐块返回；逐跳响应 header 不向客户端转发
- 请求正文的处理顺序（协议转换 → 请求重写）见 [protocol-conversion.md](./protocol-conversion.md) 与 [request-rewrite-rules.md](./request-rewrite-rules.md)
