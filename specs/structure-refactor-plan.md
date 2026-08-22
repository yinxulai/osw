# One Switch 结构分层整理计划

> 目标：以 v0.3 的全新、不兼容契约为前提，整理职责展平、跨领域耦合和重复状态来源，形成与当前源码一致的模块边界。
>
> 本计划对应当前 v0.3 收尾阶段的结构治理，不是新功能开发计划。全新版本不保留兼容 facade、re-export、旧目录出口、旧 API 别名或旧领域模型；重构完成后直接删除旧出口，而不是继续维护迁移层。

## 1. 当前问题摘要

当前最明显的展平点如下：

| 优先级 | 文件/目录 | 主要问题 |
| --- | --- | --- |
| P0 | `source/server/proxy/` | 代理入口、请求解析、路由、转换、传输、观测已拆为多个真实模块，仍需最终核对职责边界 |
| P0 | `source/server/database/` | 持久化层已按 Provider、Model、LogicalModel、Settings、Health、Request Log、Analytics 分 store |
| P1 | `source/render/source/api/` | 管理 API client 已按 runtime、providers、models、observability、tools 分模块 |
| P1 | `source/render/source/features/` 与页面 hooks | 领域服务和页面 hooks 已替代旧的跨领域 app-service 目标结构；共享轮询由 `infrastructure/polling-manager.ts` 支持 |
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
2. **全新版本直接切换**：不建立兼容 facade、re-export、旧目录出口或双读双写；调用方迁移完成后旧文件立即删除。
3. **单向依赖**：入口层依赖业务层，业务层依赖基础设施，基础设施不反向依赖 UI 或业务模块。
4. **一个模块一个主要变化原因**：配置、路由、传输、观测和展示不应共用同一个核心实现文件。
5. **状态按领域归属**：Provider、Proxy、Settings、Health 等状态分别拥有来源和刷新边界。
6. **页面只做组合**：页面负责布局和组合 feature，不直接编排多个底层 API 生命周期。
7. **不改变领域语义**：不重新引入 `UpstreamModel`、旧 API 别名、旧数据库兼容迁移或重复双写。
8. **每一步可回退、可验证**：每个阶段都必须能单独通过类型检查、测试和构建。

## 3. 目标结构

### 3.1 Server（当前实际结构）

```text
source/server/
├── index.ts
├── runtime/server-runtime.ts
├── management/
│   ├── server.ts / router.ts / request-body.ts / response.ts / error-handler.ts
│   ├── providers.ts / provider-models.ts / models.ts / settings.ts
│   ├── relations.ts / config/ / request-logs.ts / logs.ts / analytics.ts
│   ├── runtime-control.ts / model-test.ts / provider-models-fetch.ts
│   ├── auth/ / request-guards.ts / environment-guard.ts
├── proxy/
│   ├── server.ts / request-entry.ts / attempt-executor.ts / attempt-runner.ts
│   ├── request-context.ts / request.ts / routing.ts / router.ts / manual-routing.ts
│   ├── protocols/{types.ts,registry.ts}
│   ├── conversion.ts / conversion-response.ts / response-pipeline.ts
│   ├── transport.ts / headers.ts / auth.ts / health.ts / logging.ts / hooks.ts
├── database/                         # 明确的 SQLite + Drizzle 持久化层
│   ├── index.ts / schema.ts
│   ├── provider-store.ts / model-store.ts / logical-model-store.ts
│   ├── settings-store.ts / health-store.ts / request-log-store.ts
│   ├── analytics-store.ts / development-seed.ts
├── infrastructure/{secrets/,security/}
└── security/                         # Host 校验等现有安全适配
```

`database/` 保留在 `server` 下，不再虚构 `infrastructure/database/`；它是被 management、proxy、runtime 使用的明确持久化层。

### 3.2 Render（当前实际结构）

