# Provider 与模型配置模型

## Provider

一个模型服务渠道，负责稳定身份、生命周期和 Provider 级设置。Provider 的原生协议端点由 `provider_endpoints` 管理，运行时健康状态由 `provider_health` 管理；密钥引用和超时等设置由 `provider_settings` 管理。

> 认证方式不作为 Provider 实体字段持久化，而是由协议适配器决定默认值（见下方「协议默认认证方式」）。代理根据 `provider_endpoints.protocol` 读取对应密钥引用并生成认证信息；本地或测试集群等无需鉴权的 Provider 端点可以留空。

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

> Provider 上的一个实际模型，是路由的最小单元。ProviderModel 不直接拥有端点数组；它通过 `provider_model_endpoints` 绑定一个或多个 `provider_endpoints`，绑定记录可选填写模型专属 `url`。
>
> ProviderModel 是可复用的供应商模型实体。每个请求根据当前逻辑模型的 `scheduling_policies` 绑定、客户端协议、启用状态、绑定优先级和两层健康状态动态计算候选队列。调度顺序属于绑定关系，不属于 ProviderModel 全局实体。

### 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| providerId | string | 所属 Provider |
| modelName | string | Provider API 中的实际模型名（转发时替换请求中的 `model` 字段） |
| endpointBindings | object[] | ProviderModel 与 `provider_endpoints` 的绑定视图；持久化使用 `provider_model_endpoints` 关系表 |
| priority | number | 当前逻辑模型绑定中的候选顺序，数字越小优先级越高 |
| enabled | boolean | 是否启用 |
| createdTime | number | 创建时间 |
| updatedTime | number | 更新时间 |

### 端点绑定视图

`endpointBindings` 只是 API/导入导出的聚合视图，不是数据库中的 JSON 字段。每个绑定至少包含：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| providerEndpointId | string | 被绑定的 ProviderEndpoint ID |
| url | string \| null | 模型专属 URL；为空时使用 ProviderEndpoint 的 `url` |
| enabled | boolean | 是否允许该绑定参与路由 |
| conversions | object[] | 该绑定的客户端协议转换配置；持久化使用 `protocol_converters` |

### 约束

- 同一 Provider 下可以有多个 ProviderModel；ProviderModel 可被多个逻辑模型复用。
- 每个逻辑模型通过 `scheduling_policies` 维护自己的绑定集合、启用状态和候选顺序。
- 每个请求根据当前逻辑模型、客户端协议、绑定状态、绑定优先级和健康状态动态生成候选队列。
- `provider_endpoints.protocol` 决定原生协议；协议转换由对应 `protocol_converters` 决定。
- 转发请求时，请求体中的 `model` 字段会被替换为 `modelName` 的值。

### 配置示例（API/导出聚合视图）

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
      "id": "provider-model-001",
      "providerId": "prov-openai",
      "modelName": "gpt-4o",
      "endpointBindings": [{
        "providerEndpointId": "endpoint-openai",
        "url": null,
        "enabled": true,
        "conversions": []
      }],
      "priority": 1,
      "enabled": true
    },
    {
      "id": "provider-model-002",
      "providerId": "prov-deepseek",
      "modelName": "deepseek-chat",
      "endpointBindings": [{
        "providerEndpointId": "endpoint-deepseek-openai",
        "url": null,
        "enabled": true,
        "conversions": []
      }],
      "priority": 2,
      "enabled": true
    },
    {
      "id": "provider-model-003",
      "providerId": "prov-anthropic",
      "modelName": "claude-sonnet-4-20240229",
      "endpointBindings": [{
        "providerEndpointId": "endpoint-anthropic",
        "url": null,
        "enabled": true,
        "conversions": []
      }],
      "priority": 3,
      "enabled": true
    }
  ]
}
```

> ProviderModel 池由所有 enabled 的项组成。每个请求到达时，系统根据客户端协议和逻辑模型请求上下文，从全局池动态生成自动切换候选队列，先过滤原生协议匹配或已启用转换的绑定，再按 priority 依次尝试，失败自动切换到下一个。
