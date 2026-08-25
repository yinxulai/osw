# Server 架构设计

## 设计目标

`source/server` 是一个本地模块化服务，当前由 Electron 主进程使用，并服务于测试。当前阶段优先让代码按能力聚合、职责清楚，不为尚未出现的复杂度预设完整的领域驱动目录。

遵循四条规则：

1. 根目录只保留稳定入口，不放具体业务能力。
2. 代码先按能力归属，再按真实复杂度拆文件。
3. HTTP、SQLite、Keychain 等技术细节不主导业务目录。
4. 模块级可变状态逐步迁移到显式实例，由 Runtime 持有。

## 模块划分

Server 分为四块：

| 模块 | 职责 | 包含内容 |
| --- | --- | --- |
| `runtime` | 进程级组装与生命周期 | ServerRuntime、管理服务与代理服务的启动、停止和失败回滚 |
| `management` | 配置管理能力和管理 API | Provider、LogicalModel、ProviderModel、Endpoint、Settings 的管理入口 |
| `proxy` | 模型请求代理能力 | 协议识别、路由、转发、认证、健康冷却、重试和请求日志 |
| `database` | 持久化层 | SQLite、Drizzle schema、按领域拆分的 store |
| `infrastructure` / `security` | 系统技术适配 | Keychain、Host validation，以及未来可复用的系统适配器 |

健康冷却当前只服务于代理切换，因此属于 `proxy`，不单独建立 `reliability`。RequestLog 和 Attempt 由代理请求产生，也先归入 `proxy`。只有当它们形成独立生命周期或被多个能力共同使用时，才提升为一级模块。

## 当前实际目录

```text
source/server/
├── index.ts
├── runtime/server-runtime.ts
├── management/
│   ├── server.ts / router.ts / request-body.ts / response.ts / error-handler.ts
│   ├── providers.ts / models.ts / provider-models.ts / settings.ts
│   ├── relations.ts / config/ / request-logs.ts / logs.ts / analytics.ts
│   ├── runtime-control.ts / model-test.ts / provider-models-fetch.ts
│   └── auth/ / request-guards.ts / environment-guard.ts
├── proxy/
│   ├── server.ts / request-entry.ts / attempt-executor.ts / attempt-runner.ts
│   ├── request-context.ts / request.ts / routing.ts / router.ts / manual-routing.ts
│   ├── protocols/{types.ts,registry.ts}
│   ├── conversion.ts / conversion-response.ts / response-pipeline.ts
│   └── transport.ts / headers.ts / auth.ts / health.ts / logging.ts / hooks.ts
├── database/                         # SQLite + Drizzle 持久化层
│   ├── index.ts / schema.ts
│   ├── provider-store.ts / model-store.ts / logical-model-store.ts
│   ├── settings-store.ts / health-store.ts / request-log-store.ts
│   └── analytics-store.ts / development-seed.ts
├── infrastructure/{secrets/,security/}
└── security/                          # Host validation 等安全适配
```

当前不存在 `proxy/handler.ts`、`source/server/api/` 或 `infrastructure/database/`。`request-entry.ts` 是代理请求入口，`database/` 是明确的持久化层；不新增仅为目录对称服务的空文件。

## 依赖方向

```mermaid
flowchart TD
  Electron[Electron / CLI] --> Runtime[runtime]
  Runtime --> Management[management]
  Runtime --> Proxy[proxy]
  Management --> Database[database 持久化层]
  Proxy --> Database
  Management --> Infrastructure[infrastructure / security]
  Proxy --> Infrastructure
  Management --> ProxyControl[proxy lifecycle API]
```

依赖约束：

- `index.ts` 只暴露稳定 API，不包含资源初始化细节。
- `runtime` 可以组装所有模块，但不包含 Provider CRUD、路由和转发规则。
- `management` 可以调用代理公开的生命周期控制 API，不应 import 代理内部路由和 transport。
- `proxy` 不依赖 management；它只读取运行所需的配置和密钥。
- `infrastructure` 不反向依赖 runtime、management 或 proxy。
- 新增进程级状态时必须说明所有者，不能默认放进模块级变量。

## 关键调用链

### 创建 Provider

```text
POST /api/provider/create
  -> management/router.ts
  -> management/providers.ts
  -> infrastructure/secrets/secret-store.ts
  -> database/provider-store.ts
  -> HTTP response
```

密钥写入与 Provider 保存的补偿逻辑属于 `management/providers.ts`，不应留在通用 HTTP router 中。

### 转发模型请求

```text
Client request
  -> proxy/server.ts
  -> proxy/request-entry.ts
  -> proxy/request-context.ts / request.ts
  -> proxy/router.ts + routing.ts + health.ts
  -> proxy/attempt-executor.ts / attempt-runner.ts
  -> proxy/protocols/registry.ts
  -> proxy/transport.ts / response-pipeline.ts
  -> proxy/logging.ts + database/request-log-store.ts
  -> Client response
```

`request-entry.ts` 负责入口解析，`attempt-executor.ts` 负责编排候选尝试；协议注册、协议转换、传输、响应管线和观测分别由对应模块负责。当前协议范围以 `source/common/schemas.ts` 为准，不包含 Gemini。

## 生命周期

`source/server/index.ts` 是对外生命周期入口，仅负责持有和转交唯一的 `ServerRuntime` 实例；实际的数据库、management、proxy 启停顺序、失败回滚和资源释放由 `source/server/runtime/server-runtime.ts` 编排。

```mermaid
stateDiagram-v2
  [*] --> created
  created --> starting: start()
  starting --> running: management + proxy ready
  starting --> stopped: 启动失败并回滚
  running --> stopping: stop()
  stopping --> stopped: 资源释放完成
  stopped --> starting: start()
```

- 代理停止或重启不影响管理服务。
- 启动失败必须关闭已经启动的监听器和数据库。
- 停止操作保持幂等。
- 两个监听器均为实例，由 `ServerRuntime` 持有，不使用模块级可变状态。

## 实施状态

1. [已完成] `runtime/server-runtime.ts` 持有管理服务、代理服务和数据库生命周期。
2. [已完成] 管理 API 按 Provider、LogicalModel、ProviderModel、关系、配置、日志、分析和运行时控制分域，统一由 `management/router.ts` 注册。
3. [已完成] 代理入口、请求上下文、路由、尝试执行、协议适配器注册表、协议转换、传输、响应管线、健康和观测已拆为实际模块。
4. [已完成] SQLite 代码保留在 `database/`，并按 Provider、Model、LogicalModel、Settings、Health、Request Log、Analytics 拆分 store；不使用 `infrastructure/database/store.ts`。
5. [已完成] Render 端通过 `api/*.ts`、`features/*`、页面 hooks 和 `infrastructure/polling-manager.ts` 分域；不保留单体 API 或 app-service 兼容出口。
6. [已完成] v0.3 不保留兼容 facade、re-export、旧 API 别名、旧领域名称或双读双写。
7. [已完成（源码/构建验证）] `typecheck`、`lint`、`test:server` 通过，共 239 tests；Vite bundling 通过。`electron-builder` 在 Windows 当前用户缺少符号链接权限时失败，因此 UI 回归与发布包验证仍待人工完成。

验证命令以根目录 `package.json` 的 scripts 为准；文档更新不代替最终验证执行。