```text
source/render/source/
├── App.tsx / main.tsx
├── api/{client.ts,providers.ts,models.ts,runtime.ts,observability.ts,tools.ts}
├── features/{health,logical-models,providers,proxy,settings}/
├── infrastructure/{polling-manager.ts,deep-equal.ts}
├── store/create-store.ts
├── services/use-async.ts
├── components/
└── pages/{overview,model-management,queue-control,request-logs,logs,runtime-settings}/
```

当前不存在 `source/render/source/api/index.ts`、旧的单文件 `api.ts` 或 `services/app-service.ts`；不得以这些名称描述目标或新增兼容出口。

## 4. 分阶段执行计划

## 阶段 0：冻结边界与建立基线

### 目标

在修改代码前固定现有行为、依赖方向和验证命令。

### 工作项

- [x] 核对当前 `package.json` scripts：`typecheck`、`test:server`、`lint`、`build` 及数据库脚本均已确认。
- [x] 核对实际入口与公开边界：代理入口为 `request-entry.ts`，持久化为 `database/*-store.ts`，Render API 为 `api/*.ts`。
- [x] 确认不重新引入旧数据库表、旧 API 路径、`UpstreamModel` 或兼容别名。
- [x] 确认当前协议集合为 OpenAI Completions、OpenAI Responses、Anthropic Messages；Gemini 不属于当前支持范围。
- [x] 确认现有 server、database、management、proxy、render 测试入口。

### 验收

- 基线命令结果已记录。
- 每个待拆模块都有明确的旧入口、目标模块和兼容策略。

## 阶段 1：拆分数据库访问层

### 目标

将数据库访问按持久化领域组织，同时保留 `source/server/database/` 作为明确的 Server 持久化层。该阶段已完成，不建立 `store.ts` 兼容出口，也不迁移到不存在的 `infrastructure/database/`。

### 已完成内容

1. `request-log-store.ts` 负责 RequestLog、Attempt、Content、Usage、清理和详情查询。
2. `provider-store.ts`、`model-store.ts`、`logical-model-store.ts` 负责 Provider、ProviderModel、端点和逻辑模型/调度关系。
3. `settings-store.ts`、`health-store.ts`、`analytics-store.ts` 负责设置、健康和统计。
4. 调用方已直接引用分域 Store；当前工作区未发现 `database/store.ts` facade 或 re-export。

### 约束

- Store 不包含 HTTP 响应逻辑。
- Store 不包含 UI 或 Toast 依赖。
- mapper 与对应领域数据访问实现放在一起。
- request log 历史数据不增加对可变配置实体的外键依赖。

### 验收

- 不存在历史单体 `store.ts`，跨领域查询不得回归到单体实现。
- ProviderModel/Endpoint/RequestLog 测试全部通过。
- `pnpm typecheck`、`pnpm test:server`、`pnpm lint` 通过。

## 阶段 2：收敛代理请求管线（已完成）

### 目标

让当前代理入口和尝试执行模块只承担请求生命周期编排。该阶段已完成，当前入口为 `request-entry.ts`，尝试执行为 `attempt-executor.ts` / `attempt-runner.ts`。

### 当前职责

```text
request-entry
  读取 RequestContext
  解析 client protocol 与 logical model
  获取路由候选
  委托 attempt-executor

attempt-executor / attempt-runner
  按顺序执行 attempt
  调用协议适配器、transport、response pipeline
  处理 disposition、健康与观测收尾
```

### 当前模块

- `request-entry.ts`：body 读取、请求取消、模型字段解析、LogicalModel 解析。
- `routing.ts` / `router.ts`：候选模型查询、协议过滤、手动模型起始位置。
- `attempt-executor.ts` / `attempt-runner.ts`：ProviderModel 尝试及生命周期编排。
- `transport.ts`：纯上游 HTTP、超时、流和连接生命周期。
- `protocols/registry.ts`：协议适配器注册与调用边界。
- `conversion.ts` / `conversion-response.ts`：已注册协议转换及响应/SSE 转换。
- `logging.ts` / `hooks.ts`：RequestLog、Attempt、Content、Usage 观测 hooks。
- `health.ts`：健康成功、失败和冷却归因。

