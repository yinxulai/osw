# One Switch 结构分层整理计划

> 目标：整理当前系统中职责全部展平、跨领域耦合和重复状态来源的问题，在不改变产品行为、API 契约和数据库语义的前提下，逐步恢复清晰的模块边界。
>
> 本计划对应当前 v0.3 收尾阶段的代码结构治理，不是新功能开发计划。实施过程中优先保持行为兼容，避免一次性大规模重写。

## 1. 当前问题摘要

当前最明显的展平点如下：

| 优先级 | 文件/目录 | 主要问题 |
| --- | --- | --- |
| P0 | `source/server/proxy/handler.ts` | HTTP 入口、模型解析、路由、健康、传输、日志、重试全部混合 |
| P0 | `source/server/database/store.ts` | ProviderModel、Endpoint、协议转换、请求日志、Usage 共用一个数据访问单体 |
| P1 | `source/render/source/api.ts` | 所有管理 API、类型和公共请求逻辑集中在一个文件 |
| P1 | `source/render/source/services/app-service.ts` | 全局缓存、轮询、多个领域状态和代理生命周期混合 |
| P1 | `source/server/management/config.ts` | 配置导入导出、实体编排、密钥处理和数据库写入混合 |
| P1 | `source/render/source/pages/model-management/service.ts` | Provider 与 ProviderModel 的 CRUD、弹窗和发现流程混合 |
| P1 | `source/render/source/pages/runtime-settings/service.ts` | 设置、代理重启、日志清理、配置迁移、开发数据混合 |
| P2 | `source/render/source/pages/queue-control/service.ts` | 队列、调度、健康、代理和请求日志指标混合 |
| P2 | `source/server/management/router.ts` | 路由聚合、body 解析、环境限制和异常映射混合 |
| P2 | `source/render/source/pages/logs/page.tsx` | 页面组件直接承担请求、轮询、过滤、导出和 UI 状态 |
| P2 | `source/server/security/` | 管理认证与基础安全适配的归属不够清晰 |
| P3 | `source/render/source/pages/linear-prototype/` | 与正式页面重复维护一套导航和业务展示模型 |

## 2. 整理原则

1. **先分职责，再移动目录**：避免只改变路径而不改变实际边界。
2. **保留稳定外观**：初期允许旧文件作为兼容出口，内部实现逐步迁移。
3. **单向依赖**：入口层依赖业务层，业务层依赖基础设施，基础设施不反向依赖 UI 或业务模块。
4. **一个模块一个主要变化原因**：配置、路由、传输、观测和展示不应共用同一个核心实现文件。
5. **状态按领域归属**：Provider、Proxy、Settings、Health 等状态分别拥有来源和刷新边界。
6. **页面只做组合**：页面负责布局和组合 feature，不直接编排多个底层 API 生命周期。
7. **不改变领域语义**：不重新引入 `UpstreamModel`、旧 API 别名、旧数据库兼容迁移或重复双写。
8. **每一步可回退、可验证**：每个阶段都必须能单独通过类型检查、测试和构建。

## 3. 目标结构

### 3.1 Server

```text
source/server/
├── index.ts
├── runtime/
├── management/
│   ├── router.ts
│   ├── request-body.ts
│   ├── error-handler.ts
│   ├── providers/
│   ├── models/
│   ├── config/
│   ├── auth/
│   └── ...
├── proxy/
│   ├── handler.ts
│   ├── request-entry.ts
│   ├── routing.ts
│   ├── attempt-executor.ts
│   ├── transport.ts
│   ├── protocol.ts
│   ├── health.ts
│   ├── logging.ts
│   └── ...
├── infrastructure/
│   ├── database/
│   │   ├── connection.ts
│   │   ├── schema.ts
│   │   ├── settings-store.ts
│   │   ├── provider-store.ts
│   │   ├── model-store.ts
│   │   ├── endpoint-store.ts
│   │   ├── routing-store.ts
│   │   ├── health-store.ts
│   │   ├── request-log-store.ts
│   │   └── analytics-store.ts
│   ├── secrets/
│   └── security/
└── security/                 # 迁移期间保留，完成后删除
```

