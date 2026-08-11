# 技术架构与框架选型

## 整体技术栈

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| 桌面壳 | Electron | 跨平台桌面应用 |
| 构建工具 | electron-vite | 主进程 / 预加载 / 渲染进程统一构建 |
| 主进程 | TypeScript + 原生 Node `http` | 代理服务 + 管理 API，不引入 HTTP 框架 |
| 代理透传 | 原生 `http.request` + 手动 pipe | 流式可控、依赖最少 |
| Schema 定义 | Zod | 运行时类型校验、配置声明、API 请求/响应验证 |
| API 规范 | OpenAPI 3.1 | 管理接口正式定义，作为前后端契约 |
| 代码生成 | openapi-typescript + @tanstack/react-query 生成 | 从 OpenAPI 生成类型和 API 调用端代码 |
| 本地存储 | SQLite（better-sqlite3）+ 系统密钥环 | 配置和日志存 SQLite，密钥存 keychain |
| 数据库迁移 | 手写 SQL + 版本号管理 | 轻量迁移，不引入 ORM |
| 渲染进程 | React 18 + TypeScript | 控制台 UI |
| UI 组件 | shadcn/ui + Tailwind CSS | 现代、可定制、体积小 |
| 状态管理 | TanStack Query | 服务端状态，配合 HTTP API 模式 |

## 关键技术决策

### 为什么不用 HTTP 框架

代理服务和管理 API 共用同一个原生 `http.createServer` 实例，不引入 Hono/Fastify/Express：

- 管理 API 端点不多（配置 CRUD、日志、健康状态，约十几个接口），原生路由足够
- 代理透传层需要完全掌控请求/响应流，框架反而增加抽象成本
- 减少依赖，降低打包体积和安全面
- 代理服务是纯 Node 模块，Electron 只是宿主，未来可抽 CLI / 无头模式

### 为什么用 Zod 做 Schema

- **单一真相源**：配置模型、API 请求/响应、数据库行都用 Zod schema 定义，TypeScript 类型从中推导
- **运行时校验**：管理 API 的入参出参、配置导入导出、数据库读写都在边界处校验，保证数据一致性
- **生态兼容**：OpenAPI 生成的类型可以和 Zod 配合使用，或通过 zod 生成 OpenAPI
- **零依赖膨胀**：Zod 体积小，不引入额外运行时

### 为什么用 OpenAPI 定义管理接口

- **接口契约**：前后端通过 OpenAPI 文档对齐，避免手写类型不一致
- **代码生成**：用 `openapi-typescript` 生成 TypeScript 类型，用 `openapi-typescript-codegen` 或自定义生成器生成 API client 和 TanStack Query hooks
- **文档即测试**：服务端用 Zod 校验请求/响应，确保与 OpenAPI 定义一致
- **未来扩展**：后续加 CLI、Web 控制台、第三方集成都可以直接复用 OpenAPI 定义

### 为什么用 SQLite 替代 JSON/JSONL

- **查询能力**：日志筛选、分页、统计用 SQL 比遍历 JSONL 高效得多
- **事务一致性**：配置变更（如删除 Provider 级联删除绑定）用事务保证原子性
- **迁移可控**：数据库版本号 + 迁移脚本，比 JSON 配置版本迁移更规范
- **单文件部署**：SQLite 是单个文件，和 JSON 一样便携，备份/导入导出都方便
- **better-sqlite3**：同步 API，性能好，和 Electron 主进程配合简单

## 项目结构

