# Provider 与模型配置模型

## Provider

一个模型服务渠道，管理 API Key 和健康状态。

> 认证方式不由 Provider 配置，而是由协议决定默认值（见下方「协议默认认证方式」）。每个 Provider 只需提供一个 API Key，代理根据绑定所属协议自动选择认证方式。

### 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| name | string | 显示名称 |
| apiKey | string | API Key（存储在系统密钥环中，配置文件仅存引用） |
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

## Model Binding

逻辑模型在某一协议下到具体上游的绑定，是路由的最小单元。

### 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| logicalModelId | string | 所属逻辑模型 |
| protocol | `openai` \| `anthropic` \| `gemini` \| `custom` | 协议类型 |
| upstreamUrl | string | 完整上游 URL（含 path 和 query） |
| upstreamModelId | string | 上游实际模型 ID（转发时替换请求中的 model 字段） |
| providerId | string | 所属 Provider |
| priority | number | 优先级，数字越小优先级越高 |
| enabled | boolean | 是否启用 |
| customAuthHeader | string \| null | Custom 协议下的认证头名称（其他协议忽略） |
| createdTime | number | 创建时间 |
| updatedTime | number | 更新时间 |

### 约束

- 一个逻辑模型可以在多个协议下各有若干绑定
- 同一逻辑模型 + 同一协议下可以有多个绑定（不同供应商或不同上游地址），按优先级排序
- 绑定的协议决定了它只会在该协议的请求中被选用
- 转发请求时，请求体中的 `model` 字段会被替换为 `upstreamModelId` 的值（MVP 单模型模式下始终替换）

## 配置示例（MVP 单模型队列）

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
  "logicalModels": [
    {
      "id": "model-default",
      "name": "default",
      "enabled": true,
      "bindings": [
        {
          "id": "bind-001",
          "protocol": "openai",
          "upstreamUrl": "https://api.openai.com/v1/chat/completions",
          "upstreamModelId": "gpt-4o",
          "providerId": "prov-openai",
          "priority": 1,
          "enabled": true
        },
        {
          "id": "bind-002",
          "protocol": "openai",
          "upstreamUrl": "https://api.deepseek.com/v1/chat/completions",
          "upstreamModelId": "deepseek-chat",
          "providerId": "prov-deepseek",
          "priority": 2,
          "enabled": true
        },
        {
          "id": "bind-003",
          "protocol": "anthropic",
          "upstreamUrl": "https://api.anthropic.com/v1/messages",
          "upstreamModelId": "claude-sonnet-4-20240229",
          "providerId": "prov-anthropic",
          "priority": 3,
          "enabled": true
        }
      ]
    }
  ]
}
```

> MVP 只有一个 `default` 逻辑模型，bindings 构成一个自动切换队列。请求来时按 priority 排序，先过滤协议匹配的项，再依次尝试，失败自动切换到下一个。
