# One Switch v0.3 数据模型设计

> 本文是新大版本的目标数据库结构。
>
> **发布策略：不兼容旧版本数据库。** 新版本使用全新的数据库初始化结构，不读取、不迁移、不修补旧版本数据库。

## 1. 设计目标

One Switch 的配置内容会持续增加，尤其是供应商、模型端点、认证方式、路由策略和模型能力。因此本版本遵循以下原则：

1. **稳定身份、关系和查询字段使用独立列。**
2. **经常增加或调整的配置使用 JSON 文档。**
3. **运行时状态与用户配置分离。**
4. **请求日志保留必要的查询字段，同时将不稳定的指标放入 JSON。**
5. **请求/响应正文与日志索引分离，正文按需记录并完整保留。**
6. **历史日志不依赖可变配置，不为日志快照增加外键。**
7. **配置文档使用 `schemaVersion`，配置结构变化通过文档升级解决。**
8. **数据库初始化结构由当前代码直接定义，不保留运行时兼容迁移逻辑。**

## 2. 数据库总览

新版本包含以下 9 张表：

| 表 | 用途 | 数据性质 |
| --- | --- | --- |
| `app_config` | 全局应用配置 | 命名空间 KV 配置 |
| `providers` | 供应商稳定身份与生命周期 | 配置实体 |
| `logical_models` | 对外暴露的逻辑模型 | 配置实体 |
| `upstream_models` | Provider 上的真实上游模型与路由配置 | 配置实体 |
| `provider_health` | Provider 运行时健康状态 | 高频运行状态 |
| `request_attempts` | 请求内每次上游尝试 | 历史观测数据 |
| `request_logs` | 每次代理请求的汇总日志 | 历史观测数据 |
| `request_contents` | 请求/响应正文及转换前后内容 | 可选历史观测数据 |
| `audit_events` | 配置变更审计记录 | 历史审计数据 |

关系概览：

```mermaid
erDiagram
  providers ||--o{ upstream_models : contains
  providers ||--|| provider_health : has
  request_logs ||--o| request_contents : captures
  request_logs ||--o{ request_attempts : contains
  providers ||--o{ request_attempts : attempted_by

  app_config {
    text key PK
    text value
    text valueType
    integer version
    integer updatedTime
  }

  providers {
    text id PK
    text config
    integer createdTime
    integer updatedTime
    integer deletedTime
  }

  logical_models {
    text id PK
    text config
    integer createdTime
    integer updatedTime
    integer deletedTime
  }

  upstream_models {
    text id PK
    text providerId FK
    text upstreamModelId
    text config
    integer createdTime
    integer updatedTime
    integer deletedTime
  }

  provider_health {
    text providerId PK_FK
    integer consecutiveFailures
    integer cooldownUntilTime
    integer lastSuccessTime
    integer lastFailureTime
    integer updatedTime
  }

  request_logs {
    text id PK
    text logicalModelId
    text protocol
    text status
    integer totalDurationMilliseconds
    integer createdTime
    text usage
    text summary
    text metadata
  }

  request_contents {
    text requestId PK_FK
    text captureStatus
    text clientRequest
    text clientResponse
    text attempts
    text conversion
    integer createdTime
    integer updatedTime
  }

  request_attempts {
    text id PK
    text requestId FK
    text providerId FK
    text upstreamModelId
    integer attemptIndex
    text status
    integer durationMilliseconds
    text errorCode
    text errorMessage
    text upstreamRequestId
    text details
    integer createdTime
  }

  audit_events {
    text id PK
    text resourceType
    text resourceId
    text action
    text beforeData
    text afterData
    integer createdTime
  }
```

## 3. 表结构

以下 SQL 描述目标结构。实际实现使用 Drizzle schema 和运行时初始化 SQL，字段命名保持现有项目的 camelCase 约定。

### 3.1 `app_config`

全局配置使用逐项存储：每个配置项一行，`key` 使用命名空间表示配置归属，`value` 保存 JSON 序列化后的值。这样既保留了配置 key，又避免单例 JSON 带来的整份文档读写和并发覆盖问题。

```sql
CREATE TABLE app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  valueType TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updatedTime INTEGER NOT NULL
);

CREATE INDEX idx_app_config_updated_time
  ON app_config(updatedTime);
```

推荐的 key：

