# 类型与结构体分类整理计划

> 状态：配置 DTO 单一来源已完成；请求 DTO、Proxy 输入类型和跨端 DTO 仍待收尾，Render 全局状态目标已被 feature store 架构替代
> 范围：`source/**/*.ts`、`source/**/*.tsx`、`specs/*.md`
> 原则：优先拆分跨边界复用和职责混合的类型，不机械嵌套，不改变数据库表的正常列式设计。
>
> 已完成验证：`pnpm typecheck`、`pnpm lint`、`pnpm test:server`、`pnpm vite build` 均通过。

## 1. 审计结论

当前问题的核心不是单纯的字段数量，而是部分类型同时承担了数据库实体、API 返回、配置输入、运行时状态和 UI 展示职责。主要问题集中在：

1. `Settings` 将网络、认证、观测、故障转移、代理和桌面设置全部平铺。
2. 请求观测对象将身份、协议、结果、指标、Token、缓存和正文混合在一起。
3. `AppState` 将多个领域状态和全局 loading/error 平铺到一个对象。
4. Proxy logging/execution 输入与运行时 hooks、请求快照、上游快照、捕获策略混合。
5. 配置导入导出存在 Server Zod、Server interface、Render interface 多份近似声明。
6. 完整实体类型被复用于输入 DTO，协议类型在边界处被降级为 `string`。

## 2. 不属于本轮问题

以下情况不应机械重构：

- Drizzle 数据库表的独立列。数据库存储模型不等同于领域对象。
- `Provider`、`LogicalModel`、`ProviderEndpoint` 等单一领域实体。
- 已经按领域组合的 `AnalyticsSummary`、`HealthSnapshot`。
- 普通 React Props 和小型 options 类型。

## 3. 优先级与目标结构

### P0：配置和边界基础

#### 3.1 `Settings`

涉及：`source/common/schemas.ts`、Settings store/service、管理 API、Runtime Settings。

建议组合：

```text
Settings
├── identity
├── server
├── auth
├── observability
├── failover
├── proxy
└── desktop
```

建议类型：

- `PersistedSettings`
- `SettingsSnapshot`
- `SettingsConfigInput`
- `ServerSettings`
- `AuthSettings`
- `ObservabilitySettings`
- `FailoverSettings`
- `ProxySettings`
- `DesktopSettings`

同时核对 `Provider` 与 `provider_settings` 边界：`apiKeyReference`、`timeoutMilliseconds` 不应在数据库实体、API DTO 和运行时配置之间混用。

#### 3.2 配置导入导出 DTO 单一来源

涉及：

- `source/server/management/config/schemas.ts`
- `source/server/management/config/types.ts`
- `source/render/source/api/tools.ts`

目标：

- 以 Zod schema 作为运行时输入边界；
- 使用 `z.infer` 导出类型；
- 抽取共享 `common/config-schemas.ts` 或明确 Server-only / Render contract；
- 统一 `Protocol`、endpoint、conversion 字段约束；
- 区分 `ConfigImportDocument`、`ConfigExportDocument`、`ConfigImportInput`；
- 不再用 `Partial<Settings>` 代表外部配置输入。

## 4. P1：请求观测与全局状态

### 4.1 `RequestLog`

涉及：`source/common/schemas.ts` 及 request logs API/domain mapper。

建议组合：

```text
RequestLog
├── identity
├── protocol
├── outcome
├── timing
├── usage
├── cache
├── raw
└── createdTime
```

先重构 API/domain DTO，数据库列保持不变；通过 mapper 在 Row 与领域对象之间转换。

### 4.2 `RequestAttempt`

建议组合：

```text
RequestAttempt
├── identity
├── target: AttemptTargetSnapshot
├── result: AttemptResult
├── error: AttemptError
├── timing: AttemptTiming
└── createdTime
```

明确区分运行时 `ResolvedAttemptTarget` 与持久化 `PersistedAttemptTargetSnapshot`。

### 4.3 `RequestContent`

建议组合：

```text
RequestContent
├── identity
├── capture
├── request
├── response
└── conversions
```

优先重构 API/domain DTO；不要求立即改变数据库表结构。

### 4.4 Render `AppState`

涉及：`source/render/source/store/app-store.ts` 和现有 feature stores。

目标：

```text
AppState
├── providers: ProvidersState
├── health: HealthState
├── proxy: ProxyState
├── settings: SettingsState
└── logicalModels: LogicalModelsState
```

