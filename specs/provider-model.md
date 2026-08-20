# Provider 与模型配置模型

## Provider

一个模型服务渠道，管理 API Key 和健康状态。

> 认证方式不由 Provider 配置，而是由协议决定默认值（见下方「协议默认认证方式」）。API Key 可选，代理根据端点所属协议自动选择认证方式；本地或测试集群等无需鉴权的上游可以留空。

### 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| name | string | 显示名称 |
| apiKey | string（可选） | API Key（存储在系统密钥环中，配置文件仅存引用；本地或测试集群可留空） |
| timeoutMilliseconds | number | 空闲超时时间（毫秒）：两次数据到达之间的最大间隔，流式持续返回数据不会超时 |
| enabled | boolean | 是否启用 |
| createdTime | number | 创建时间 |
| updatedTime | number | 更新时间 |

### 协议默认认证方式

| 协议 | 认证方式 | 说明 |
|------|----------|------|
| OpenAI | Bearer Token | `Authorization: Bearer <apiKey>` |
| Anthropic | Header | `x-api-key: <apiKey>` |
| Gemini | Header | `x-goog-api-key: <apiKey>` |
| Custom | 可配置 | 用户自定义认证头名称或参数名 |

### 健康状态（运行时）

| 字段 | 类型 | 说明 |
|------|------|------|
| providerId | string | 关联 Provider |
| consecutiveFailures | number | 连续失败次数 |
| cooldownUntilTime | number \| null | 冷却截止时间戳 |
| lastSuccessTime | number \| null | 最近成功时间 |
| lastFailureTime | number \| null | 最近失败时间 |

> Provider 不持有统一 Base URL，完整目标地址由每个 Model Binding 各自配置。

## Logical Model

对外暴露的统一模型名。

### 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| name | string | 模型名（客户端通过此字段引用） |
| description | string | 描述 |
| enabled | boolean | 是否启用 |
| createdTime | number | 创建时间 |
| updatedTime | number | 更新时间 |

## Upstream Model（上游模型）

Provider 上的一个实际模型，可挂载多个协议端点，是路由的最小单元。上游模型**全局共享**：不隶属于任何逻辑模型，所有启用的上游模型自动进入全局自动切换队列。

### 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| providerId | string | 所属 Provider |
| upstreamModelId | string | 上游实际模型 ID（转发时替换请求中的 model 字段） |
| endpoints | `ProtocolEndpoint[]` | 各协议端点（完整上游 URL、认证头） |
| priority | number | 优先级，数字越小优先级越高 |
| enabled | boolean | 是否启用 |
| createdTime | number | 创建时间 |
| updatedTime | number | 更新时间 |

### 约束

- 同一 Provider 下可以有多个上游模型，按优先级排序组成全局队列
- 端点的协议决定了它只会在该协议的请求中被选用
- 转发请求时，请求体中的 `model` 字段会被替换为 `upstreamModelId` 的值

## 配置示例（全局共享队列）

```json
{
  "providers": [
    {
      "id": "prov-openai",
      "name": "OpenAI",
      "timeoutMilliseconds": 30000,
      "enabled": true
    },
    {
      "id": "prov-anthropic",
      "name": "Anthropic",
      "timeoutMilliseconds": 30000,
      "enabled": true
    },
    {
      "id": "prov-deepseek",
      "name": "DeepSeek",
      "timeoutMilliseconds": 30000,
      "enabled": true
    }
  ],
  "upstreamModels": [
    {
      "id": "upstream-001",
      "providerId": "prov-openai",
      "upstreamModelId": "gpt-4o",
      "endpoints": [
        { "protocol": "openai-completions", "upstreamUrl": "https://api.openai.com/v1/chat/completions", "customAuthHeader": null }
      ],
      "priority": 1,
      "enabled": true
    },
    {
      "id": "upstream-002",
      "providerId": "prov-deepseek",
      "upstreamModelId": "deepseek-chat",
      "endpoints": [
        { "protocol": "openai-completions", "upstreamUrl": "https://api.deepseek.com/v1/chat/completions", "customAuthHeader": null }
      ],
      "priority": 2,
      "enabled": true
    },
    {
      "id": "upstream-003",
      "providerId": "prov-anthropic",
      "upstreamModelId": "claude-sonnet-4-20240229",
      "endpoints": [
        { "protocol": "anthropic-messages", "upstreamUrl": "https://api.anthropic.com/v1/messages", "customAuthHeader": null }
      ],
      "priority": 3,
      "enabled": true
    }
  ]
}
```

> 上游模型全局共享，所有 enabled 的项构成一个自动切换队列。请求来时按 priority 排序，先过滤协议匹配的端点，再依次尝试，失败自动切换到下一个。
