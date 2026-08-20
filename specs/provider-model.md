# Provider 与模型配置模型

## Provider

一个模型服务渠道，管理端点、密钥引用和健康状态。

> 认证方式不由 Provider 配置，而是由协议适配器决定默认值（见下方「协议默认认证方式」）。代理根据端点所属协议读取密钥引用并生成认证信息；本地或测试集群等无需鉴权的 Provider 端点可以留空。

### 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| name | string | 显示名称 |
| enabled | boolean | 是否启用；Provider 级设置通过 `provider_settings` 的命名空间 KV 管理 |
| createdTime | number | 创建时间 |
| updatedTime | number | 更新时间 |

### 协议默认认证方式

| 协议 | 认证方式 | 说明 |
|------|----------|------|
| OpenAI | Bearer Token | `Authorization: Bearer <apiKey>` |
| Anthropic | Header | `x-api-key: <apiKey>` |
| Gemini | Header | `x-goog-api-key: <apiKey>` |
| Custom | 由适配器决定 | 认证参数由具体协议适配器处理，不在 Provider 设置中持久化 |

### 健康状态（运行时）

| 字段 | 类型 | 说明 |
|------|------|------|
| providerId | string | 关联 Provider |
| consecutiveFailures | number | 连续失败次数 |
| cooldownUntilTime | number \| null | 冷却截止时间戳 |
| lastSuccessTime | number \| null | 最近成功时间 |
| lastFailureTime | number \| null | 最近失败时间 |

> Provider 通过 `provider_endpoints` 持有按协议的默认端点；`provider_model_endpoints` 将 ProviderModel 绑定到默认端点，可选填写独立 URL。连接超时和密钥引用统一存储在 `provider_settings` 的 KV 记录中。

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

## Provider Model（Provider 模型）

> Provider 上的一个实际模型，可挂载多个协议端点，是路由的最小单元。所有启用的 Provider 模型会自动进入每个逻辑模型的候选队列。

### 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| providerId | string | 所属 Provider |
| modelName | string | Provider API 中的实际模型名（转发时替换请求中的 model 字段） |
| providerEndpointIds | string[] | 绑定的 Provider 默认端点；实际数据库通过 `provider_model_endpoints` 关系表表示 |
| priority | number | 优先级，数字越小优先级越高 |
| enabled | boolean | 是否启用 |
| createdTime | number | 创建时间 |
| updatedTime | number | 更新时间 |

### 约束

- 同一 Provider 下可以有多个 ProviderModel，按优先级排序组成全局队列
- 端点的协议决定了它只会在该协议的请求中被选用
- 转发请求时，请求体中的 `model` 字段会被替换为 `modelName` 的值

## 配置示例（全局共享队列）

```json
{
  "providers": [
    {
      "id": "prov-openai",
      "name": "OpenAI",
      "enabled": true
    },
    {
      "id": "prov-anthropic",
      "name": "Anthropic",
      "enabled": true
    },
    {
      "id": "prov-deepseek",
      "name": "DeepSeek",
      "enabled": true
    }
  ],
  "providerModels": [
    {
      "id": "upstream-001",
      "providerId": "prov-openai",
      "modelName": "gpt-4o",
      "providerEndpointIds": ["endpoint-openai"],
      "priority": 1,
      "enabled": true
    },
    {
      "id": "upstream-002",
      "providerId": "prov-deepseek",
      "modelName": "deepseek-chat",
      "providerEndpointIds": ["endpoint-deepseek-openai"],
      "priority": 2,
      "enabled": true
    },
    {
      "id": "upstream-003",
      "providerId": "prov-anthropic",
      "modelName": "claude-sonnet-4-20240229",
      "providerEndpointIds": ["endpoint-anthropic"],
      "priority": 3,
      "enabled": true
    }
  ]
}
```

> ProviderModel 池由所有 enabled 的项组成。每个逻辑模型请求到达时，系统按 priority 从该池生成当前逻辑模型的自动切换队列，先过滤协议匹配的端点，再依次尝试，失败自动切换到下一个。