```text
proxy.listenHost
proxy.listenPort
proxy.idleTimeoutMilliseconds
routing.cooldownBaseSeconds
routing.cooldownMaxSeconds
routing.consecutiveFailureThreshold
logging.retentionCount
logging.retentionDays
logging.captureRequestContent
security.accessTokenReference
desktop.autoLaunch
ui.theme
ui.visibleColumns
```

示例记录：

| key | value | valueType |
| --- | --- | --- |
| `proxy.listenPort` | `9300` | `number` |
| `proxy.listenHost` | `"127.0.0.1"` | `string` |
| `desktop.autoLaunch` | `false` | `boolean` |
| `ui.visibleColumns` | `[...]` | `array` |

`value` 始终使用 JSON 编码，因此可以保存字符串、数字、布尔值、数组和对象。`valueType` 用于诊断和导出展示，真正的类型校验由对应的 Zod Schema 负责。

新增配置项只需要增加命名空间 key、默认值和 Schema，不需要修改数据库表。批量更新必须在一个事务中完成；读取时合并数据库已有值和默认值，并拒绝未知 key 或记录警告。

### 3.2 `providers`

Provider 表只保存稳定身份、时间和软删除状态。所有供应商业务配置保存于 `config`。

```sql
CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  config TEXT NOT NULL,
  createdTime INTEGER NOT NULL,
  updatedTime INTEGER NOT NULL,
  deletedTime INTEGER
);

CREATE INDEX idx_providers_deleted_time
  ON providers(deletedTime);
```

`config` 示例：

```json
{
  "schemaVersion": 1,
  "name": "OpenAI",
  "enabled": true,
  "auth": {
    "type": "api-key",
    "secretReference": "key_reference"
  },
  "connection": {
    "timeoutMilliseconds": 30000,
    "proxy": null
  },
  "endpoints": {
    "openai-completions": "https://api.example.com/v1/chat/completions",
    "openai-responses": "https://api.example.com/v1/responses"
  },
  "headers": {},
  "capabilities": {
    "streaming": true,
    "vision": false,
    "toolCalling": true
  },
  "metadata": {}
}
```

以下内容属于 Provider 配置，不再单独建列：

- 名称和描述性信息；
- 是否启用；
- 密钥引用和认证方式；
- 请求超时；
- 协议默认地址；
- 自定义请求头；
- 协议能力；
- 供应商元数据；
- 重试、限流和请求转换策略。

密钥本身仍然不能进入数据库，只保存系统密钥环中的引用。

### 3.3 `logical_models`

逻辑模型只保存稳定身份和生命周期。模型名称、说明、开关和路由策略放入 JSON。

```sql
CREATE TABLE logical_models (
  id TEXT PRIMARY KEY,
  config TEXT NOT NULL,
  createdTime INTEGER NOT NULL,
  updatedTime INTEGER NOT NULL,
  deletedTime INTEGER
);

CREATE INDEX idx_logical_models_deleted_time
  ON logical_models(deletedTime);
```

`config` 示例：

```json
{
  "schemaVersion": 1,
  "name": "auto",
  "description": "自动切换模型",
  "enabled": true,
  "routing": {
    "strategy": "priority",
    "failover": true
  },
  "metadata": {
    "tags": ["default"]
  }
}
```

`request_logs.logicalModelId` 保留请求发生时的逻辑模型标识，但不建立外键。逻辑模型删除后，历史日志仍然必须可读取。逻辑模型与上游模型之间没有关联表或关联字段；路由时从全局上游模型池为当前逻辑模型生成候选队列。

### 3.4 `upstream_models`

上游模型是 Provider 上可被路由的真实模型配置。每个上游模型都有独立的启用开关（`config.enabled`）。**只有同时满足以下条件的上游模型才会进入逻辑模型的候选队列：**

1. 上游模型自身 `enabled = true`；
2. 所属 Provider `enabled = true` 且未被软删除；
3. 上游模型未被软删除；
4. 上游模型至少有一个与请求协议匹配（或可转换）的端点。

禁用（`enabled = false`）的上游模型不会出现在任何逻辑模型的候选队列中，但其配置完整保留，重新启用后立即恢复参与路由。每个逻辑模型的队列是根据逻辑模型配置和全局上游模型池动态生成的。

```sql
CREATE TABLE upstream_models (
  id TEXT PRIMARY KEY,
  providerId TEXT NOT NULL,
  upstreamModelId TEXT NOT NULL,
  config TEXT NOT NULL,
  createdTime INTEGER NOT NULL,
  updatedTime INTEGER NOT NULL,
  deletedTime INTEGER,

  FOREIGN KEY (providerId) REFERENCES providers(id)
);

CREATE INDEX idx_upstream_models_provider
  ON upstream_models(providerId);

CREATE INDEX idx_upstream_models_deleted_time
  ON upstream_models(deletedTime);
```

