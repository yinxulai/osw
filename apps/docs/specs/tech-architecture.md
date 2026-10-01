# 技术架构与框架选型

> **状态说明：本文描述 v0.3 当前实现与明确的后续边界。** 数据库、关系模型、核心路由、请求观测、管理 API、协议适配器和渲染层分域已经落地；请求链路字段严格区分 `client*`、`upstream*` 与配置实体的 `provider*`。OpenAPI 文档与代码生成尚未接入，不作为当前实现依赖；发布包端到端验证以 `roadmap.md` 的剩余发布验收项为准。

## 整体技术栈

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| 桌面壳 | Electron | 跨平台桌面应用 |
| 构建工具 | Vite + Turborepo | 三份 Vite 配置分目标构建；turbo 统一任务编排与依赖顺序 |
| 主进程 | TypeScript + 原生 Node `http` | 独立的代理服务与管理服务，不引入 HTTP 框架 |
| 代理透传 | 原生 `http.request` + 手动 pipe | 流式可控、依赖最少 |
| Schema 定义 | Zod | 运行时类型校验、配置声明、API 请求/响应验证 |
| API 规范 | Zod Schema + 源码路由注册表 | 当前管理契约由 `packages/contracts/source/schemas.ts` 与 `packages/core/source/management/router.ts` 实现；OpenAPI 尚未接入 |
| 代码生成 | 未使用 | 控制台 API client 为 `packages/console/source/api/client.ts` 中的手写轻量 fetch 封装 |
| 本地存储 | SQLite（`node:sqlite` + Drizzle ORM）+ 系统密钥环 | 配置和日志存 SQLite，密钥存 keychain |
| 数据库迁移 | 单一首发基线 + 发布后版本迁移 | 首发结构干净，发布后升级可追踪 |
| 渲染进程 | React 18 + TypeScript | 控制台 UI |
| UI 组件 | shadcn/ui + Tailwind CSS | 现代、可定制、体积小 |
| 状态管理 | 轻量外部 Store + React hooks | 共享应用状态、缓存和轮询 |

## 关键技术决策

### 为什么不用 HTTP 框架

代理服务和管理服务各自使用一个原生 `http.createServer` 实例，不引入 Hono/Fastify/Express：

- 管理 API 端点不多（配置 CRUD、日志、健康状态、路由工作台、重写规则），原生路由足够
- 代理透传层需要完全掌控请求/响应流，框架反而增加抽象成本
- 两个监听器共享应用级数据库和密钥存储，但生命周期独立；停止或重启代理不会中断管理 API
- 减少依赖，降低打包体积和安全面
- 代理服务是纯 Node 模块，Electron 只是宿主，未来可抽 CLI / 无头模式（规划见 [packaging.md](./packaging.md)）
### 为什么用 Zod 做 Schema

- **单一真相源**：配置模型、API 请求/响应、数据库行都用 Zod schema 定义，TypeScript 类型从中推导
- **运行时校验**：管理 API 的入参出参、供应商包导入导出、数据库读写都在边界处校验，保证数据一致性
- **边界明确**：当前使用 Zod 做运行时校验和共享契约；未来若接入 OpenAPI，必须以现有 Schema/路由为基础，不能反向虚构已生成的类型或接口文件
- **零依赖膨胀**：Zod 体积小，不引入额外运行时

### 为什么用统一 POST 风格 API

管理 API 全部使用 POST 方法，路径格式为 `/api/资源/动作`，不依赖 HTTP 方法和状态码语义。以下是当前契约，不提供兼容别名；实际注册路由以 `packages/core/source/management/router.ts` 为准：

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
- **单文件部署**：SQLite 是单个文件，和 JSON 一样便携，备份/供应商包导入导出都方便
- **Drizzle ORM**：提供类型安全的同步数据访问，SQLite 查询集中在 database store 边界；基于 Node 22.5+ 内置 `node:sqlite`，零原生依赖、无 ABI 问题

## 项目结构