### 3.2 Render

```text
source/render/source/
├── App.tsx
├── api/
│   ├── client.ts
│   ├── providers.ts
│   ├── logical-models.ts
│   ├── provider-models.ts
│   ├── scheduling-policies.ts
│   ├── queue.ts
│   ├── proxy.ts
│   ├── health.ts
│   ├── settings.ts
│   ├── logs.ts
│   ├── request-logs.ts
│   ├── analytics.ts
│   ├── model-test.ts
│   ├── config.ts
│   └── index.ts
├── features/
│   ├── providers/
│   ├── provider-models/
│   ├── queue/
│   ├── proxy/
│   ├── settings/
│   ├── request-logs/
│   ├── analytics/
│   └── config/
├── infrastructure/
│   ├── polling/
│   └── store/
├── components/
└── pages/
```

## 4. 分阶段执行计划

## 阶段 0：冻结边界与建立基线

### 目标

在修改代码前固定现有行为、依赖方向和验证命令。

### 工作项

- [ ] 记录当前 `pnpm typecheck`、`pnpm test:server`、`pnpm lint` 和 `pnpm build` 基线。
- [ ] 列出 `handler.ts`、`store.ts`、`api.ts` 的公开导出，作为迁移清单。
- [ ] 确认不修改数据库表语义、管理 API 路径和公共 Schema。
- [ ] 确认旧数据库、旧 API 和 `UpstreamModel` 不重新引入。
- [ ] 为每个 P0/P1 文件补充或确认现有测试入口。

### 验收

- 基线命令结果已记录。
- 每个待拆模块都有明确的旧入口、目标模块和兼容策略。

## 阶段 1：拆分数据库访问层

### 目标

将 `source/server/database/store.ts` 从实现单体变成兼容出口，按领域分离真实实现。

### 建议顺序

1. 抽取 `request-log-store.ts`：RequestLog、Attempt、Content、Usage、清理和详情查询。
2. 抽取 `endpoint-store.ts`：ProviderEndpoint、ProviderModelEndpoint。
3. 抽取 `routing-store.ts`：ProviderModel 路由、SchedulingPolicy、ProtocolConverter。
4. 抽取 `model-store.ts`：ProviderModel 基础 CRUD 和 mapper。
5. 保留 Provider、Health、Settings、Analytics 已有拆分。
6. 将文件移动到 `source/server/infrastructure/database/`。
7. 由旧 `database/store.ts` 暂时 re-export，逐个迁移调用方。
8. 所有调用方迁移后删除兼容实现，只保留明确的领域出口。

### 约束

- Store 不包含 HTTP 响应逻辑。
- Store 不包含 UI 或 Toast 依赖。
- mapper 与对应领域数据访问实现放在一起。
- request log 历史数据不增加对可变配置实体的外键依赖。

### 验收

- `store.ts` 不再包含跨领域查询实现。
- ProviderModel/Endpoint/RequestLog 测试全部通过。
- `pnpm typecheck`、`pnpm test:server`、`pnpm lint` 通过。

## 阶段 2：收敛代理 Handler

### 目标

让 `handler.ts` 只承担一次代理请求的生命周期编排。

### 目标职责

```text
handler
  读取 RequestContext
  获取路由候选
  按顺序执行 attempt
  处理 disposition
  结束请求生命周期
```

### 抽取模块

- `request-entry.ts`：body 读取、请求取消、模型字段解析、LogicalModel 解析。
- `routing.ts`：候选模型查询、协议过滤、手动模型起始位置。
- `attempt-executor.ts`：一次 ProviderModel 尝试。
- `transport.ts`：纯上游 HTTP、超时、流和连接生命周期。
- `protocol.ts`：协议识别和协议适配器调用。
- `logging.ts`：RequestLog、Attempt、Content、Usage hooks。
- `health.ts`：健康成功、失败和冷却归因。