`config` 示例：

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "priority": 1,
  "weight": 100,
  "endpoints": [
    {
      "protocol": "openai-completions",
      "upstreamUrl": "https://api.example.com/v1/chat/completions",
      "customAuthHeader": null,
      "protocolConversionEnabled": false
    }
  ],
  "routing": {
    "maxRetries": 2,
    "cooldownPolicy": "provider"
  },
  "capabilities": {
    "streaming": true,
    "vision": false,
    "toolCalling": true
  },
  "metadata": {
    "region": "us-east",
    "costTier": "low",
    "tags": ["fast"]
  }
}
```

只有以下字段保持关系型：

- `id`；
- `providerId`；
- `upstreamModelId`；
- 创建、更新时间；
- 软删除时间。

以下内容全部属于可演进配置：

- `enabled`（启用开关，控制是否参与路由）；
- `priority` 和 `weight`；
- 协议端点；
- 重试和冷却策略；
- 模型能力；
- 区域、价格等级、标签；
- 自定义请求头和请求转换规则。

### 3.5 `provider_health`

Provider 健康状态是运行时状态，必须与静态配置分离。

```sql
CREATE TABLE provider_health (
  providerId TEXT PRIMARY KEY,
  consecutiveFailures INTEGER NOT NULL DEFAULT 0,
  cooldownUntilTime INTEGER,
  lastSuccessTime INTEGER,
  lastFailureTime INTEGER,
  updatedTime INTEGER NOT NULL,

  FOREIGN KEY (providerId) REFERENCES providers(id)
);
```

该表不保存用户配置，不进入 Provider 的 `config` JSON。健康状态更新需要支持原子更新和高频写入。

### 3.6 `request_logs`

请求日志保留稳定查询字段，变化频繁的 usage 和响应元数据使用 JSON。

```sql
CREATE TABLE request_logs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  protocol TEXT NOT NULL,
  logicalModelId TEXT NOT NULL,
  totalDurationMilliseconds INTEGER NOT NULL,
  createdTime INTEGER NOT NULL,
  usage TEXT,
  summary TEXT,
  metadata TEXT
);

CREATE INDEX idx_request_logs_created_time
  ON request_logs(createdTime);

CREATE INDEX idx_request_logs_status
  ON request_logs(status);

CREATE INDEX idx_request_logs_logical_model
  ON request_logs(logicalModelId);
```

`usage` 示例：

```json
{
  "totalTokens": 1280,
  "inputTokens": 1200,
  "outputTokens": 80,
  "cachedInputTokens": 1024,
  "cacheCreationInputTokens": 0,
  "raw": {
    "input_tokens": 1200,
    "input_tokens_details": {
      "cached_tokens": 1024
    }
  }
}
```

`summary` 示例：

```json
{
  "upstreamProtocol": "openai-responses",
  "ttftMilliseconds": 120,
  "cacheHit": true,
  "promptCacheHit": true
}
```

`metadata` 示例：

```json
{
  "streaming": true,
  "finishReason": "stop",
  "reasoningTokens": 48,
  "providerRegion": "us-east"
}
```

日志表的稳定查询字段为：

- `logicalModelId`；
- `protocol`；
- `status`；
- `totalDurationMilliseconds`；
- `createdTime`。

未来增加新的 Token 类型、缓存指标、计费信息或响应元数据时，不需要修改表结构。

### 3.7 `request_contents`

请求正文和响应正文属于大体积、可能包含敏感信息且变化频繁的数据，不直接塞入 `request_logs` 或 `request_attempts` 的宽表。每个请求最多一行内容记录，通过 `requestId` 关联请求汇总；上游每次尝试的内容通过 `attempts` 数组保存，这样重试链路不会互相覆盖。

内容记录区分客户端视角和上游视角：

- `clientRequest`：客户端收到的原始请求（方法、路径、请求头和正文）；
- `clientResponse`：最终返回给客户端的响应（状态、响应头和正文）；
- `attempts`：每次上游尝试的请求/响应内容；
- `conversion`：发生协议转换时，保存转换前后的请求和响应；未转换时为 `null`。

建议首发结构如下：

```sql
CREATE TABLE request_contents (
  requestId TEXT PRIMARY KEY,
  captureStatus TEXT NOT NULL,
  clientRequest TEXT,
  clientResponse TEXT,
  attempts TEXT,
  conversion TEXT,
  createdTime INTEGER NOT NULL,
  updatedTime INTEGER NOT NULL,

  FOREIGN KEY (requestId) REFERENCES request_logs(id)
);

