# 数据模型设计

## 概述

使用 SQLite（better-sqlite3）作为本地存储，Zod 作为运行时 Schema 校验。所有配置数据、请求日志、健康状态都存在数据库中，API Key 等敏感信息存储在系统密钥环，数据库仅存引用 ID。

### 设计原则

- **单一真相源**：Zod Schema 定义数据结构，TypeScript 类型从中推导，数据库表与之一致
- **软删除**：配置类表使用 `deletedTime` 软删除，保留历史关联完整性
- **时间戳**：所有表使用 Unix 毫秒时间戳（`number`）
- **ID 格式**：使用 `前缀_随机串` 格式（如 `prov_abc123`），便于调试和日志追踪

---

## 1. 配置表

### 1.1 providers — 供应商

一个模型服务渠道，管理 API Key 和超时配置。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PRIMARY KEY | 供应商 ID，格式 `prov_xxx` |
| name | TEXT | NOT NULL | 显示名称 |
| apiKeyReference | TEXT | NOT NULL | 密钥环引用 ID，真实 API Key 存在系统密钥环 |
| timeoutMilliseconds | INTEGER | NOT NULL, DEFAULT 30000 | 空闲超时（毫秒）：两次数据到达的最大间隔 |
| enabled | INTEGER | NOT NULL, DEFAULT 1 | 是否启用（0/1） |
| createdTime | INTEGER | NOT NULL | 创建时间戳 |
| updatedTime | INTEGER | NOT NULL | 更新时间戳 |
| deletedTime | INTEGER | NULL | 删除时间戳，NULL 表示未删除 |

**索引：**
- `idx_providers_deleted_time` ON `deletedTime` — 过滤已删除项

### 1.2 logical_models — 逻辑模型

对外暴露的模型。MVP 只有一条 `default` 记录，架构上支持多条。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PRIMARY KEY | 逻辑模型 ID，格式 `model_xxx` |
| name | TEXT | NOT NULL, UNIQUE | 模型名（客户端引用） |
| description | TEXT | NOT NULL, DEFAULT '' | 描述 |
| enabled | INTEGER | NOT NULL, DEFAULT 1 | 是否启用（0/1） |
| createdTime | INTEGER | NOT NULL | 创建时间戳 |
| updatedTime | INTEGER | NOT NULL | 更新时间戳 |
| deletedTime | INTEGER | NULL | 删除时间戳 |

**索引：**
- `idx_logical_models_name` ON `name` — 按名称查找
- `idx_logical_models_deleted_time` ON `deletedTime`

### 1.3 model_bindings — 模型绑定（自动切换队列）

逻辑模型到具体上游的绑定，构成自动切换队列。是路由的最小单元。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PRIMARY KEY | 绑定 ID，格式 `bind_xxx` |
| logicalModelId | TEXT | NOT NULL, REFERENCES logical_models(id) | 所属逻辑模型 |
| protocol | TEXT | NOT NULL | 协议类型：`openai` / `anthropic` / `gemini` / `custom` |
| upstreamUrl | TEXT | NOT NULL | 完整上游 URL（含 path 和 query） |
| upstreamModelId | TEXT | NOT NULL | 上游实际模型 ID（转发时替换请求中的 model 字段） |
| providerId | TEXT | NOT NULL, REFERENCES providers(id) | 所属 Provider |
| priority | INTEGER | NOT NULL | 优先级，数字越小越靠前 |
| enabled | INTEGER | NOT NULL, DEFAULT 1 | 是否启用（0/1） |
| customAuthHeader | TEXT | NULL | Custom 协议下的认证头名称 |
| createdTime | INTEGER | NOT NULL | 创建时间戳 |
| updatedTime | INTEGER | NOT NULL | 更新时间戳 |
| deletedTime | INTEGER | NULL | 删除时间戳 |

**索引：**
- `idx_bindings_logical_model_priority` ON `(logicalModelId, priority)` — 按模型+优先级排序
- `idx_bindings_provider` ON `providerId` — 按 Provider 过滤
- `idx_bindings_protocol` ON `protocol` — 按协议过滤
- `idx_bindings_deleted_time` ON `deletedTime`

**约束：**
- 同一 `logicalModelId` 下 `priority` 唯一（队列中每个位置只有一个绑定）