```
osw/
├── package.json                         # 工作区根：脚本入口 + 全部运行期依赖
├── pnpm-workspace.yaml
├── turbo.json                           # 任务编排与依赖顺序（build / typecheck / lint / test / dev）
├── tsconfig.json / tsconfig.base.json   # 共享编译选项：各包 extends 前者，后者供构建期使用
├── eslint.config.js                     # 分层守卫与包边界守卫经 packages/toolkit 挂在 pnpm lint 上（vitest 与 tsc 的配置住在 packages/toolkit）
├── docs/                                # 文档：上游协议参考 + 产品规格
│   ├── references/                      # 三家上游 API 的逐字快照
│   └── product/                         # 产品规格文档
├── packages/                            # 工作区内部包：可被第三方消费的库 + 开发工具
│   ├── contracts/                       # 共享契约：Zod schema、协议表、i18n 目录、宿主接口
│   │   └── source/
│   │       ├── schemas.ts
│   │       ├── protocols.ts
│   │       ├── keychain.ts
│   │       ├── runtime-profile.ts
│   │       ├── i18n/                    # i18n 核心与语言目录，见 i18n.md
│   │       └── router/                  # 路由契约类型、预设与规则表引擎
│   │
│   ├── core/                            # 核心主体：runtime + management + proxy + database
│   │   ├── drizzle/                     # 迁移基线（随包分发，打包时映射进 asar）
│   │   ├── drizzle.config.ts
│   │   ├── scripts/                     # db.mjs、check-proxy-layers.mjs
│   │   └── source/
│   │       ├── index.ts                 # 外部生命周期入口
│   │       ├── runtime/server-runtime.ts # ServerRuntime 启动/停止编排
│   │       ├── management/              # 管理 HTTP 服务，routes/ 下按域分组注册
│   │       ├── proxy/                   # 分层代理链路，见 proxy-engine.md
│   │       ├── database/                # SQLite + Drizzle 持久化层及按领域拆分的 *-store.ts
│   │       ├── infrastructure/secrets/  # 系统密钥环适配
│   │       └── security/                # Host validation
│   │
│   ├── console/                         # React 控制台，构建为静态产物
│   │   ├── index.html
│   │   ├── vite.config.ts               # 渲染层构建（固定端口 5173，strictPort）
│   │   ├── components.json / public/    # shadcn 配置与静态资源
│   │   ├── scripts/                     # i18n 硬编码门禁插件、vitest setup
│   │   └── source/
│   │       ├── api/                     # client.ts + 按领域 API modules
│   │       ├── features/                # Provider、Proxy、Health、Settings、Logical Models
│   │       ├── infrastructure/          # polling-manager、deep-equal
│   │       ├── store/                   # create-store
│   │       ├── components/              # shadcn/ui 组件 + 业务组件
│   │       ├── pages/                   # 按页面目录组织的 page、service、hooks
│   │       ├── providers/               # 供应商定义（provider.json + 图标）
│   │       └── services/                # 通用 use-async
│   │
│   └── toolkit/                         # 跨包开发脚本：任务编排、版本写入与校验、包边界守卫、脚本运行库
│       ├── tsconfig.check.json          # 覆盖全部包的一份类型检查程序（由 scripts/typecheck.mjs 调用）
│       ├── vitest.config.ts             # 单一测试配置，按包过滤（由 scripts/test.mjs 调用）
│       └── scripts/                     # lint / test / typecheck / version / 包边界守卫 / lib
│
├── apps/                                # 宿主壳，不作为库发布
│   ├── app/                             # Electron 主进程、预加载与服务进程
│   │   ├── vite.config.ts               # 主进程构建（ESM）
│   │   ├── vite.preload.config.ts       # preload 构建（CJS，必须与主进程分成两次构建）
│   │   ├── vite.server.config.ts        # 服务进程构建（ESM，utilityProcess 入口）
│   │   ├── vite.shared.ts               # 三个入口共用的别名、Node 外部化与 target
│   │   ├── electron-builder.config.cjs  # 打包配置
│   │   ├── build/                       # 应用图标与托盘图标
│   │   ├── scripts/                     # build.mjs、dev.mjs、release-notes.mjs、macos-adhoc-sign.cjs
│   │   ├── output/command/              # 构建产物：index.js（主进程）+ preload.js + service-main.mjs（服务进程）
│   │   └── source/
│   │       ├── index.ts                 # Electron 应用编排
│   │       ├── preload.ts               # 暴露最小化 API 给渲染进程
│   │       ├── server-host.ts           # 服务进程的宿主侧遥控器（fork/重启/停机/设置广播）
│   │       ├── service.ts               # 服务进程的构建入口（转出 core 的 service-main）
│   │       ├── auto-launch.ts           # 开机自启
│   │       ├── tray-manager.ts          # 菜单栏/托盘管理
│   │       ├── updater.ts               # 自动更新
│   │       ├── i18n.ts                  # 原生界面语言
│   │       └── secret-store.ts          # 系统密钥环封装
│   │
│   └── cli/                             # 命令行宿主（`osw`）
│       ├── vite.config.ts               # ESM 构建（自带外部化 / platform / define）
│       ├── scripts/                     # build.mjs、smoke.mjs
│       ├── output/                      # 构建产物：index.js + web/（控制台）+ 按需分块
│       └── source/                      # index.ts（分发与退出码）、options.ts、宿主适配与 commands/
│
└── release/                             # 打包产物
```