### 迁移策略

- 先保持 `executeProxyRequest` 参数不变。
- 先抽出纯函数和无状态执行器，再移动副作用。
- 每抽出一个模块，先迁移单元测试，再删除 handler 内重复代码。
- 不在本阶段新增协议功能。

### 验收

- `handler.ts` 不直接导入数据库中所有观测函数。
- `handler.ts` 不直接构造 Node HTTP/HTTPS 请求。
- 单次 attempt 可独立测试。
- 网络错误、429/5xx、401、流中断、客户端取消行为保持不变。
- 完成 `specs/proxy.md` 中 Adapter、Context、Hooks 的未完成条目。

## 阶段 3：拆分 Render API 客户端

### 目标

将 `source/render/source/api.ts` 改为按领域组织的 API client。

### 工作项

- [ ] 抽出 `api/client.ts`：`request<T>()`、API_BASE 和通用响应处理。
- [ ] 按 Provider、ProviderModel、Queue、Proxy、Settings、Logs、Request Logs、Analytics、Config 等拆文件。
- [ ] 类型与对应 API 放在同一领域文件，跨领域公共类型放入 `common/schemas.ts`。
- [ ] 新建 `api/index.ts`，短期提供兼容 re-export。
- [ ] 逐个将页面从 `@/api` 聚合入口迁移到领域 API。
- [ ] 禁止基础 service 直接导入聚合 API。

### 验收

- 单个 API 文件只包含一个领域。
- `client.ts` 不包含任何业务 endpoint。
- 页面可以按领域追踪 API 依赖。
- 旧调用方迁移完成后删除不必要的聚合出口。

## 阶段 4：拆分 Render 全局状态与轮询

### 目标

保留共享缓存和轮询能力，但消除 `AppService` 的跨领域业务单体。

### 工作项

- [ ] 将轮询引用计数、请求去重和静默刷新抽到 `infrastructure/polling/`。
- [ ] 抽出 `proxy-service`、`provider-service`、`health-service`、`settings-service`、`logical-model-service`。
- [ ] 各领域拥有独立 store、loading 状态、刷新和失效操作。
- [ ] 将 `useAppActions()` 逐步替换为领域化 action hooks。
- [ ] 将全局单一 `lastError` 改为带领域标识的错误状态。
- [ ] 保留 `app-service.ts` 作为组合器，禁止继续添加具体业务实现。

### 依赖要求

```text
page/component
  -> feature hook
    -> domain service
      -> api client
        -> infrastructure
```

`services/use-async.ts` 不得依赖 `components/ui/toast.tsx`。Toast 错误展示由 feature 或页面组合层完成。

### 验收

- 轮询刷新不再触发无关页面的重复请求。
- Proxy 生命周期不会使 Provider/Settings service 产生隐式依赖。
- 后台轮询失败不会覆盖用户正在查看的其他领域错误。
- 原有页面闪烁问题不回归。

## 阶段 5：拆页面级 Service

### 5.1 Model Management

拆为：

- `use-provider-management`
- `use-provider-dialog`
- `use-provider-model-management`
- `use-model-dialog`
- `use-model-discovery`
- `use-model-reordering`

页面 facade 只负责组合这些 hooks。

### 5.2 Runtime Settings

拆为：

- `use-settings-form`
- `use-settings-save`
- `use-proxy-restart`
- `use-log-retention`
- `use-config-transfer`
- `use-development-seed`

配置导入后的缓存刷新通过明确的配置变更结果或领域事件完成，不再由页面手动全量 invalidate。

### 5.3 Queue Control

拆为：

- `use-queue-models`
- `use-queue-mode`
- `use-queue-metrics`
- `use-proxy-toggle`
- `model-metrics.ts` selector/util

队列页面不直接承担请求日志查询细节，指标查询或转换归入 Request Logs/Analytics feature。

### 5.4 Logs