```
one-switch/
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
├── specs/                          # 产品规格文档
├── source/
│   ├── server/                     # 核心主体：Electron 主进程 + 代理服务 + 管理 API + 存储
│   │   ├── index.ts                # 主入口：Electron 应用生命周期 + 启动代理服务
│   │   ├── electron/               # Electron 宿主相关
│   │   │   ├── tray.ts             # 菜单栏/托盘管理
│   │   │   ├── window.ts           # 控制台窗口管理
│   │   │   ├── autostart.ts        # 开机自启
│   │   │   └── secrets.ts          # 系统密钥环封装（safeStorage / keytar）
│   │   ├── preload/                # 预加载脚本
│   │   │   └── index.ts            # 暴露最小化 API 给渲染进程（如窗口控制）
│   │   ├── proxy/                  # 代理透传层
│   │   │   ├── protocol.ts         # 协议识别规则（path → protocol）
│   │   │   ├── router.ts           # 路由引擎：模型匹配、绑定选择、切换逻辑
│   │   │   ├── transport.ts        # 上游透传：http.request、pipe、超时、错误分类
│   │   │   ├── stream-switch.ts    # 流式切换边界控制
│   │   │   ├── models-api.ts       # /v1/models 本地接口
│   │   │   └── health.ts           # Provider 健康状态与冷却
│   │   ├── api/                    # 管理 API（挂载到 /api 前缀）
│   │   │   ├── index.ts            # API 路由分发
│   │   │   ├── providers.ts        # Provider CRUD
│   │   │   ├── models.ts           # 逻辑模型与绑定 CRUD
│   │   │   ├── logs.ts             # 请求日志查询
│   │   │   ├── health.ts           # 健康状态查询
│   │   │   └── settings.ts         # 服务设置
│   │   └── db/                     # SQLite 数据存储
│   │       ├── index.ts            # 数据库连接初始化
│   │       ├── schema.ts           # Zod schema 定义（配置模型、API 类型）
│   │       ├── providers.ts        # Provider 数据访问
│   │       ├── models.ts           # 逻辑模型与绑定数据访问
│   │       ├── logs.ts             # 请求日志数据访问
│   │       ├── settings.ts         # 服务设置数据访问
│   │       └── migrations/         # 数据库迁移脚本
│   │           └── 001_init.sql    # 初始建表
│   │
│   ├── command/                    # CLI 入口（与 render 平级，同为入口点）
│   │   └── index.ts                # 命令行模式入口：无头启动代理服务
│   │
│   ├── common/                     # server / command / render 共享
│   │   ├── openapi.yaml            # OpenAPI 3.1 规范：管理接口定义
│   │   ├── schema.ts               # Zod schema（可被 server 和 command 引用）
│   │   ├── types.ts                # 从 Zod 推导的类型定义 / 共享类型
│   │   ├── constants.ts            # 常量：默认端口、协议列表、错误类型等
│   │   └── utils.ts                # 通用工具函数
│   │
│   └── render/                     # UI 入口：React 渲染进程
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       ├── lib/                    # 工具、API client
│       │   ├── api.ts              # TanStack Query 封装的 API 调用
│       │   └── utils.ts
│       ├── components/             # shadcn/ui 组件 + 业务组件
│       │   └── ui/                 # shadcn/ui 生成的组件
│       ├── pages/                  # 控制台页面
│       │   ├── overview.tsx        # 概览
│       │   ├── providers.tsx       # 供应商管理
│       │   ├── models.tsx          # 模型路由
│       │   ├── logs.tsx            # 请求日志
│       │   └── settings.tsx        # 设置
│       ├── hooks/                  # 自定义 hooks
│       └── styles/                 # 全局样式
│
└── resources/                      # 静态资源：图标、托盘图标等
```

## 核心模块设计

### 1. 核心服务（`source/server/`）

核心主体，包含 Electron 主进程和代理服务。代理核心逻辑（proxy/api/store）不依赖 Electron，可被 CLI 入口直接引用。

**`index.ts`** — 主入口（Electron 主进程）
- 应用生命周期管理
- 创建托盘、窗口
- 启动代理服务
- 统一错误处理

**`electron/`** — Electron 宿主
- `tray.ts`：菜单栏/托盘管理
- `window.ts`：控制台窗口管理
- `autostart.ts`：开机自启
- `secrets.ts`：系统密钥环封装

**`preload/`** — 预加载脚本
- 暴露最小化 API 给渲染进程（窗口控制等）

**`proxy/`** — 代理透传层（纯 Node，无 Electron 依赖）

**`proxy/protocol.ts`** — 协议识别
- 内置规则表：path pattern → protocol
- 每个协议有默认的认证方式（OpenAI 用 Bearer、Anthropic 用 `x-api-key` header、Gemini 用 query 参数）
- 支持 custom 协议的用户自定义规则
- 提供 `detectProtocol(path): Protocol | null`

**`proxy/router.ts`** — 路由引擎
- 输入：protocol + modelName
- 输出：候选绑定列表（按优先级排序，过滤禁用/冷却/额度耗尽）
- 切换时取下一个绑定
- 处理"模型在该协议下无绑定自动绕过"逻辑

**`proxy/transport.ts`** — 上游透传
- 封装 `http.request` / `https.request`
- 根据协议默认认证方式注入认证头
- 超时控制（连接超时 + 响应头超时）
- 错误分类：network / timeout / 4xx / 5xx
- 返回 `Attempt` 结果

**`proxy/stream-switch.ts`** — 流式切换边界
- 跟踪响应头是否已发出
- 响应头发出前：失败可切换
- 响应头发出后：失败不切换，直接透传错误
- 管理客户端响应流的写入时机

**`proxy/health.ts`** — 健康状态与冷却
- 维护每个 Provider 的连续失败计数、冷却截止时间
- 成功/失败回调更新状态
- 提供 `isAvailable(providerId): boolean`

**`proxy/models-api.ts`** — `/v1/models` 本地接口

### 2. 管理 API（`source/server/api/`）

