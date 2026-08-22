# 技术架构与框架选型

> **状态说明：本文描述 v0.3 当前实现与明确的后续边界。** 数据库、关系模型、核心路由、请求观测、管理 API、协议适配器基础边界和渲染层分域已经落地；OpenAPI 文档与代码生成尚未接入，不作为当前实现依赖。发布包端到端验证仍以 `implementation-plan.md` 和本轮最终验证清单为准。

## 整体技术栈

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| 桌面壳 | Electron | 跨平台桌面应用 |
| 构建工具 | Vite | 主进程 / 预加载 / 渲染进程统一构建 |
| 主进程 | TypeScript + 原生 Node `http` | 独立的代理服务与管理服务，不引入 HTTP 框架 |
| 代理透传 | 原生 `http.request` + 手动 pipe | 流式可控、依赖最少 |
| Schema 定义 | Zod | 运行时类型校验、配置声明、API 请求/响应验证 |
| API 规范 | Zod Schema + 源码路由注册表 | 当前管理契约由 `source/common/schemas.ts` 与 `source/server/management/router.ts` 实现；OpenAPI 尚未接入 |
| 代码生成 | 未使用 | Render API client 为 `source/render/source/api/client.ts` 中的手写轻量 fetch 封装 |
| 本地存储 | SQLite（`node:sqlite` + Drizzle ORM）+ 系统密钥环 | 配置和日志存 SQLite，密钥存 keychain |
| 数据库迁移 | 单一首发基线 + 发布后版本迁移 | 首发结构干净，发布后升级可追踪 |
| 渲染进程 | React 18 + TypeScript | 控制台 UI |
| UI 组件 | shadcn/ui + Tailwind CSS | 现代、可定制、体积小 |
| 状态管理 | 轻量外部 Store + React hooks | 共享应用状态、缓存和轮询 |

## 关键技术决策

### 为什么不用 HTTP 框架

代理服务和管理服务各自使用一个原生 `http.createServer` 实例，不引入 Hono/Fastify/Express：

- 管理 API 端点不多（配置 CRUD、日志、健康状态，约十几个接口），原生路由足够
- 代理透传层需要完全掌控请求/响应流，框架反而增加抽象成本
- 两个监听器共享应用级数据库和密钥存储，但生命周期独立；停止或重启代理不会中断管理 API
- 减少依赖，降低打包体积和安全面
- 代理服务是纯 Node 模块，Electron 只是宿主，未来可抽 CLI / 无头模式

### 为什么用 Zod 做 Schema

- **单一真相源**：配置模型、API 请求/响应、数据库行都用 Zod schema 定义，TypeScript 类型从中推导
- **运行时校验**：管理 API 的入参出参、配置导入导出、数据库读写都在边界处校验，保证数据一致性
- **边界明确**：当前使用 Zod 做运行时校验和共享契约；未来若接入 OpenAPI，必须以现有 Schema/路由为基础，不能反向虚构已生成的类型或接口文件
- **零依赖膨胀**：Zod 体积小，不引入额外运行时

### 为什么用统一 POST 风格 API

管理 API 全部使用 POST 方法，路径格式为 `/api/资源/动作`，不依赖 HTTP 方法和状态码语义。以下是 v0.3 当前契约；旧版 `/api/upstream-model/*` 路径已删除，不提供兼容别名。实际注册路由以 `source/server/management/router.ts` 为准：

- **简单一致**：前端调用统一用 POST，不需要区分 GET/POST/PUT/DELETE，不需要处理不同状态码
- **结构化错误**：错误通过 body 中的 `success`、`errorCode`、`errorMessage` 表达，类型安全，前端可统一处理
- **便于调试**：所有请求都有 body，日志和抓包一目了然
- **避免歧义**：HTTP 状态码只表示网络层是否成功，业务结果完全由 body 决定
- **控制动作明确**：启动、停止、重启代理等管理操作可直接表达为 `/api/proxy/动作`

### OpenAPI 的当前边界