包边界、每包构建产物、目录归属与阶段划分见 [packaging.md](./packaging.md)。目录名统一用 `source/`；根目录只留工作区级配置；脚本按业务归入各包 `scripts/`（跨包的收在 `packages/toolkit/scripts/`）；turbo 接管任务编排；三份 Vite 配置各自构建一个目标（控制台 / 主进程 / preload）；导入别名沿用旧名（`@common` / `@server` / `@`）但重指向新位置。

## 模块地图

模块职责只在这里定位，细节各有权威文档，不再逐文件重述：

| 模块 | 职责 | 权威文档 |
| --- | --- | --- |
| `packages/core/source/runtime` | 进程级组装与生命周期：启动/停止 management 与 proxy，失败回滚 | [server-architecture.md](./server-architecture.md) |
| `packages/core/source/management` | 配置管理与管理 API（含路由工作台、重写规则、诊断） | [server-architecture.md](./server-architecture.md) |
| `packages/core/source/proxy` | 代理请求链路：入口、路由、规划、执行、协议、修饰、观测 | [proxy-engine.md](./proxy-engine.md) |
| `packages/core/source/database` | SQLite + Drizzle 持久化层与按域拆分的 `*-store.ts` | [data-model.md](./data-model.md) |
| `packages/core/source/infrastructure`、`packages/core/source/security` | 密钥环适配、Host 校验 | [security-privacy.md](./security-privacy.md) |
| `packages/contracts/source` | 全形态共享契约（Zod schema、协议表、路由类型、i18n 核心与语言目录） | 各自主题文档、[i18n.md](./i18n.md) |
| `apps/app/source` | Electron 主进程：窗口、托盘、开机自启、自动更新、密钥存储 | [desktop.md](./desktop.md) |
| `packages/console/source` | React 控制台 | [desktop.md](./desktop.md) |

代理服务与管理服务是两个独立监听器：代理可单独停止、重启而不影响管理服务，两者都由 `ServerRuntime` 持有。协议范围以 `packages/contracts/source/protocols.ts` 为准，当前不支持 Gemini 或 Custom 协议。

### 管理 API 契约

管理 API 挂在独立管理服务的 `/api` 前缀（默认 `127.0.0.1:9301`），React UI 与未来的 CLI 复用同一套接口。

设计原则：

- 统一 `POST`，不依赖 HTTP 方法语义；路径格式为 `/api/资源/动作`
- HTTP 状态码始终 200，业务结果由 body 表达

```ts
// 成功
{ success: true, data: { ... } }

// 失败
{ success: false, errorCode: "PROVIDER_NOT_FOUND", errorMessage: "供应商不存在" }
```

接口清单不在文档里维护，按域查阅 `packages/core/source/management/router.ts` 与 `management/routes/`：

| 域 | 源码位置 |
| --- | --- |
| Provider / ProviderModel / 端点 / 调度关系 | `management/routes/catalog/` |
| ProviderModel 绑定关系、请求重写规则 | `management/routes/relations/` |
| 设置、代理生命周期、开发种子 | `management/routes/operations/` |
| 运行日志、请求日志、统计分析 | `management/routes/observability/` |
| 路由工作台（策略图与试跑） | `management/routes/router/` |
| 模型测试、协议发现、出站代理测试 | `management/routes/diagnostics/` |
| 供应商包导入导出 | `management/provider-transfer/` |

所有路由由同一个注册表合并，不提供兼容别名。

### 数据存储

SQLite（`node:sqlite` + Drizzle ORM）承载配置与日志，表结构与字段定义见 [data-model.md](./data-model.md)。**两个数据库文件互不相干**：

| 文件 | 角色 | Drizzle 定义 | 迁移链 |
| --- | --- | --- | --- |
| `config-<n>.db` | 用户配置（12 张表） | `packages/core/source/database/config-schema.ts` | `packages/core/drizzle/config/` |
| `data-<n>.db` | 系统观测数据（10 张表） | `packages/core/source/database/data-schema.ts` | `packages/core/drizzle/data/` |

拆分的理由与两条边界见 [data-model.md](./data-model.md) §2.1；文件名里的版本号是两个**独立的 schema 版本**常量，不住在应用版本号上。

