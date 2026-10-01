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
| OpenAI Completions / OpenAI Responses | Bearer Token | `Authorization: Bearer <apiKey>` |
| Anthropic Messages | Header | `x-api-key: <apiKey>`，并附带协议版本头 |

协议清单与认证预设以 `packages/contracts/source/protocols.ts` 的 `PROTOCOL_AUTH_PRESETS` 为准；当前不支持 Gemini 或自定义协议，因此没有「由适配器自定认证」这类行。

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
> ProviderModel 是可复用的供应商模型实体。每个请求根据当前逻辑模型的 `scheduling_policies` 绑定、客户端协议、启用状态、绑定优先级和两层健康状态动态计算候选模型。调度顺序属于绑定关系，不属于 ProviderModel 全局实体。

### 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识（`model_*`）；**这一行的身份**，改名、软删除都不换它 |
| providerId | string | 所属 Provider |
| modelName | string | Provider API 中的实际模型名（转发时替换请求中的 `model` 字段）；**同一 Provider 下允许重名** |
| endpointBindings | object[] | ProviderModel 与 `provider_endpoints` 的绑定视图；持久化使用 `provider_model_endpoints` 关系表 |
| priority | number | 当前逻辑模型绑定中的候选顺序，数字越小优先级越高 |
| enabled | boolean | 是否启用 |
| createdTime | number | 创建时间 |
| updatedTime | number | 更新时间 |

### 端点绑定视图

`endpointBindings` 只是管理 API 的聚合视图（供应商包里的模型端点形态见下文「供应商包导入导出」），不是数据库中的 JSON 字段。每个绑定至少包含：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| providerEndpointId | string | 被绑定的 ProviderEndpoint ID |
| url | string \| null | 模型专属 URL；为空时使用 ProviderEndpoint 的 `url` |
| enabled | boolean | 是否允许该绑定参与路由 |
| conversions | object[] | 该绑定的客户端协议转换配置；持久化使用 `protocol_converters` |

### 约束

- 同一 Provider 下可以有多个 ProviderModel（**包括多条同名模型**——同一个模型接两个区域、两套密钥、两条不同端点是正常用法，两条记录各自绑自己的端点，靠 `id` 区分而不是靠名字）；ProviderModel 可被多个逻辑模型复用。
- 模型的身份是记录 `id`，不是 `modelName`：改名只改一列文本，不换身份，因此绑定与历史引用不会悬空；删除时也不改名让位。
- 每个逻辑模型通过 `scheduling_policies` 维护自己的绑定集合、启用状态和候选顺序。
- 每个请求根据当前逻辑模型、客户端协议、绑定状态、绑定优先级和健康状态动态生成候选模型。
- `provider_endpoints.protocol` 决定原生协议；协议转换由对应 `protocol_converters` 决定。
- 一个模型对一条端点、一条端点对一个客户端协议都只留一条活跃行，由 store 先找活跃行、没有就找历史行原地复活、都没有才插入保证（不做成唯一索引）。
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

> ProviderModel 池由所有 enabled 的项组成。每个请求到达时，系统根据客户端协议和逻辑模型请求上下文，从全局池动态生成自动切换候选列表，先过滤原生协议匹配或已启用转换的绑定，再按 priority 依次尝试，失败自动切换到下一个。

## 供应商包导入导出

导入导出只针对**供应商**这一个单位：接口是 `/api/provider/export` 与 `/api/provider/import`，格式契约定义在 `packages/contracts/source/provider-bundle.ts`，服务端实现在 `packages/core/source/management/provider-transfer/`。

不做全量配置的导入导出：配置文档需要同时承载供应商、逻辑模型、调度策略和全局设置，任何一处字段变化都会让整份文件失效，而用户真正想搬家的往往只是「另一台机器上的这几个供应商」。供应商是自洽的单元，因此按供应商打包。

### 包内容