OpenAPI 目前未接入，项目没有 OpenAPI 文档、生成类型或 `openapi-typescript` 依赖。当前契约由 Zod Schema、管理路由注册表和 Render 的手写 API client 共同构成。未来如确有 CLI 或第三方集成需求，再单独引入 OpenAPI，并补充生成与一致性验证。
### 为什么用 SQLite 替代 JSON/JSONL

- **查询能力**：日志筛选、分页、统计用 SQL 比遍历 JSONL 高效得多
- **事务一致性**：配置变更（如删除 Provider 级联禁用 Provider 模型）用事务保证原子性
- **迁移可控**：首发前只保留最终基线，首发后冻结基线并追加事务化版本迁移
- **单文件部署**：SQLite 是单个文件，和 JSON 一样便携，备份/导入导出都方便
- **Drizzle ORM**：提供类型安全的同步数据访问，SQLite 查询集中在 database store 边界；基于 Node 22.5+ 内置 `node:sqlite`，零原生依赖、无 ABI 问题

## 项目结构

```
one-switch/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
├── specs/                          # 产品规格文档
├── source/
│   ├── server/                     # 核心主体：runtime + management + proxy + database
│   │   ├── index.ts                # 外部生命周期入口
│   │   ├── runtime/server-runtime.ts # ServerRuntime 启动/停止编排
│   │   ├── management/             # 管理 HTTP 服务、API route modules、auth/config/guards
│   │   ├── proxy/                  # request-entry、routing、attempt、protocols、conversion、transport
│   │   ├── database/               # SQLite + Drizzle 持久化层及按领域拆分的 *-store.ts
│   │   ├── infrastructure/secrets/ # 系统密钥环适配
│   │   └── security/               # Host validation
│   │
│   ├── command/                    # Electron 主进程、预加载与命令入口
│   │   ├── index.ts                # Electron 应用编排
│   │   ├── preload.ts              # 暴露最小化 API 给渲染进程
│   │   ├── auto-launch.ts          # 开机自启
│   │   ├── tray-manager.ts         # 菜单栏/托盘管理
│   │   └── secret-store.ts         # 系统密钥环封装
│   │
│   ├── common/                     # server / command / render 共享
│   │   ├── schemas.ts              # Zod schema（可被 server、command 和 render 引用）
│   │
│   └── render/                     # UI 入口：React 渲染进程
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       ├── api/                    # client.ts + 按领域 API modules
│       ├── features/               # Provider、Proxy、Health、Settings、Logical Models
│       ├── infrastructure/         # polling-manager、deep-equal
│       ├── store/                  # create-store
│       ├── components/             # shadcn/ui 组件 + 业务组件
│       ├── pages/                  # 按页面目录组织的 page、service、hooks
│       └── services/               # 通用 use-async
│
└── resources/                      # 静态资源：图标、托盘图标等
```

## 核心模块设计

> 下方模块说明以当前源码为准。协议适配器、request context、协议转换、请求观测和管理 API 路由已经有实际实现；OpenAPI 定义和代码生成尚未接入。

### 1. 核心服务（`source/server/`）

核心主体包含共享运行时、管理服务、代理服务和 SQLite 持久化层。核心逻辑不依赖 Electron，可由 Electron 主进程和测试复用；当前没有独立的 CLI 产品入口。

**`index.ts`** — 外部服务生命周期入口
- 对外提供 `startServer` / `stopServer`
- 管理唯一的 `ServerRuntime` 实例，不承载具体启动编排

**`runtime/server-runtime.ts`** — ServerRuntime 编排
- 配置密钥存储、日志捕获和数据库
- 按顺序启动/停止 management 与 proxy，并在失败时回滚资源
- 持有运行状态和管理服务实例

**`proxy/`** — 代理透传层（纯 Node，无 Electron 依赖）

**`proxy/server.ts`** — 代理服务生命周期
- 按设置中的 `listenHost`、`listenPort` 独立监听
- 提供幂等的启动、停止、重启和状态查询
- 重启时重新读取监听配置，不影响管理服务