---

## 2. 运行时状态表

### 2.1 provider_health — 供应商健康状态

每个 Provider 的运行时健康状态，持久化到数据库，重启后恢复。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| providerId | TEXT | PRIMARY KEY, REFERENCES providers(id) | 供应商 ID |
| consecutiveFailures | INTEGER | NOT NULL, DEFAULT 0 | 连续失败次数 |
| cooldownUntilTime | INTEGER | NULL | 冷却截止时间戳（毫秒），NULL 表示不在冷却中 |
| lastSuccessTime | INTEGER | NULL | 最近成功时间戳 |
| lastFailureTime | INTEGER | NULL | 最近失败时间戳 |
| updatedTime | INTEGER | NOT NULL | 更新时间戳 |

> 这张表数据量小（等于 Provider 数量），读写频繁。每次请求结果更新一次。

### 2.2 settings — 服务设置

全局设置，单行表（只有一条记录，id 固定为 `singleton`）。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PRIMARY KEY | 固定为 `singleton` |
| listenHost | TEXT | NOT NULL, DEFAULT '127.0.0.1' | 监听地址 |
| listenPort | INTEGER | NOT NULL, DEFAULT 9300 | 监听端口 |
| accessTokenReference | TEXT | NULL | 本地访问 Token 的密钥环引用，NULL 表示不启用 |
| logRetentionCount | INTEGER | NOT NULL, DEFAULT 1000 | 日志保留条数 |
| cooldownBaseSeconds | INTEGER | NOT NULL, DEFAULT 30 | 基础冷却时间（秒） |
| cooldownMaxSeconds | INTEGER | NOT NULL, DEFAULT 300 | 最大冷却时间（秒） |
| consecutiveFailureThreshold | INTEGER | NOT NULL, DEFAULT 3 | 触发冷却的连续失败次数 |
| updatedTime | INTEGER | NOT NULL | 更新时间戳 |

---

## 3. 日志表

### 3.1 request_logs — 请求日志

每次代理请求一条记录，包含最终结果。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PRIMARY KEY | 请求 ID，格式 `req_xxx` |
| timestamp | INTEGER | NOT NULL | 请求开始时间戳 |
| protocol | TEXT | NOT NULL | 协议类型 |
| logicalModelId | TEXT | NULL, REFERENCES logical_models(id) | 使用的逻辑模型（MVP 始终是 default） |
| finalBindingId | TEXT | NULL, REFERENCES model_bindings(id) | 最终成功的绑定，全部失败则为 NULL |
| finalProviderId | TEXT | NULL, REFERENCES providers(id) | 最终供应商，冗余字段便于查询 |
| statusCode | INTEGER | NULL | 最终响应状态码，网络错误等为 NULL |
| totalDurationMs | INTEGER | NOT NULL | 总耗时（毫秒） |
| isStreaming | INTEGER | NOT NULL, DEFAULT 0 | 是否流式响应（0/1） |
| attemptCount | INTEGER | NOT NULL, DEFAULT 1 | 尝试次数（切换次数 + 1） |
| errorType | TEXT | NULL | 最终错误类型：network / timeout / 4xx / 5xx / NULL(成功) |
| errorMessage | TEXT | NULL | 最终错误摘要 |
| clientIp | TEXT | NULL | 客户端 IP（通常是 127.0.0.1） |
| requestMethod | TEXT | NOT NULL | 请求方法 |
| requestPath | TEXT | NOT NULL | 请求路径 |

**索引：**
- `idx_request_logs_timestamp` ON `timestamp DESC` — 按时间倒序查询
- `idx_request_logs_protocol` ON `protocol`
- `idx_request_logs_provider` ON `finalProviderId`
- `idx_request_logs_status` ON `statusCode`

### 3.2 request_attempts — 请求尝试记录