CREATE INDEX idx_request_contents_updated_time
  ON request_contents(updatedTime);
```

其中 JSON 文档使用稳定的 envelope，允许后续增加字段而不变更表结构：

```json
{
  "schemaVersion": 1,
  "method": "POST",
  "path": "/v1/messages",
  "headers": {
    "content-type": "application/json"
  },
  "body": {
    "model": "client-model",
    "messages": []
  },
  "bodyText": null,
  "contentType": "application/json",
  "isStreaming": false,
  "capturedAt": 1755643200000
}
```

`conversion` 示例：

```json
{
  "schemaVersion": 1,
  "fromProtocol": "anthropic-messages",
  "toProtocol": "openai-completions",
  "requestBefore": {},
  "requestAfter": {},
  "responseBefore": {},
  "responseAfter": {},
  "streamEventsBefore": [],
  "streamEventsAfter": []
}
```

安全与容量约束：

- 默认关闭正文采集，只有用户在设置中显式开启后才记录；
- 日志清理支持按保留天数执行，并同时删除请求正文、尝试记录和请求汇总；
- API Key、Authorization、Cookie、Set-Cookie 等敏感请求头必须脱敏；
- 本地工具默认不限制正文大小；开启记录后完整保存已接收的请求和响应内容；
- 流式响应记录已接收的事件/文本片段，不阻塞代理转发，不因日志写入失败影响请求；
- 清理请求日志时，先删除 `request_contents`，再删除 `request_attempts` 和 `request_logs`；
- 导出日志必须明确包含正文的开关，默认不导出正文。

### 3.8 `request_attempts`

每次上游尝试一行，保存故障转移顺序和统计所需字段。

```sql
CREATE TABLE request_attempts (
  id TEXT PRIMARY KEY,
  requestId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  upstreamModelId TEXT NOT NULL,
  attemptIndex INTEGER NOT NULL,
  status TEXT NOT NULL,
  durationMilliseconds INTEGER NOT NULL,
  errorCode TEXT,
  errorMessage TEXT,
  upstreamRequestId TEXT,
  details TEXT,
  createdTime INTEGER NOT NULL,

  FOREIGN KEY (requestId) REFERENCES request_logs(id),
  FOREIGN KEY (providerId) REFERENCES providers(id)
);

CREATE INDEX idx_request_attempts_request_order
  ON request_attempts(requestId, attemptIndex);

CREATE INDEX idx_request_attempts_provider_time
  ON request_attempts(providerId, createdTime);

CREATE INDEX idx_request_attempts_model_time
  ON request_attempts(upstreamModelId, createdTime);
```

`details` 示例：

```json
{
  "errorResponse": {},
  "upstreamProtocol": "openai-responses",
  "httpStatus": 503,
  "retryable": true,
  "responseHeaders": {},
  "networkError": null
}
```

保留独立列的字段：

- `requestId`；
- `providerId`；
- `upstreamModelId`；
- `attemptIndex`；
- `status`；
- `durationMilliseconds`；
- `errorCode`；
- `createdTime`。

### 3.9 `audit_events`

记录配置实体的变更前后内容。该表不参与代理核心链路，可按产品需求启用或延后实现。

```sql
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  resourceType TEXT NOT NULL,
  resourceId TEXT NOT NULL,
  action TEXT NOT NULL,
  beforeData TEXT,
  afterData TEXT,
  createdTime INTEGER NOT NULL
);

CREATE INDEX idx_audit_events_resource
  ON audit_events(resourceType, resourceId, createdTime);

CREATE INDEX idx_audit_events_created_time
  ON audit_events(createdTime);
```

## 4. JSON 文档版本

所有配置 JSON 必须带有 `schemaVersion`：

```json
{
  "schemaVersion": 1
}
```

读取流程：

```text
数据库文本
  -> JSON.parse
  -> 根据 schemaVersion 升级文档
  -> 当前版本 Zod Schema 校验
  -> 返回领域对象