```json
{
  "format": "osw/provider-bundle",
  "version": 1,
  "exportedAt": 1757000000000,
  "providers": [
    {
      "name": "OpenAI 中转",
      "description": "主用供应商",
      "enabled": true,
      "timeoutMilliseconds": 45000,
      "apiKey": "sk-...",
      "endpoints": [{ "protocol": "openai-completions", "url": "https://api.example.com/v1", "enabled": true }],
      "settings": [{ "key": "region", "value": "us-east", "valueType": "string" }],
      "models": [
        {
          "key": "model_7f3a",
          "modelName": "gpt-5",
          "enabled": true,
          "endpoints": [{ "protocol": "openai-completions", "url": null, "enabled": true, "protocolConversionEnabled": true }]
        }
      ]
    }
  ]
}
```

- 包描述「一个供应商现在长什么样」，所以是**完整快照**而不是补丁：端点（包含被停用但保留了 URL 的行）、自定义设置、下属模型一并带上。
- 每个模型带一个 `key`：**导出时这一条模型在源库里的记录 id**。同一供应商下允许存在多条同名模型，靠名字对不上号（导入时会把两条合成一条），`key` 就是让「导出再导入」把每一条模型放回它自己那一行的锚点；老包没有这个字段，此时退回按 `modelName` 取第一条未认领的同名模型。
- 协议转换聚合成一个布尔值：当前实现里可转换的客户端协议集合完全由 `CONVERTIBLE_PROTOCOLS[protocol]` 决定，「这条绑定有没有开转换」是唯一的可配置自由度。
- `security.secretReference` 与 `connection.timeoutMilliseconds` 不进 `settings`：前者是本机密钥库里的引用，换台机器就失去意义；后者已经是顶层字段。
- 不含请求重写规则的绑定：规则本体是独立于供应商的实体，导入到另一个环境只会得到悬空引用（外键也不允许），需要单独迁移，见 [request-rewrite-rules.md](./request-rewrite-rules.md)。
- 不含逻辑模型与调度策略：某个模型挂在哪个逻辑模型、优先级多少属于逻辑模型域。
- 不含全局设置（端口、上游代理、日志保留等）：跨机器迁移时需要在设置页另行配置。
- `version` 是字面量 `1`：导入只接受当前这一个值，真要换代时直接改成 `2`，让上一代的文件明确报错而不是被猜着读。

### 导出语义

- 省略 `providerIds` 即导出全部未删除的供应商（含已停用）；显式给出时保持调用方顺序，并让不存在的 ID 明确失败而不是静默少导。
- `includeApiKeys` 默认为 `false`；选择包含时，包里的 `apiKey` 是可直接使用的明文凭据，UI 必须明确提示文件需要按密钥保管。
- 取不到密钥时省掉整个 `apiKey` 字段：导入语义是「缺省 = 保留目标环境已有密钥」，写空串会让源机器自己再导入一次都丢掉凭据。
- 文件名形如 `osw-provider-<供应商名>-<YYYY-MM-DD>.json`，导出全部时为 `osw-providers-<YYYY-MM-DD>.json`。

### 导入语义

- 按 `name` 匹配：匹配到即整体覆盖，否则新建供应商。缺省不做「合并」，避免导出再导入不断累积残留。
- 覆盖时端点、自定义设置、模型全部以包为准：包里没提到的端点行保留但停用（URL 是用户可见状态，不是缓存），包里没有的自定义设置 key 删除，包里没有的模型软删除。
- 模型按 `key`（记录 id）认领，认不到再退回按 `modelName` 找第一条尚未被本包认领的同名模型；因此「同一供应商下两条同名模型」导出再导入仍然是两条，不会被压成一条。
- 新建的模型会像手工新建那样挂到 `default` 逻辑模型，保证导入后供应商立刻可用；已有模型的调度位置不动，导入不会重排候选顺序。
- 密钥是唯一被刻意保留的字段：包里有 `apiKey` 就写入（新供应商使用新生成的密钥引用），没有就沿用目标环境已有密钥。
- 包内数据在写入前整体校验（含包内供应商重名），失败返回 `VALIDATION_ERROR` 与「这不是一个可识别的供应商导出文件」。
- 导入不使用跨表事务：各 store 函数各管自己的事务是既有的持久化边界，代价是极端失败下可能留下一个半导入的供应商。