RESTful API，挂载到 `/api` 前缀。React UI 通过 TanStack Query 调用。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 服务健康状态 |
| GET | `/api/settings` | 获取服务设置 |
| PUT | `/api/settings` | 更新服务设置 |
| GET | `/api/providers` | Provider 列表 |
| POST | `/api/providers` | 新增 Provider |
| GET | `/api/providers/:id` | Provider 详情 |
| PUT | `/api/providers/:id` | 更新 Provider |
| DELETE | `/api/providers/:id` | 删除 Provider |
| POST | `/api/providers/:id/test` | 测试连接 |
| GET | `/api/providers/:id/health` | Provider 健康状态 |
| GET | `/api/models` | 逻辑模型列表（含绑定） |
| POST | `/api/models` | 新增逻辑模型 |
| PUT | `/api/models/:id` | 更新逻辑模型 |
| DELETE | `/api/models/:id` | 删除逻辑模型 |
| POST | `/api/models/:id/bindings` | 新增模型绑定 |
| PUT | `/api/models/:modelId/bindings/:bindingId` | 更新模型绑定 |
| DELETE | `/api/models/:modelId/bindings/:bindingId` | 删除模型绑定 |
| PATCH | `/api/models/:modelId/bindings/order` | 调整绑定优先级 |
| GET | `/api/logs` | 请求日志列表（分页、筛选） |
| GET | `/api/logs/:id` | 请求日志详情（含所有 attempt） |
| POST | `/api/config/export` | 导出配置（脱敏） |
| POST | `/api/config/import` | 导入配置 |

### 3. 数据存储（`source/server/db/`）

使用 SQLite（better-sqlite3），配置和日志都存在本地数据库文件中。

**`index.ts`** — 数据库连接
- 初始化数据库连接
- 执行迁移
- 提供数据库实例

**`schema.ts`** — Zod Schema
- Provider、LogicalModel、ModelBinding、Settings、RequestLog、Attempt 等模型的 Zod 定义
- API 请求/响应的 Zod schema（与 OpenAPI 定义保持一致）
- 类型从 Zod schema 推导，不重复手写 interface

**数据访问层** — 按领域分文件
- `providers.ts`：Provider CRUD、健康状态读写
- `models.ts`：逻辑模型与绑定 CRUD、级联操作
- `logs.ts`：请求日志写入、分页查询、筛选
- `settings.ts`：服务设置读写

**`migrations/`** — 数据库迁移
- 纯 SQL 脚本，按序号命名（`001_init.sql`、`002_add_xxx.sql`）
- `_schema_version` 表记录当前版本
- 启动时自动执行未应用的迁移

> API Key 等敏感信息仍存储在系统密钥环中，数据库仅存引用 ID。

### 4. CLI 入口（`source/command/`）

与 render 平级的入口点，提供无头命令行模式：
- 直接引用 `source/server/` 中的代理服务核心
- 不启动 Electron，只运行 HTTP 代理服务
- 支持命令行参数（端口、配置路径等）
- 未来可扩展为独立 CLI 工具

### 5. 渲染进程（`source/render/`）

React + TypeScript + shadcn/ui + Tailwind + TanStack Query

API 调用端代码从 `source/common/openapi.yaml` 生成：
- `openapi-typescript` 生成 TypeScript 类型
- 生成 TanStack Query hooks（或基于 fetch 的 API client）
- 保证前后端类型一致，减少手动维护成本

- **概览页**：服务状态、今日统计、供应商健康卡片
- **供应商页**：列表、增删改查、测试连接、健康状态
- **模型路由页**：逻辑模型列表、绑定管理、拖拽排序
- **请求日志页**：列表、筛选、详情（尝试过程时间线）
- **设置页**：端口、开机自启、访问 Token、日志保留、导入导出、关于

## 构建与打包

### electron-vite

- 主进程、预加载脚本、渲染进程统一配置
- 开发时支持热重载（主进程重启、渲染进程 HMR）
- 生产构建自动打包

### electron-builder

- 打包成 macOS `.dmg` / `.app`、Windows `.exe`、Linux `.AppImage` / `.deb`
- 代码签名（后续配置）
- 自动更新（P2 考虑）

## 开发流程

1. `npm run dev` — 启动 electron-vite 开发模式，主进程和渲染进程热重载
2. `npm run build` — 构建主进程、预加载、渲染进程
3. `npm run package` — 打包当前平台安装包
4. `npm run test` — 运行单元测试（代理核心逻辑、配置迁移等）

## 关键技术决策

1. **代理服务纯 Node 化**：不依赖 Electron，可独立测试、未来抽 CLI
2. **管理 API 走 HTTP**：React UI 和未来 CLI/Web 控制台复用同一套 API
3. **原生 http 不引入框架**：减少依赖、完全控制流式行为
4. **TanStack Query 管理服务端状态**：配合 HTTP API 模式，缓存、重试、乐观更新开箱即用
5. **shadcn/ui + Tailwind**：组件按需复制、体积小、定制灵活
6. **electron-vite 统一构建**：一套配置管三个进程，开发体验好