**`proxy/router.ts` 与 `proxy/protocols/registry.ts`** — 协议识别与适配
- `router.ts` 根据 path 识别当前支持的协议：OpenAI Completions、OpenAI Responses、Anthropic Messages
- `protocols/registry.ts` 注册直连和已实现的协议转换方向；未注册方向拒绝
- `auth.ts` 按 OpenAI/Anthropic 协议注入认证与版本头
- 当前不支持 Gemini 或 Custom 协议

**`proxy/router.ts`** — 路由引擎
- 输入：clientProtocol + 客户端 `model`；v0.3 MVP 将任意非空模型名解析为 `default`
- 输出：候选 Provider 模型列表（按优先级排序，过滤禁用/冷却/额度耗尽）
- 切换时取下一个 Provider 模型
- 处理"该协议下无可用端点自动跳过"逻辑

**`proxy/transport.ts`** — 上游透传
- 封装 `http.request` / `https.request`
- 根据协议默认认证方式注入认证头
- 超时控制：连接超时 + 空闲超时（两次数据到达的最大间隔，流式持续返回不超时）
- 错误分类：network / timeout / 4xx / 5xx
- 返回 `Attempt` 结果

**`proxy/response-pipeline.ts` 与 `proxy/response.ts`** — 流式响应边界
- 跟踪响应头是否已发出
- 响应头发出前：失败可切换
- 响应头发出后：失败不切换，直接透传或转换错误
- 管理客户端响应流的写入时机

**`proxy/health.ts`** — 健康状态与冷却
- 维护每个 Provider 的连续失败计数、冷却截止时间
- 成功/失败回调更新状态
- 提供 `isAvailable(providerId): boolean`

**`proxy/manual-routing.ts`** — 当前逻辑模型手动指定的 ProviderModel 状态
- 维护当前用户手动指定的 Provider 模型 ID（运行时状态，不持久化）
- 新请求从当前 ProviderModel 开始尝试，失败后仍按队列顺序自动切换
- 进行中的请求持有自己的 ProviderModel 引用，不受外部切换影响

`proxy/server.ts` 内置 `/v1/models` 本地接口，仅返回当前 `default` 逻辑模型可见的模型信息。

### 2. 管理 API（目标模块 `source/server/management/`）

统一 POST 风格 API，挂载到独立管理服务的 `/api` 前缀。管理服务默认监听 `127.0.0.1:9301`，React UI 通过轻量 HTTP client 调用。当前实现位于 `source/server/management/`，并已按该路径迁移；下方接口表保留为契约摘要，具体路由以源码注册表为准。

**设计原则：**
- 所有接口统一使用 `POST` 方法，不依赖 HTTP 方法语义
- 路径格式：`/api/资源/动作`，如 `/api/provider/list`、`/api/provider/create`
- 代理生命周期：`/api/proxy/status`、`/api/proxy/start`、`/api/proxy/stop`、`/api/proxy/restart`
- 所有响应通过结构化 body 返回，HTTP 状态码始终为 200（除非网络层错误）
- 错误信息通过响应体中的 `success`、`errorCode`、`errorMessage` 字段表达

**统一响应格式：**

```ts
// 成功响应
{
  success: true,
  data: { ... }
}

// 失败响应
{
  success: false,
  errorCode: "PROVIDER_NOT_FOUND",
  errorMessage: "供应商不存在"
}
```

**接口列表（以 `source/server/management/router.ts` 注册表为准）：**