- 首发基线：两条链各自只保留一份由 schema 直接生成的首发基线迁移与快照，`pnpm db:generate` 按角色各生成一次（drizzle-kit 一份配置只能喂一条链，所以是两份 `drizzle.config.<role>.ts`）
- 基线随 `@osw/core` 包分发：开发期从模块目录逐级上溯找到 `packages/core/drizzle`，再按角色下钻一层；打包后则命中与入口同层的那份映射（`app.asar/output/command/` 上溯两层就是 asar 根），不存在第二套深度
- 链上只有那条基线，不保留增量迁移：改结构 = 改 schema + 就地把基线重新生成一遍，目录名沿用原来那一个（运行时迁移器按目录名判定是否已应用，改名会被当成新迁移重放）
- 换代（把 `DATABASE_SCHEMA_VERSIONS` 加一并换文件名）只发生在应用大版本发布时，用来甩掉磁盘上的旧文件；它与「本次改了多少结构」无关，日常结构变化不换文件名
- 库边界由 `packages/core/scripts/check-database-boundaries.mjs` 在 `pnpm lint` 中强制：每个 store 只碰自己那个库，两份 schema 不互相引用
- API Key 等敏感信息存在系统密钥环中，数据库只存引用 ID

### 运行环境与 profile

开发版与正式版通过 `packages/contracts/source/runtime-profile.ts` 的显式 profile 区分，profile 统一定义应用数据目录、代理端口、管理端口与管理 API 地址，各宿主（Electron 主进程、服务端、控制台）共用同一配置源。

| profile | 数据目录 | 代理端口 / 管理端口 |
| --- | --- | --- |
| 开发 | `~/.osw-development` | 19300 / 19301 |
| 正式 | `~/.osw` | 9300 / 9301 |

数据库文件、密钥文件与监听端口三者完整隔离。命令行形态也走同一份 profile：数据目录名一律取自 `dataDirectoryName`，命令行恒定跑正式档（见 [packaging.md](./packaging.md) §5.5）。

### 渲染进程

React 18 + TypeScript + shadcn/ui + Tailwind。页面通过 `packages/console/source/api/*.ts` 调用管理 API，领域状态按 `features/*` 与页面 hooks 组织，`infrastructure/polling-manager.ts` 提供共享轮询，`store/create-store.ts` 提供轻量外部 store。

侧边栏分组与页面清单以 `packages/console/source/components/app-sidebar.tsx` 为准，各页面职责见 [desktop.md](./desktop.md) 的控制台页面表。

## 构建与打包

包拆分后的交付形态与每包构建产物见 [packaging.md](./packaging.md)「交付形态」「构建与测试编排」。渲染进程与宿主是两套独立构建：控制台由 `packages/console/vite.config.ts` 构建为静态产物，Electron 主进程、preload 与服务进程由 `apps/app/` 下的三份配置分别构建；宿主不再内联渲染层构建。

### Vite

- 控制台：`packages/console/vite.config.ts`，输出 `packages/console/output/`，dev server 固定 `127.0.0.1:5173`
- 主进程（ESM）：`apps/app/vite.config.ts`，输出 `apps/app/output/command/index.js`
- preload（CJS）：`apps/app/vite.preload.config.ts`，输出 `apps/app/output/command/preload.js`；必须与主进程分成两次构建，因为 Vite 一份配置只能产出一个格式
- 服务进程（ESM）：`apps/app/vite.server.config.ts`，输出 `apps/app/output/command/service-main.mjs`（外加按 hash 命名的共享 chunk）；它必须是**独立的一次构建**，因为主进程与服务进程的外部化边界不同：`node:sqlite` 允许进服务进程的 chunk 图，却**不得**被拉进主进程
- 三份配置共用 `apps/app/vite.shared.ts` 里的别名、Node 内置模块外部化与 `target: node22`
- 开发时 `pnpm dev` 由 turbo 启动各包 `dev` 任务，宿主侧的实际编排在 `apps/app/scripts/dev.mjs`：先等控制台 dev server 起来，再起三份 `vite build --watch`，等首轮构建落定后拉起 Electron，之后监听产物目录做整应用重启；渲染层热更新由 Vite HMR 提供
- 生产构建由 Vite 直接产出静态产物，不再依赖开发期插件

### electron-builder