### 完成记录

- [x] `request-entry.ts` 保持代理入口，`executeProxyRequest` 位于 `attempt-executor.ts`，未保留旧 `handler.ts`。
- [x] 协议适配器、request context、传输、响应管线和观测 hooks 已有对应源码与测试。
- [x] 不新增 Gemini 或其他未注册协议功能。

### 验收

- [x] 旧 `handler.ts` 不存在；请求入口不直接承担 transport 和协议转换实现。
- [x] 单次 attempt 可独立测试。
- [x] 网络错误、429/5xx、401、流中断、客户端取消行为已有测试覆盖。
- [ ] 发布包端到端验证仍待完成，尤其是各已注册协议转换方向。

## 阶段 3：拆分 Render API 客户端（已完成）

### 目标

将管理 API client 按领域组织到 `source/render/source/api/`。单文件 `api.ts` 已删除，不建立聚合出口。

### 工作项

- [x] `api/client.ts` 已提供通用 `request<T>()`、运行时 API 地址和响应处理。
- [x] 管理 API 已按 `providers.ts`、`models.ts`、`runtime.ts`、`observability.ts`、`tools.ts` 分域。
- [x] 页面和 feature 已直接引用领域 API；不存在单文件 `source/render/source/api.ts` 或 `api/index.ts` 聚合出口。
- [x] 跨层公共数据契约继续放在 `source/common/schemas.ts`；未新增兼容 re-export。

### 验收

- 单个 API 文件只包含一个领域。
- `client.ts` 不包含任何业务 endpoint。
- 页面可以按领域追踪 API 依赖。
- 旧调用方迁移完成后删除不必要的聚合出口。

## 阶段 4：拆分 Render 全局状态与轮询

### 目标

保留共享缓存和轮询能力，但消除 `AppService` 的跨领域业务单体。

### 工作项

- [x] 共享轮询基础设施已落在 `source/render/source/infrastructure/polling-manager.ts`，而非虚构的 `infrastructure/polling/` 目录。
- [x] Provider、Proxy、Health、Settings、Logical Models 已按 `features/*` 服务与 hooks 组织。
- [x] 页面通过 feature hooks 和页面 hooks 组合数据；不存在 `app-service.ts`、`app-store.ts` 或 `useAppActions()` 旧单体出口。
- [x] 轮询和缓存边界已从具体页面业务中分离；后续只需做最终回归验证。

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

当前实际 hooks 为：

- `hooks/use-provider-management.ts`
- `hooks/use-provider-dialog.ts`
- `hooks/use-model-management.ts`
- `hooks/use-model-data.ts`
- `hooks/use-model-dialog.ts`
- `hooks/use-model-reordering.ts`

`use-model-management.ts` 负责组合页面所需 hooks；当前不存在单独的 `use-provider-model-management`、`use-model-discovery` 或 `use-model-reordering` 之外的历史拆分名称。

### 5.2 Runtime Settings

当前实际 hooks 为：

- `hooks/use-settings-form.ts`
- `hooks/use-request-log-retention.ts`
- `hooks/use-config-transfer.ts`
- `hooks/use-development-seed.ts`

代理重启和保存逻辑由实际 settings service/API 组合，不虚构不存在的 `use-settings-save`、`use-proxy-restart` 或 `use-log-retention` 文件。

配置导入后的缓存刷新通过明确的配置变更结果或领域事件完成，不再由页面手动全量 invalidate。

### 5.3 Queue Control

当前实际 hooks 和 selector 为：

- `hooks/use-queue-models.ts`
- `hooks/use-queue-mode.ts`
- `hooks/use-queue-metrics.ts`
- `hooks/use-proxy-toggle.ts`
- `hooks/use-queue-interactions.ts`
- `hooks/use-queue-control.ts`
- `lib/model-metrics.ts` selector/util