| 路径 | 说明 |
|------|------|
| `/api/provider/list`、`/api/provider/get`、`/api/provider/endpoints` | Provider 列表、详情、端点列表 |
| `/api/provider/create`、`/api/provider/update`、`/api/provider/delete` | Provider 配置变更 |
| `/api/provider/reset-health`、`/api/provider/fetch-models` | 重置健康状态、从 Provider 获取模型 |
| `/api/logical-model/list`、`/api/logical-model/get` | 逻辑模型列表、详情 |
| `/api/logical-model/create`、`/api/logical-model/update`、`/api/logical-model/delete` | 逻辑模型配置变更 |
| `/api/provider-model/list`、`/api/provider-model/queue`、`/api/provider-model/get` | Provider 模型列表、队列和详情 |
| `/api/provider-model/create`、`/api/provider-model/update`、`/api/provider-model/delete` | Provider 模型配置变更 |
| `/api/scheduling-policy/list`、`/api/scheduling-policy/update`、`/api/scheduling-policy/delete` | 调度策略查询与变更 |
| `/api/relation/provider-setting/*` | Provider 设置的 list/get/upsert/delete |
| `/api/relation/provider-endpoint/*` | Provider 端点的 list/get/create/update/delete |
| `/api/relation/provider-model-endpoint/*` | Provider 模型端点的 list/get/create/update/delete |
| `/api/relation/protocol-converter/*` | 协议转换器的 list/get/create/update/delete |
| `/api/settings/get`、`/api/settings/update` | 全局设置查询与更新 |
| `/api/queue/status`、`/api/queue/switch` | 队列状态与手动切换 |
| `/api/health/list` | Provider/模型健康状态列表 |
| `/api/proxy/status`、`/api/proxy/start`、`/api/proxy/stop`、`/api/proxy/restart` | 代理服务生命周期控制 |
| `/api/logs/list`、`/api/logs/export`、`/api/logs/clear` | 实时运行日志查询、导出、清空 |
| `/api/request-log/list`、`/api/request-log/detail`、`/api/request-log/prune` | 请求日志列表、详情、清理 |
| `/api/analytics/summary` | 统计分析汇总 |
| `/api/model-test/run` | 模型测试 |
| `/api/config/export`、`/api/config/import`、`/api/config/seed-development` | 配置导出、导入、开发数据种子 |
| `/api/local-auth/status`、`/api/local-auth/generate`、`/api/local-auth/rotate`、`/api/local-auth/delete` | 本地认证状态与凭据管理 |

通配符 `*` 表示表中同一资源下实际存在的 `list`、`get`、`create`、`update`、`delete` 或 `upsert` 路径；所有路由均由 `router.ts` 合并注册，未提供旧版兼容别名。

### 3. 数据存储（`source/server/database/`）

使用 SQLite（`node:sqlite` + Drizzle ORM），配置和日志都存在本地数据库文件中。该目录就是当前 Server 的明确持久化层，不再描述为 `source/server/infrastructure/database/`。

**`index.ts`** — 数据库连接
- 初始化数据库连接（`node:sqlite` `DatabaseSync` → Drizzle 实例）
- 幂等创建首发目标表和索引；首发前不携带内部迭代的兼容逻辑
- 提供数据库实例（`getDb`）

**`schema.ts`** — Drizzle 表定义
- 新版本 v0.3 16 张核心表（包含 `request_usages`）的 `sqliteTable` 定义；其中 `scheduling_policies` 是 LogicalModel-ProviderModel 调度绑定表；这是实施目标，不代表当前源码已完成迁移。
- `settings` 按命名空间 key 逐项保存全局配置，标量按类型保存，数组/对象才使用 JSON 编码
- `request_contents` 独立保存可选的请求/响应正文，避免大字段影响日志列表查询
- 从表定义推导行类型（`$inferSelect`）

**`*-store.ts`** — 按领域拆分的数据访问层
- `provider-store.ts`、`model-store.ts`、`logical-model-store.ts` 负责 Provider、ProviderModel、端点和逻辑模型/调度关系
- `settings-store.ts`、`health-store.ts`、`request-log-store.ts`、`analytics-store.ts` 分别负责设置、健康、请求观测和统计
- 使用 Drizzle 类型化查询（`select`/`insert`/`update`），映射到领域模型；不存在跨领域 `store.ts` 单体或兼容 re-export

**`drizzle/`** — Drizzle-kit 迁移
- `pnpm db:generate` 根据 schema.ts 生成迁移 SQL
- 正式版发布前只保留一份 `initial_schema` 基线迁移和对应快照
- 首发后冻结基线，只追加后续版本迁移，不改写已发布历史

> API Key 等敏感信息仍存储在系统密钥环中，数据库仅存引用 ID。

