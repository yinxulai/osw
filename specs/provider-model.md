# Provider 与模型配置模型

## Provider

一个模型服务渠道，管理认证信息和健康状态。

### 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| name | string | 显示名称 |
| authType | `bearer` \| `header` \| `query` | 认证方式 |
| authKey | string | 认证头名称（authType 为 header 时） |
| apiKey | string | 密钥（存储在系统密钥环中，配置文件仅存引用） |
| timeoutMs | number | 请求超时时间（毫秒） |
| enabled | boolean | 是否启用 |
| createdAt | number | 创建时间 |
| updatedAt | number | 更新时间 |

### 健康状态（运行时）

| 字段 | 类型 | 说明 |
|------|------|------|
| providerId | string | 关联 Provider |
| consecutiveFailures | number | 连续失败次数 |
| cooldownUntil | number \| null | 冷却截止时间戳 |
| lastSuccessAt | number \| null | 最近成功时间 |
| lastFailureAt | number \| null | 最近失败时间 |

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
| createdAt | number | 创建时间 |
| updatedAt | number | 更新时间 |

## Model Binding

逻辑模型在某一协议下到具体上游的绑定，是路由的最小单元。

### 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| logicalModelId | string | 所属逻辑模型 |
| protocol | `openai` \| `anthropic` \| `gemini` \| `custom` | 协议类型 |
| upstreamUrl | string | 完整上游 URL（含 path 和 query） |
| providerId | string | 所属 Provider |
| priority | number | 优先级，数字越小优先级越高 |
| enabled | boolean | 是否启用 |
| createdAt | number | 创建时间 |
| updatedAt | number | 更新时间 |

### 约束

- 一个逻辑模型可以在多个协议下各有若干绑定
- 同一逻辑模型 + 同一协议下可以有多个绑定（不同供应商或不同上游地址），按优先级排序
- 绑定的协议决定了它只会在该协议的请求中被选用

## 配置示例

```json
{
  "providers": [
    {
      "id": "prov-openai",
      "name": "OpenAI",
      "authType": "bearer",
      "timeoutMs": 30000,
      "enabled": true
    },
    {
      "id": "prov-anthropic",
      "name": "Anthropic",
      "authType": "header",
      "authKey": "x-api-key",
      "timeoutMs": 30000,
      "enabled": true
    }
  ],
  "logicalModels": [
    {
      "id": "model-gpt4o",
      "name": "gpt-4o",
      "enabled": true,
      "bindings": [
        {
          "id": "bind-gpt4o-openai",
          "protocol": "openai",
          "upstreamUrl": "https://api.openai.com/v1/chat/completions",
          "providerId": "prov-openai",
          "priority": 1,
          "enabled": true
        }
      ]
    },
    {
      "id": "model-claude",
      "name": "claude-sonnet",
      "enabled": true,
      "bindings": [
        {
          "id": "bind-claude-anthropic",
          "protocol": "anthropic",
          "upstreamUrl": "https://api.anthropic.com/v1/messages",
          "providerId": "prov-anthropic",
          "priority": 1,
          "enabled": true
        }
      ]
    }
  ]
}
```