将实时轮询、过滤、导出、清空和复制从 `logs/page.tsx` 中抽出，页面只负责组合：

- `use-live-logs`
- `use-log-filter`
- `use-log-actions`
- `log-toolbar`
- `log-list`

### 验收

- 页面 service 返回值明显缩小。
- Provider 和 ProviderModel 可独立测试。
- 设置保存、配置迁移和日志清理可独立测试。
- 页面组件不直接持有跨领域 API 请求流程。

## 阶段 6：整理 Management Router 与安全边界

### 工作项

- [ ] 抽出 `request-body.ts`。
- [ ] 抽出统一 `error-handler.ts`。
- [ ] 抽出 development-only API guard。
- [ ] 将配置导入导出拆为 `management/config/` 用例模块。
- [ ] 将管理认证归入 `management/auth/`。
- [ ] 将 Host 校验等技术安全适配归入 `infrastructure/security/`。
- [ ] 保留 `router.ts` 作为路由注册和匹配入口。

### 验收

- Router 不包含具体业务数据库操作。
- 配置导入导出可单独测试 merge、replace、密钥处理和 schemaVersion 校验。
- 管理认证和基础 Host 安全边界清晰。

## 阶段 7：清理重复原型与旧出口

### 工作项

- [ ] 确认 `linear-prototype` 是保留的设计演示还是删除对象。
- [ ] 若保留，移动至 `render/prototypes/`，禁止引用生产 feature 状态。
- [ ] 删除迁移期间的旧 re-export 和旧目录。
- [ ] 清理注释、测试、spec 中过时的目录和旧术语。
- [ ] 更新 `specs/server-architecture.md` 与实际目录。
- [ ] 更新 `specs/tech-architecture.md`、`specs/implementation-plan.md` 和 `specs/README.md` 的链接与状态。

## 5. 每阶段通用验收清单

每个阶段完成后执行：

- [ ] `pnpm typecheck`
- [ ] `pnpm test:server`
- [ ] `pnpm lint`
- [ ] `pnpm build`
- [ ] 相关页面浏览器回归验证
- [ ] 关键 API 路径未改变
- [ ] 数据库 schema 和 migration 未发生无计划变化
- [ ] 不引入旧领域名称和兼容别名
- [ ] 不新增跨层反向依赖
- [ ] 新增模块有对应测试或明确说明无需测试

## 6. 建议实施顺序

```text
基线冻结
  ↓
数据库 Store 分域
  ↓
Proxy Handler 收敛
  ↓
Render API 分域
  ↓
全局状态与轮询分域
  ↓
页面 Service 分域
  ↓
Management Router / Security 整理
  ↓
删除兼容出口与重复原型
  ↓
完整验收与文档同步
```

## 7. 暂不处理的内容

以下内容暂不因“看起来可以拆分”而提前复杂化：

- 不为只有一个实现、没有独立变化原因的简单文件建立空目录。
- 不为了目录对称而拆分稳定的 `runtime` 入口。
- 不在结构重构阶段增加 Gemini、多逻辑模型或新的路由策略。
- 不重新设计数据库表和公共领域模型。
- 不把所有 UI 组件强行改造成 feature 目录；只有包含业务状态或业务 API 的组件才迁移。

## 8. 完成定义

本计划完成的标准：

1. `proxy/handler.ts` 只负责编排，不直接拥有传输、观测和健康实现。
2. 数据库访问按 Provider、Model、Routing、Endpoint、Health、Request Logs、Analytics 等领域分离。
3. Render API 不再是一个包含所有业务的单文件。
4. 全局状态和轮询基础设施与具体业务服务分离。
5. 页面 service 只负责本页面组合，不承担多个领域的完整生命周期。
6. Management Router、配置迁移和安全适配边界清晰。
7. 结构重构后 `pnpm typecheck`、`pnpm test:server`、`pnpm lint` 和 `pnpm build` 全部通过。
8. `specs/server-architecture.md`、`specs/tech-architecture.md` 和本计划与实际代码结构一致。