- 打包成 macOS `.dmg` / `.app`、Windows `.exe`、Linux `.AppImage` / `.deb`
- 所有东西都在 `app.asar` 一个文件里：`output/command/` 的 `index.js`、`preload.js`、`service-main.mjs` 与全部 chunk，`output/render/`，以及迁移基线 `packages/core/drizzle`。`node_modules` 被 `files` 里的 `!node_modules` 排除（里面只有 `@osw/*` 的 TS 源码与测试，运行时无人引用），细节与坑见 [packaging.md](./packaging.md) §5.7
- macOS 无付费证书阶段使用显式 ad-hoc 签名；`afterPack` 必须对完整 `.app` 执行严格签名校验
- ad-hoc 签名只保证应用包内部完整性，不提供开发者身份信任，也不能提交 Apple 公证
- GitHub Release 必须附带 DMG 的 SHA-256 文件和“隐私与安全 > 仍要打开”的首次安装说明
- 未来购买 Apple Developer Program 后，替换为 Developer ID Application 签名和 Apple notarization；不得把免费 Apple Development 证书用于公网分发
- 自动更新已实现：`apps/app/source/updater.ts` 使用 `electron-updater`，支持检查、手动下载、进度、安装和状态广播；生产环境启动后静默检查，开发环境无更新元数据时显示友好状态
- 平台差异只有两处，`updater.ts` 里不该再有第三处平台判断：Windows / Linux 走完整链路（下载 → 点击安装，未点安装时由 `autoInstallOnAppQuit` 在退出时安装）；macOS 因 ad-hoc 签名不被 Squirrel.Mac 接受，只保留「检查 → 前往对应的 DMG / Release 页」的手动路径
- `downloadUpdate()` 返回 `'download-complete' | 'manual-download' | 'downloading' | 'failed'` 而不是布尔值：macOS 打开下载页是「按预期做完」，不能和「下载失败」共用 `false`，否则界面会弹出假报错
- 跨应用大版本（`isMajorUpgrade`：大版本号不同）**只能手动更新**：`downloadUpdate()` 直接返回 `'manual-download'`，`installUpdate()` 也走发布页而不是 `quitAndInstall`；界面把按钮换成「前往下载新版本」并给出一行说明。理由是大版本变更必然伴随破坏性换代（数据库 schema 代次加一，旧库不再被读），自动装上去等于在用户毫无准备时把配置甩在一张空表旁边。版本号解析不出来时保守按「跨大版本」处理
- 跨大版本的手动路径与 macOS 的手动路径共用同一个返回值，但两者不可能同时成立：`resolveManualInstallReason()` 把「为什么转去发布页」拆成 `manual-macos-install` / `major-version-manual-update` / `update-not-downloaded`，日志里能直接分辨是哪一种
- 同一平台的更新元数据里有多个文件（Windows 的 fat exe / x64 / arm64、macOS 的 zip / DMG），`preferredAsset` 按当前 `process.platform` 与 `process.arch` 挑出该下的那个，不能直接取 `files[0]`
- 下载完整性依赖更新元数据中的 SHA-512。`verifyUpdateCodeSignature` 只对 Windows 的 `NsisUpdater` 生效，不要在 `initialize()` 里无条件设为 `false`：它既是空操作，又会让人误以为 macOS 的校验已被关掉。启用正式 Developer ID 签名与 Apple notarization 后才谈恢复 macOS 的自动安装。

## 开发流程

以下命令与根目录 `package.json` 的 scripts 一致，实现落在各包 `scripts/`（跨包编排在 `packages/toolkit/scripts/`）：

1. `pnpm dev` — 启动开发会话（turbo 并行跑 `dev` 任务，实际编排在 `apps/app/scripts/dev.mjs`）
2. `pnpm build` — 按 turbo 任务图依次构建 `contracts` → `core` → `console` / `app`
3. `pnpm typecheck` — TypeScript 类型检查
4. `pnpm lint` — ESLint 检查（含代理分层与包边界守卫）
5. `pnpm test:server` — 运行 Server/Vitest 测试
6. `pnpm release:win`、`pnpm release:mac`、`pnpm release:linux` — 构建对应平台发布包

## 决策回顾

1. **代理服务纯 Node 化**：不依赖 Electron，可独立测试、未来抽 CLI
2. **管理 API 走 HTTP**：React UI 和未来 CLI/Web 控制台复用同一套 API
3. **原生 http 不引入框架**：减少依赖、完全控制流式行为
4. **轻量外部 Store 管理共享状态**：集中缓存 Provider、健康状态、`default` 逻辑模型和设置，避免页面重复请求与轮询闪烁
5. **shadcn/ui + Tailwind**：组件按需复制、体积小、定制灵活
6. **Vite 按目标分构建**：控制台、主进程、preload 各一份配置，各自只解决一个问题