每次请求的每个绑定尝试一条记录，与 `request_logs` 一对多。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PRIMARY KEY | 尝试 ID，格式 `att_xxx` |
| requestLogId | TEXT | NOT NULL, REFERENCES request_logs(id) | 关联的请求日志 |
| bindingId | TEXT | NOT NULL, REFERENCES model_bindings(id) | 使用的绑定 |
| providerId | TEXT | NOT NULL, REFERENCES providers(id) | 供应商（冗余，便于查询） |
| protocol | TEXT | NOT NULL | 协议（冗余） |
| upstreamUrl | TEXT | NOT NULL | 上游地址（快照，防止后续绑定修改后历史失真） |
| upstreamModelId | TEXT | NOT NULL | 上游模型 ID（快照） |
| attemptIndex | INTEGER | NOT NULL | 第几次尝试，从 0 开始 |
| statusCode | INTEGER | NULL | 响应状态码，网络错误为 NULL |
| errorType | TEXT | NULL | 错误类型：network / timeout / 4xx / 5xx / NULL(成功) |
| errorMessage | TEXT | NULL | 错误摘要 |
| durationMs | INTEGER | NOT NULL | 本次尝试耗时（毫秒） |
| switched | INTEGER | NOT NULL, DEFAULT 0 | 是否触发了切换（0/1） |
| responseStarted | INTEGER | NOT NULL, DEFAULT 0 | 是否已开始返回响应体（0/1），用于流式边界判断 |

**索引：**
- `idx_attempts_request_id` ON `(requestLogId, attemptIndex)` — 按请求查所有尝试
- `idx_attempts_provider` ON `providerId`

---

## 4. 系统表

### 4.1 schema_version — 数据库版本

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| version | INTEGER | PRIMARY KEY | 当前 schema 版本号 |
| appliedTime | INTEGER | NOT NULL | 迁移执行时间 |

迁移脚本按序号命名存放在 `source/server/db/migrations/` 目录下，如 `001_init.sql`。启动时按顺序执行未应用的迁移。

---

## 5. Zod Schema 定义

所有表结构对应一份 Zod Schema，放在 `source/common/schema.ts` 中，类型从 Schema 推导。

### 5.1 枚举与基础类型

```ts
// 协议类型
export const ProtocolSchema = z.enum(['openai', 'anthropic', 'gemini', 'custom']);
export type Protocol = z.infer<typeof ProtocolSchema>;

// 错误类型
export const ErrorTypeSchema = z.enum(['network', 'timeout', '4xx', '5xx']);
export type ErrorType = z.infer<typeof ErrorTypeSchema>;
```

### 5.2 配置模型

```ts
// Provider
export const ProviderSchema = z.object({
  id: z.string().startsWith('prov_'),
  name: z.string().min(1).max(100),
  apiKeyReference: z.string(),
  timeoutMilliseconds: z.number().int().positive().default(30000),
  enabled: z.boolean().default(true),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
  deletedTime: z.number().int().nullable(),
});

// Logical Model
export const LogicalModelSchema = z.object({
  id: z.string().startsWith('model_'),
  name: z.string().min(1).max(100),
  description: z.string().default(''),
  enabled: z.boolean().default(true),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
  deletedTime: z.number().int().nullable(),
});

// Model Binding
export const ModelBindingSchema = z.object({
  id: z.string().startsWith('bind_'),
  logicalModelId: z.string().startsWith('model_'),
  protocol: ProtocolSchema,
  upstreamUrl: z.string().url(),
  upstreamModelId: z.string().min(1),
  providerId: z.string().startsWith('prov_'),
  priority: z.number().int().positive(),
  enabled: z.boolean().default(true),
  customAuthHeader: z.string().nullable(),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
  deletedTime: z.number().int().nullable(),
});
```

### 5.3 运行时状态

```ts
export const ProviderHealthSchema = z.object({
  providerId: z.string().startsWith('prov_'),
  consecutiveFailures: z.number().int().nonnegative().default(0),
  cooldownUntilTime: z.number().int().nullable(),
  lastSuccessTime: z.number().int().nullable(),
  lastFailureTime: z.number().int().nullable(),
  updatedTime: z.number().int(),
});

export const SettingsSchema = z.object({
  id: z.literal('singleton'),
  listenHost: z.string().default('127.0.0.1'),
  listenPort: z.number().int().min(1).max(65535).default(9300),
  accessTokenReference: z.string().nullable(),
  logRetentionCount: z.number().int().positive().default(1000),
  cooldownBaseSeconds: z.number().int().positive().default(30),
  cooldownMaxSeconds: z.number().int().positive().default(300),
  consecutiveFailureThreshold: z.number().int().positive().default(3),
  updatedTime: z.number().int(),
});
```