开发版和正式版通过 `source/common/runtime-profile.ts` 中的显式 profile 区分。profile 统一定义应用数据目录、代理端口、管理端口和管理 API 地址，Electron、服务端与 renderer 共用同一配置源。开发版使用 `One Switch Development` 数据目录和 `19300/19301`，正式版使用 `One Switch` 数据目录和 `9300/9301`；数据库、`secrets.json` 与监听端口均完整隔离。

### 4. 主进程与入口（`source/command/`）

`source/command/` 是当前 Electron 主进程和桌面生命周期入口，包含 `index.ts`、`preload.ts`、托盘、开机自启、更新和密钥存储适配。`preload.ts` 是当前实际文件，不存在虚构的 `electron/` 或 `preload/` 目录。当前没有独立的无头 CLI 产品入口；服务核心仍由 `source/server/` 提供给 Electron 与测试使用。

### 5. 渲染进程（`source/render/`）

React 18 + TypeScript + shadcn/ui + Tailwind。渲染层通过 `source/render/source/api/*.ts` 调用管理 API，按 `features/*` 和页面 hooks 组织领域状态；`infrastructure/polling-manager.ts` 提供共享轮询能力，`store/create-store.ts` 提供轻量外部 store 基础设施。当前没有单体 `app-service` 或 API 聚合出口。

- **概览页**：服务状态、今日统计、供应商健康卡片
- **供应商页**：列表、增删改查、测试连接、健康状态
- **模型路由页**：Provider 模型列表、端点管理、拖拽排序
- **请求日志页**：列表、筛选、详情（尝试过程时间线）
- **请求内容查看器**：使用 Drawer 或 Dialog 查看完整请求/响应，协议转换时展示转换前后内容
- **设置页**：端口、开机自启、访问 Token、日志保留条数、日志保留天数、按天立即清理、请求内容记录、导入导出、关于

## 构建与打包

### Vite

- 主进程、预加载脚本、渲染进程统一配置
- 开发时支持热重载（主进程重启、渲染进程 HMR）
- 生产构建自动打包

### electron-builder

- 打包成 macOS `.dmg` / `.app`、Windows `.exe`、Linux `.AppImage` / `.deb`
- macOS 无付费证书阶段使用显式 ad-hoc 签名；`afterPack` 必须对完整 `.app` 执行严格签名校验
- ad-hoc 签名只保证应用包内部完整性，不提供开发者身份信任，也不能提交 Apple 公证
- GitHub Release 必须附带 DMG 的 SHA-256 文件和“隐私与安全 > 仍要打开”的首次安装说明
- 未来购买 Apple Developer Program 后，替换为 Developer ID Application 签名和 Apple notarization；不得把免费 Apple Development 证书用于公网分发
- 自动更新已实现：`source/command/updater.ts` 使用 `electron-updater`，支持检查、手动下载、进度、安装和状态广播；生产环境启动后静默检查，开发环境无更新元数据时显示友好状态。

## 开发流程

以下命令与根目录 `package.json` 的 scripts 一致：

1. `pnpm dev` — 启动开发模式
2. `pnpm build` — 执行 typecheck、Vite bundling 和 electron-builder
3. `pnpm typecheck` — TypeScript 类型检查
4. `pnpm lint` — ESLint 检查
5. `pnpm test:server` — 运行 Server/Vitest 测试
6. `pnpm release:win`、`pnpm release:mac`、`pnpm release:linux` — 构建对应平台发布包

## 关键技术决策

1. **代理服务纯 Node 化**：不依赖 Electron，可独立测试、未来抽 CLI
2. **管理 API 走 HTTP**：React UI 和未来 CLI/Web 控制台复用同一套 API
3. **原生 http 不引入框架**：减少依赖、完全控制流式行为
4. **轻量外部 Store 管理共享状态**：集中缓存 Provider、健康状态、`default` 队列和设置，避免页面重复请求与轮询闪烁
5. **shadcn/ui + Tailwind**：组件按需复制、体积小、定制灵活
6. **Vite 统一构建**：一套配置管三个进程，开发体验好