队列页面不直接承担请求日志查询细节，指标查询或转换归入 Request Logs/Analytics feature。

### 5.4 Logs

当前由 `pages/logs/hooks/use-logs-model.ts` 承担实时轮询、过滤、导出、清空和复制相关模型；`logs/page.tsx` 负责组合页面 UI。后续若继续细拆，应以该实际 hook 为入口，不将不存在的 `use-live-logs`、`use-log-filter` 或 `use-log-actions` 写成已落地文件。

### 验收

- 页面 service 返回值明显缩小。
- Provider 和 ProviderModel 可独立测试。
- 设置保存、配置迁移和日志清理可独立测试。
- 页面组件不直接持有跨领域 API 请求流程。

## 阶段 6：整理 Management Router 与安全边界

### 工作项

- [x] `request-body.ts`、`error-handler.ts`、`environment-guard.ts` 和 `request-guards.ts` 已从管理路由入口拆出。
- [x] 配置导入导出归入 `management/config/`，管理认证归入 `management/auth/`。
- [x] `router.ts` 仅负责管理 API 路由注册、环境限制、body 解析和错误边界。
- [x] Host 校验实际位于 `source/server/security/host-validation.ts`；密钥适配位于 `source/server/infrastructure/secrets/`，不虚构新的安全目录。

### 验收

- Router 不包含具体业务数据库操作。
- 配置导入导出可单独测试 merge、replace、密钥处理和 schemaVersion 校验。
- 管理认证和基础 Host 安全边界清晰。

## 阶段 7：清理重复原型与旧出口

### 工作项

- [x] `source/render/source/pages/linear-prototype/` 已删除，不再作为设计演示或生产页面维护。
- [x] 迁移期间的旧出口、旧 re-export 和旧目录已删除；当前代理入口为 `request-entry.ts`，Render API 为 `api/*.ts`。
- [ ] 清理注释、测试和 spec 中残留的旧术语与过时状态；旧 handler/API 聚合出口及虚构 Electron/preload 目录已清理。
- [x] `specs/server-architecture.md`、`specs/tech-architecture.md`、`specs/implementation-plan.md` 和本文已同步当前目录与状态。

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

## 8. 本轮完成记录与最终验证

### 本轮已完成

- 核对 `source/` 实际结构与 `package.json` scripts；文档不再引用不存在的 `handler.ts`、`api/index.ts`、旧 `app-service` 或 `infrastructure/database`。
- 明确 v0.3 全新版本不保留兼容 facade、re-export、旧目录出口、旧 API 别名、旧领域模型或双读双写。
- 明确 `source/server/management/`、`source/server/proxy/`、`source/render/source/` 三个运行域，以及 `source/server/database/` 的持久化职责。
- 标记数据库分域、Proxy 请求管线、Render API 分域和 Render feature/hooks 等已落地工作项完成。
- 校正文档中的协议范围和协议转换描述：当前仅支持 OpenAI Completions、OpenAI Responses、Anthropic Messages；Gemini 尚未实现，协议转换通过 `proxy/protocols/`、`conversion.ts` 和 `conversion-response.ts` 的已注册方向提供，不宣称 OpenAPI 已完成。

### 最终验证记录

- [x] `pnpm typecheck`、`pnpm lint`、`pnpm test:server` 已通过，共 239 tests。
- [x] Vite bundling 已通过。
- [x] `electron-builder` 已尝试，但因 Windows 当前用户没有符号链接权限而失败。
- [ ] UI 回归和发布包验证仍待人工完成，包括全新用户数据目录、Windows 安装、托盘/控制台以及发布包协议端到端验证。
- [x] 已按源码路由注册表和实际目录完成文档核对；文档更新不代替 UI/发布包人工验证。

本计划不再以“保留兼容出口”作为完成条件；最终标准是旧出口不存在、源码结构与本文及相关架构文档一致。