每个领域明确 `data/status/error/lastUpdatedAt` 语义；将 `lastError` 拆入领域错误或单独 `AppNotificationState`。

## 5. P1：Proxy 输入类型

### 5.1 `RequestLoggingInput`

```text
RequestLoggingInput
├── request
├── routing
└── capture
```

### 5.2 `AttemptLoggingInput`

```text
AttemptLoggingInput
├── request
├── attempt
├── upstream
├── protocol
├── capture
└── hooks
```

重点是将运行时 hooks 与日志快照输入分离。

### 5.3 跨 Server/Render DTO

统一以下重复类型：

- `ModelTestResult`
- `FetchedProviderModel`
- `ProxyServerStatus`

避免 Server 和 Render 手写近似 interface。

## 6. P2：执行结果与命名整理

- `ResponsePipelineOptions`：按 protocol/mode/transport/observers 分类。
- `AttemptOutcome`：按 decision/transport/error/usage/protocol/capture 分类。
- `RequestContext`：按 identity/routing/http/lifecycle 分类。
- `ModelWithProvider`：改名为表达路由语义的 `ProviderModelCandidate` 等。
- `ProxyTargets`：改为表达候选、选中目标和手动选择状态的结果类型。
- 清理重复的 `ProxyServerStatus` 定义。

## 7. 推荐实施阶段

### 阶段 0：冻结基线与建立类型地图 ✅

- [x] 记录候选类型的来源：DB Row、domain、API、config、runtime、UI。
- [x] 确定配置共享 contract 的放置位置。
- [x] 执行 lint、typecheck、server tests、Vite build。

### 阶段 1：配置边界 ✅

- [x] 建立 `source/common/config-schemas.ts`，集中定义配置文档 schema。
- [x] 使用 Zod + `z.infer` 导出配置类型。
- [x] 统一 Server 配置导入 schema 与 Render 配置导出/导入 DTO。
- [x] 将 endpoint 和转换协议字段收紧为 `Protocol`。
- [x] 移除 `Partial<Settings>` 作为配置文档类型的使用。
- [x] 删除 `Exported*`、`ConfigExportDocument` 等兼容别名。
- [x] 删除 Server `config/types.ts` 和 Render `api/config.ts` 中转层。
- [x] 将导入 schema 正式命名为 `ConfigImportRequestSchema`。
- [x] 保留数据库列和现有 API 行为，通过共享 DTO 过渡。

> 说明：本次按新大版本处理，不保留旧配置类型别名或兼容转发层。`Settings` 本身的领域组合拆分、Provider 与 `provider_settings` 边界调整属于后续阶段。

### 阶段 2：请求观测 DTO

- 拆分 `RequestLog`、`RequestAttempt`、`RequestContent`。
- 增加 Row ↔ domain/API mapper。
- 保持数据库 schema 不变。

### 阶段 3：Render 状态（SUPERSEDED）

- 原定 `AppState` 单体目标已被 `features/*/store.ts` 分域状态架构替代，不再实施 `app-store.ts`。
- 如未来需要区分 loading、refreshing、mutation 和 error 语义，应另建独立任务，不作为本计划遗留项。

### 阶段 4：Proxy 输入与执行结果

- 拆分 `RequestLoggingInput`、`AttemptLoggingInput`。
- 整理 `ResponsePipelineOptions`、`RequestContext`、`AttemptOutcome`。
- 将 hooks、transport、capture 和 protocol 能力分组。

### 阶段 5：收尾与一致性

- 统一跨 Server/Render DTO。
- 消除重复同名类型。
- 将协议字段从 `string` 收紧为 `Protocol`。
- 扫描 `Partial<Entity>` 误用和重复 interface。
- 更新架构文档与本计划状态。

## 8. 验收标准

- 类型名称能表达数据库、领域、API、配置和运行时边界。
- 跨领域对象不再依靠一个 flat object 承载全部职责。
- 配置输入不再复用包含身份和更新时间的持久化实体。
- Server/Render 共享 DTO 有单一来源或明确 mapper 边界。
- 常用协议字段保持 `Protocol` 编译期约束。
- 数据库表仍保留适合查询的独立列，不被强行改成 JSON 嵌套。
- `pnpm lint`、`pnpm typecheck`、`pnpm test:server`、`pnpm vite build` 全部通过。
- 不改变既有 API 行为、持久化语义和用户可见功能。