### 5.4 日志模型

```ts
export const RequestLogSchema = z.object({
  id: z.string().startsWith('req_'),
  timestamp: z.number().int(),
  protocol: ProtocolSchema,
  logicalModelId: z.string().startsWith('model_').nullable(),
  finalBindingId: z.string().startsWith('bind_').nullable(),
  finalProviderId: z.string().startsWith('prov_').nullable(),
  statusCode: z.number().int().nullable(),
  totalDurationMs: z.number().int().nonnegative(),
  isStreaming: z.boolean().default(false),
  attemptCount: z.number().int().positive().default(1),
  errorType: ErrorTypeSchema.nullable(),
  errorMessage: z.string().nullable(),
  clientIp: z.string().nullable(),
  requestMethod: z.string(),
  requestPath: z.string(),
});

export const RequestAttemptSchema = z.object({
  id: z.string().startsWith('att_'),
  requestLogId: z.string().startsWith('req_'),
  bindingId: z.string().startsWith('bind_'),
  providerId: z.string().startsWith('prov_'),
  protocol: ProtocolSchema,
  upstreamUrl: z.string().url(),
  upstreamModelId: z.string(),
  attemptIndex: z.number().int().nonnegative(),
  statusCode: z.number().int().nullable(),
  errorType: ErrorTypeSchema.nullable(),
  errorMessage: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
  switched: z.boolean().default(false),
  responseStarted: z.boolean().default(false),
});
```

### 5.5 API 请求/响应 Schema

管理 API 统一使用 POST 风格，路径格式为 `/api/资源/动作`。所有响应通过结构化 body 返回，HTTP 状态码始终为 200。

**统一响应包装：**

```ts
// 成功响应
export const SuccessResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  });

// 失败响应
export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  errorCode: z.string(),
  errorMessage: z.string(),
});

export const ApiResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.union([SuccessResponseSchema(dataSchema), ErrorResponseSchema]);
```

**请求 Schema 示例（放在 `source/server/api/schemas/` 下）：**

```ts
// provider/create
export const ProviderCreateRequestSchema = z.object({
  name: z.string().min(1).max(100),
  apiKey: z.string().min(1), // 明文传入，服务端加密后存密钥环
  timeoutMilliseconds: z.number().int().positive().default(30000),
});

// provider/update
export const ProviderUpdateRequestSchema = z.object({
  id: z.string().startsWith('prov_'),
  name: z.string().min(1).max(100).optional(),
  apiKey: z.string().min(1).optional(),
  timeoutMilliseconds: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
});

// provider/list
export const ProviderListRequestSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(20),
  includeDisabled: z.boolean().default(false),
});

// binding/create
export const BindingCreateRequestSchema = z.object({
  protocol: ProtocolSchema,
  upstreamUrl: z.string().url(),
  upstreamModelId: z.string().min(1),
  providerId: z.string().startsWith('prov_'),
  priority: z.number().int().positive(),
  customAuthHeader: z.string().nullable().optional(),
});

// binding/reorder
export const BindingReorderRequestSchema = z.object({
  id: z.string().startsWith('bind_'),
  newPriority: z.number().int().positive(),
});

// current-binding/set
export const CurrentBindingSetRequestSchema = z.object({
  bindingId: z.string().startsWith('bind_'),
});

// log/list
export const LogListRequestSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(20),
  protocol: ProtocolSchema.optional(),
  providerId: z.string().startsWith('prov_').optional(),
  status: z.enum(['success', 'error']).optional(),
  startTime: z.number().int().optional(),
  endTime: z.number().int().optional(),
});
```

> API Schema 用于服务端入参校验和生成 OpenAPI 文档。响应 data 字段的 Schema 直接复用上面的数据库模型 Schema。

---

## 6. 数据库文件位置

| 平台 | 路径 |
|------|------|
| macOS | `~/Library/Application Support/One Switch/database.sqlite` |
| Windows | `%APPDATA%\One Switch\database.sqlite` |
| Linux | `~/.config/one-switch/database.sqlite` |

数据库文件可直接复制备份，配合密钥环导出实现完整迁移。