```

例如 Provider 配置可以演进为：

```text
ProviderConfigV1 -> ProviderConfigV2 -> ProviderConfigV3
```

字段重命名、配置嵌套调整和默认值增加通过文档升级完成，不通过数据库 ALTER TABLE 完成。

## 5. 字段存储决策

### 保留为关系型列

```text
id
providerId
requestId
upstreamModelId
logicalModelId
status
protocol
attemptIndex
createdTime
updatedTime
deletedTime
durationMilliseconds
totalDurationMilliseconds
```

原因：这些字段用于外键、JOIN、分页、排序、时间过滤、统计和生命周期管理。

### 存入 JSON

```text
Provider 配置
Logical Model 配置
Upstream Model 配置
app_config.value
usage 详情
缓存指标
响应元数据
错误响应详情
协议能力
重试策略
限流策略
自定义 Header
模型标签和扩展信息
```

## 6. 数据库初始化策略

由于本版本不考虑兼容旧版本，数据库初始化流程保持简单：

1. 创建独立的数据目录；
2. 打开 `one-switch.db`；
3. 启用 SQLite 外键；
4. 切换 WAL 模式；
5. 创建当前版本全部表和索引；
6. 按默认值批量插入 `app_config` 配置项；
7. 插入默认逻辑模型；
8. 初始化 Provider 健康状态。

`source/server/database/index.ts` 不再包含以下逻辑：

- 旧表检测；
- 旧字段迁移；
- `ensureColumn`；
- `dropColumn`；
- 旧 Provider 宽表转换；
- 旧 Settings 表转换；
- 运行时兼容修补。

旧版数据库由用户自行备份或删除。新版本遇到旧数据库文件时，应明确报错并要求重新初始化，而不是尝试隐式迁移。

## 7. Store 层边界

Store 层应分为两部分：

### 关系仓储

负责：

- 表记录的创建、查询、更新、删除；
- 外键关系；
- 时间和生命周期；
- 请求日志分页和统计。

### 文档仓储

负责：

- JSON 序列化和反序列化；
- `schemaVersion` 升级；
- Zod 校验；
- 默认配置合并；
- 文档级更新。

业务层不应直接调用 `JSON.stringify`、`JSON.parse` 或 `json_extract` 读取配置内容。

## 8. 删除与历史数据规则

### 配置实体

以下表使用软删除：

- `providers`；
- `logical_models`；
- `upstream_models`。

### 运行状态

删除 Provider 时：

1. 将 Provider 标记为软删除；
2. 禁用或软删除其上游模型；
3. 保留 `provider_health`，或者在事务中清理其运行状态；
4. 保留历史请求日志和尝试记录。

### 请求日志

请求日志按保留策略物理删除：

1. 先删除 `request_contents`；
2. 再删除 `request_attempts`；
3. 最后删除 `request_logs`；
4. `audit_events` 按独立审计保留策略清理。

历史日志不依赖 `logical_models`、`upstream_models` 的当前配置内容。逻辑模型队列是运行时根据当前逻辑模型和全局上游模型池计算出来的，不单独持久化队列关系。

## 9. 本版本明确不采用的方案

### 不采用全局多态 `resources` 表

虽然可以减少表数量，但会导致：

- 关系类型不清晰；
- 外键难以表达；
- 查询条件复杂；
- 类型约束更多依赖应用代码；
- 统计 SQL 可读性变差。

### 不采用全量 EAV 属性表

`key/value` 只用于有明确命名空间、Schema 和默认值管理的全局应用配置，不扩展到所有业务实体。Provider、模型和路由核心配置仍使用经过 Schema 校验的 JSON 文档，避免用通用属性表承载复杂嵌套结构。

### 不把健康状态写进配置 JSON

健康状态更新频繁，且和用户配置的生命周期、事务边界、更新频率完全不同。

### 不把所有日志字段都放入 JSON

状态、协议、时间、耗时和关联标识需要被分页、过滤和聚合，必须保持为独立列。

## 10. 实施清单

本版本落地时需要同步修改：

1. `source/server/database/schema.ts`；
2. `source/server/database/index.ts`；
3. `source/server/database/store.ts`；
4. `source/common/schemas.ts`；
5. `source/server/database/development-seed.ts`；
6. `source/server/database/index.test.ts`；
7. `source/server/database/store.test.ts`；
8. 配置导入导出逻辑；
9. Provider、模型、路由和统计相关 SQL；
10. 删除旧版 Drizzle 迁移文件，生成新的首发基线。

## 11. 后续演进建议（评审补充）

以下是对当前设计的补充建议，按优先级排列，供后续迭代评审时决策。

### 11.1 建议尽快明确

**`app_config` 与 `settings` 表名统一。**
当前代码使用 `settings`，本文使用 `app_config`。落地前必须二选一，避免文档与实现长期分叉。建议以本文的 `app_config` 为准并重命名现有表，因为“命名空间 KV”的语义比“settings”更准确，也为未来非设置类全局状态留出空间。

**`request_contents` 的 `attempts` 数组上限。**
正文不限制大小，但单个请求的尝试次数可能很多（重试风暴）。建议在文档层面约定：`attempts` 数组按实际尝试次数完整保存，但每次尝试的正文若超过某个“展示友好”阈值（如 1MB），可在 envelope 中降级为 `bodyPreview` + `bodyOmitted: true`，这不是存储限制，而是防止单行 JSON 过大导致 UI 无法渲染。是否采用需要产品决策。

**`captureStatus` 枚举值定义。**
建议明确为：`captured`（完整采集）、`partial`（流式采集中断或部分丢失）、`disabled`（未开启采集）、`failed`（采集异常）。日志详情页据此展示不同状态，而不是猜测内容为空的原因。

### 11.2 建议在实现前定稿

**时间戳统一为毫秒。**
`createdTime` 等字段当前实现为毫秒（`Date.now()`），文档未显式声明单位。建议在本文明确“所有时间戳均为 Unix 毫秒”，避免后续统计 SQL 中出现秒/毫秒混用。

**`request_logs.logicalModelId` 的快照语义。**
当前仅存 ID。若逻辑模型被删除，日志详情页将无法显示模型名称。建议在 `metadata` JSON 中冗余 `logicalModelName` 快照，与“历史日志不依赖可变配置”原则一致（快照属于日志自身数据，不是外键依赖）。

**`provider_health` 的清理时机。**
第 8 节写“保留，或者在事务中清理”，建议定稿为：Provider 软删除时保留健康状态（便于恢复后观察），Provider 物理删除（若未来提供）时一并清理。

**`audit_events` 的启用决策。**
该表目前标注“可按产品需求启用或延后实现”。建议明确：若 v0.3 不实现，则从 9 张表中移除，改为 8 张表，避免“文档有、代码无”的长期分叉；若实现，需同步定义 `resourceType` 枚举和保留策略。

**索引与查询模式对齐。**
建议在实现前根据日志页的实际查询模式复核索引：
- 日志列表默认按 `createdTime DESC` 分页 → 已有索引覆盖；
- 按状态筛选 → 已有索引覆盖；
- 按逻辑模型筛选 → 已有索引覆盖；
- 按供应商筛选日志 → 当前无直接索引，需通过 `request_attempts` JOIN，若日志页需要此筛选，考虑在 `request_logs.metadata` 中冗余 `providerId` 或接受 JOIN 开销。

### 11.3 可延后但建议预留

**`request_contents` 独立分页查询。**
正文表体积远大于日志表。若未来提供“仅浏览有正文的日志”视图，`request_contents` 上的 `requestId IN (...)` 查询即可满足；暂不需要额外反向索引。

**JSON 文档升级函数的注册机制。**
第 4 节描述了 `V1 -> V2 -> V3` 升级链，建议实现时采用显式注册表（`{ 1: upgradeToV2, 2: upgradeToV3 }`）而非 if-else 链，便于测试每个升级步骤。

**数据库文件版本标记。**
虽然不兼容旧版，建议在 `app_config` 中写入 `database.schemaBaseline = "v0.3"`，未来再发不兼容版本时可用于检测并提示用户，而不是静默打开结构不匹配的库。

**WAL checkpoint 与应用退出。**
本地桌面应用退出时建议执行 `PRAGMA wal_checkpoint(TRUNCATE)`，避免残留过大的 WAL 文件；这属于实现细节，但值得写入 desktop spec。

## 11. 最终结论

本版本的核心结构是：

```text
稳定身份与关系 -> 关系型列
可变业务配置   -> config JSON
全局配置       -> app_config 命名空间 KV
运行时状态     -> 独立状态表
稳定日志维度   -> 关系型列
不稳定日志详情 -> JSON
配置变更历史   -> audit_events
```

以后新增认证方式、协议能力、重试策略、路由权重、自定义 Header、供应商元数据、模型能力和新的 usage 指标时，原则上只需要增加或升级 JSON Schema，不需要修改数据库表结构。
