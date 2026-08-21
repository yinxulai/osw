# v0.3 实施推进计划

## 1. 文档目的

本文将 v0.3 spec 拆解为可执行的阶段目标、交付物和验收门槛，用于指导源码重构和版本发布。

v0.3 是一次全新的大版本迭代，不以兼容旧源码、旧 API、旧配置或旧数据库为目标。实施过程中允许直接删除旧领域模型和旧迁移逻辑；遇到旧数据库时，应用应要求用户重新初始化，而不是隐式迁移。

当前状态：规格设计已定稿，源码正在 `main` 上按全新、不兼容的 v0.3 契约实施。数据库基线、公共 Schema、Store、关系模型管理、核心路由、请求观测和管理界面已经完成；当前主要收尾代理适配器边界和正式发布包端到端验证。

## 2. 总体目标

v0.3 MVP 完成后必须具备：

- 全新的 16 张关系型核心表；
- 唯一逻辑模型 `default`；
- `scheduling_policies` 作为 LogicalModel 与 ProviderModel 的绑定表；
- 每个逻辑模型可以拥有独立的 ProviderModel 候选顺序；
- Provider、ProviderModel、端点绑定和协议转换器分层建模；
- 按当前逻辑模型绑定关系进行协议路由和故障切换；
- 请求日志、指标、用量、尝试和正文分层记录；
- OpenAI、Anthropic 基础协议代理能力（Gemini 暂不支持）；
- 管理 API、控制台和验收测试全部切换到新领域模型。

## 3. 实施原则

### 3.1 直接切换，不保留兼容层

以下旧内容不进入 v0.3：

- `UpstreamModel` 领域名称；
- `providers.data` 中承载标准路由字段的 JSON；
- `upstream_models.endpoints` JSON 数组；
- 旧 `/api/upstream-model/*` 路径；
- 旧数据库表和旧迁移函数；
- 双读、双写、字段别名和隐式数据迁移。

### 3.2 先稳定领域模型，再重构代理

实施顺序固定为：

```text
数据库基线
  → 公共 Schema 与 Store
  → 调度绑定与路由
  → 协议适配器与传输层
  → 请求观测分层
  → 管理 API 与控制台
  → 集成验收与发布
```

### 3.3 每个阶段必须可验证

每个阶段结束时至少执行：

- `pnpm typecheck`
- `pnpm test:server`
- `pnpm lint`

阶段验收失败时，不进入下一阶段。允许存在未修复的历史 Markdown lint，但不得引入新的源码类型错误、测试失败或数据库结构错误。

## 4. 阶段目标

## 阶段 0：冻结 v0.3 契约

### 阶段 0 目标

将 spec 中的实体、字段、关系和统计口径冻结为实施契约。

### 阶段 0 工作项

- 确认 `ProviderModel` 替代 `UpstreamModel`；
- 确认唯一 MVP 逻辑模型为 `default`；
- 确认 `scheduling_policies` 是 LogicalModel-ProviderModel 绑定表；
- 确认 `priority`、`weight`、绑定启用状态属于绑定关系；
- 确认 16 张表、索引、外键、软删除和历史快照字段；
- 确认旧数据库直接废弃，不执行兼容迁移；
- 确认 request-level 与 attempt-level usage 的统计口径。

### 阶段 0 交付目标

- `specs/data-model.md`、`specs/proxy.md`、`specs/observability.md` 和 `specs/tech-architecture.md` 对上述语义无冲突；
- 新旧实体和旧 API 的删除边界明确；
- 形成一份可供 Schema 和测试直接实现的字段清单。

### 阶段 0 验收门槛

未解决的领域模型冲突不得进入阶段 1。

## 阶段 1：建立全新数据库基线

### 阶段 1 目标

让全新数据库一次初始化出 v0.3 规定的 16 张表，不依赖旧数据库结构。

### 阶段 1 工作项

- 重写 `source/server/database/schema.ts`；
- 重写 `source/server/database/index.ts` 初始化逻辑；
- 删除旧 `upstream_models` 和旧兼容迁移函数；
- 创建 `settings`、Provider、端点、模型、绑定、观测相关全部表；
- 幂等初始化 `logical_models.default`；
- 补充唯一约束、CHECK 约束、索引和软删除规则；
- 为 Provider 和 ProviderModel 初始化健康状态行。

### 阶段 1 交付目标（详细）

- 全新数据库包含 16 张目标表；
- `default` 可重复初始化且不会产生重复记录；
- 同一 ProviderModel 在同一 LogicalModel 下不能重复绑定；
- ProviderModel 不再保存全局调度顺序；
- 初始化不读取、不改写、不迁移旧数据库表。

### 阶段 1 交付目标

全新数据库包含 16 张目标表，`default` 初始化幂等，数据库初始化测试、外键测试和约束测试全部通过。

## 阶段 2：重建公共 Schema 与 Store

### 阶段 2 目标

建立与新关系模型一致的类型、校验和数据访问层。

### 阶段 2 工作项

- 更新 `source/common/schemas.ts`；
- 重建 `source/server/database/store.ts`；
- [x] 实现 Provider、ProviderSetting、ProviderEndpoint CRUD；
- [x] 实现 ProviderModel 和 ProviderModelEndpoint CRUD；
- [x] 实现 ProtocolConverter CRUD；
- 实现 LogicalModel 与 SchedulingPolicy 绑定管理；
- 实现 Provider 和 ProviderModel 健康状态操作；
- 实现 `listRouteCandidates(logicalModelId, clientProtocol)`。

### 阶段 2 交付目标（详细）

- 标准配置字段不再依赖 JSON；
- endpoint 不再通过 JSON 数组读写；
- 同一个 ProviderModel 可绑定多个逻辑模型并拥有不同顺序；
- 路由候选查询只返回当前逻辑模型的有效绑定；
- Store 返回值均可通过 Zod Schema 校验。

### 阶段 2 交付目标

Store 单元测试覆盖创建、更新、删除、绑定、解绑、排序和健康状态，返回值均可通过 Zod Schema 校验。

## 阶段 3：落地 `default` 兜底调度和路由

### 阶段 3 目标

让代理真正按照 LogicalModel-ProviderModel 绑定关系路由，而不是读取全局模型队列。

### 阶段 3 工作项

- [x] 重写 `source/server/proxy/router.ts`；
- [x] 更新 `source/server/proxy/server.ts` 和 handler 调用边界；
- [x] 校验请求体 `model` 必须为非空字符串，并将未匹配模型名解析到 `default`；
- [x] 按绑定行的 `priority ASC, weight DESC, createdTime ASC, providerModelId ASC` 排序；
- [x] 按客户端协议过滤原生端点和已启用转换端点；
- [x] 同时应用 Provider 和 ProviderModel 健康状态；
- [x] 将手动起始 ProviderModel 按 LogicalModel 隔离；
- [x] 补齐网络错误、401/403、429、500 与响应头前断开的 handler 级故障转移矩阵；
- [x] 补齐 Provider 与 ProviderModel 健康失败归因的 handler 级验收；
- [x] 补齐多客户端并发请求下 request、attempt、usage 与健康更新隔离测试；
- [x] 补齐流式请求进行中切换手动起始 ProviderModel 不影响既有请求的验收。

### 阶段 3 交付目标（详细）

- 未绑定到 `default` 的 ProviderModel 永不参与 MVP 路由；
- `/v1/models` 只返回 `default`；
- `model` 缺失、空值或非字符串时返回明确错误；任意其他非空模型名由 `default` 处理；
- 不同逻辑模型拥有不同绑定顺序的能力已由路由核心支持；
- 自动切换、手动切换和冷却规则符合 spec。

### 阶段 3 交付目标

完成协议过滤、排序、冷却、手动切换、failover 和并发请求测试。

## 阶段 4：拆分协议适配器和传输层

### 阶段 4 目标

将协议差异与通用尝试循环分离，形成可扩展代理管线。

### 阶段 4 工作项

- [x] 新增基础 `proxy/transport.ts`，隔离 `http.request` / `https.request` 调用并覆盖基础传输测试；
- [ ] 新增 `proxy/request-context.ts`；
- [ ] 新增 `proxy/protocols/types.ts`；
- [ ] 抽取 OpenAI Completions、OpenAI Responses、Anthropic Messages Adapter；
- [ ] 将模型改写、usage 注入和现有转换逻辑迁移到适配器或转换器注册表；
- [ ] 将超时、客户端中止、SSE 和响应头生命周期完整下沉到传输层；
- [ ] 将 attempt、usage 和 content capture 改为协议无关的观测 hooks；
- [ ] 收敛 handler，使其只负责请求编排、候选尝试、错误分类和生命周期收尾。

### 阶段 4 交付目标（详细）

- handler 只负责请求编排、候选尝试、错误分类和生命周期收尾；
- handler 不直接调用 `http.request` 或 `https.request`；
- 增加协议时不需要修改主尝试循环；
- 非流式、流式、超时和客户端中止行为保持符合 spec。

### 阶段 4 交付目标

各 Adapter、transport、SSE 和协议转换测试通过。

## 阶段 5：重构请求观测分层

### 阶段 5 目标

按 `request_logs`、`request_metrics`、`request_usages`、`request_attempts`、`request_contents` 的职责落盘。

### 阶段 5 工作项

- 将耗时、TTFT、缓存命中迁移到 `request_metrics`；
- [x] 将 request-level 与 attempt-level Token 和协议用量写入 `request_usages`；
- [x] 补齐 attempt 的 Provider、ProviderModel、协议、URL、HTTP 状态、重试判断和请求 ID 快照；
- [x] 将正文改为 request-level 或 attempt-level 独立记录，并为成功、HTTP 失败和已开始的中断流接入采集；
- [x] 流式正文按每次传输收到或写出的原始 chunk 字符串数组保存，不聚合为消息内容，也不按 SSE 事件重新切分；
- [x] 本地最终错误响应收敛为 request-level `captured`，已开始的流中断保留客户端视角原始 chunk 并收敛为 `partial`；
- [x] 日志列表保持轻量，正文通过详情 API 按需读取，并在控制台按客户端与上游 attempt 视角展示；
- [x] 新增 request logger、usage tracker、content capture hooks；
- [x] 接入脱敏和流式 partial 状态；正文与原始流式 chunk 全量保存，不设置单条容量上限。

### 阶段 5 交付目标（详细）

- 一个请求只有一条 request log；
- 每次远端尝试都有一条 attempt；
- request-level 和 attempt-level usage 可区分；
- 正文关闭时不保存完整请求或响应；
- 日志清理按依赖顺序删除关联数据；
- 删除配置实体后历史日志仍可读。

### 阶段 5 交付目标

故障转移、Token 统计、正文完整采集、脱敏和日志清理测试通过。

## 阶段 6：切换管理 API 和控制台

### 阶段 6 目标

让管理 API 与 UI 完全使用新领域模型。

### 阶段 6 工作项

- [x] 将旧 `upstream-models.ts` 管理链路收敛为 ProviderModel 管理接口；
- [x] 删除旧 `/api/upstream-model/*` 路径，不提供兼容别名；
- [x] 增加 Provider endpoint、ProviderModel endpoint 和转换器独立 CRUD 管理；
- 增加调度绑定管理；
- 队列页面改为展示当前 LogicalModel 的绑定顺序；
- Provider 页面拆分 Provider 设置、默认端点和 ProviderModel；
- 请求日志和统计页面读取新的观测分层数据。
- [x] 配置导入导出顶层统一使用 `schemaVersion: 3`，旧 `version` 格式直接拒绝；Provider 密钥仅导出占位符。

### 阶段 6 交付目标（详细）

- UI 不再编辑 endpoint JSON；
- 可以在 LogicalModel 内调整 ProviderModel 顺序；
- API 和 UI 不再使用 `UpstreamModel` 术语；
- 配置导入导出使用新 schemaVersion，不支持旧格式；
- 所有表单输入经过 Zod 校验。

### 阶段 6 交付目标

管理 API 集成测试、控制台核心流程测试和构建通过。

## 阶段 7：MVP 集成验收与发布

### 阶段 7 目标

确认 v0.3 MVP 可以作为一次不兼容的大版本发布。

### 阶段 7 工作项

- [x] 执行完整 typecheck、server test、lint；
- [x] 执行当前 macOS arm64 的完整 build，生成 DMG/zip 并通过 ad-hoc 签名校验；
- [x] 在自动化测试中覆盖 OpenAI、Anthropic 基础代理场景（Gemini 暂不支持）；
- [x] 完成阶段 3 的自动切换、手动切换、健康归因、并发和流式边界矩阵；
- [x] 在自动化测试中覆盖 Host 校验、Token、密钥脱敏和正文隐私边界；
- [ ] 使用全新用户数据目录执行发布包首次启动和空数据库初始化验收；
- [ ] 在发布包内完成 Provider 配置、OpenAI/Anthropic 请求、故障转移、日志与正文查看端到端验收；
- [ ] 使用旧数据库启动发布包，确认界面明确提示重新初始化且不会静默迁移；
- [ ] 完成 macOS arm64/x64 菜单栏、菜单、控制台、开机自启和退出验收；
- [ ] 完成 Windows x64 构建及安装、托盘、控制台和退出验收；
- [ ] 清理剩余旧测试术语和过时文档状态；旧数据库表拒绝逻辑与运行时 `upstreamUrl` 字段仍属于当前兼容边界，不能直接删除；
- [ ] 更新正式版本号、发布说明、更新元数据和全新数据库初始化提示。

### 阶段 7 交付目标（详细）

- 全部 MVP 验收条目通过；
- 新安装和空数据库启动正常；
- 检测到旧数据库时明确要求重新初始化；
- 旧配置不会被静默解释为新配置；
- 发布包可以完成安装、启动、配置 Provider、发送请求和查看日志。

### 阶段 7 交付目标

任何 P0 验收项失败，都不能发布 v0.3；新安装、请求代理、故障切换、日志查看和安全验收全部通过。

## 5. 阶段完成记录

| 阶段 | 目标 | 状态 | 完成日期 | 备注 |
| --- | --- | --- | --- | --- |
| 阶段 0 | 冻结 v0.3 契约 | DONE | 2026-08-20 | 16 表、ProviderModel、SchedulingPolicy 与不兼容边界已冻结 |
| 阶段 1 | 全新数据库基线 | DONE | 2026-08-20 | 16 表基线、约束与 `default` 幂等初始化已落地 |
| 阶段 2 | 公共 Schema 与 Store | DONE | 2026-08-21 | 关系实体 CRUD、调度策略边界、Provider/ProviderModel 双层健康读写与列表契约已落地并覆盖测试 |
| 阶段 3 | `default` 调度和路由 | DONE | 2026-08-21 | 绑定关系路由、LogicalModel 队列边界、双层冷却、模型校验、模型发现、故障转移与健康归因矩阵、并发隔离和手动切换流式边界均已落地并覆盖测试 |
| 阶段 4 | 协议适配器和传输层 | IN_PROGRESS | - | 基础 transport 与测试已落地；ProtocolAdapter、request context、观测 hooks 和 handler 职责收敛待完成 |
| 阶段 5 | 请求观测分层 | DONE | 2026-08-21 | request/attempt usage、双视角 contents、正文与原始 chunk 全量存储、脱敏、历史稳定性与按需详情均已落地并覆盖测试 |
| 阶段 6 | 管理 API 和控制台 | DONE | 2026-08-21 | 调度绑定按 LogicalModel 查询、队列顺序调整、双层健康展示、关系实体 CRUD、配置脱敏与旧内部术语清理已落地 |
| 阶段 7 | MVP 验收与发布 | IN_PROGRESS | - | typecheck、server tests、lint、阶段 3 P0 矩阵和 macOS arm64 DMG/zip build 已通过；代理适配器、macOS x64、Windows x64 与发布包端到端仍待验收 |

状态只允许使用：`TODO`、`IN_PROGRESS`、`BLOCKED`、`DONE`。阶段状态发生变化时，应同步更新本表和 `roadmap.md`。

## 6. 每阶段通用检查清单

- [ ] 代码与对应 spec 一致；
- [ ] 不引入旧数据库兼容逻辑；
- [ ] 不引入旧 API 别名；
- [ ] 不保留无明确用途的 JSON 配置字段；
- [ ] 补充正向、失败和边界测试；
- [ ] `pnpm typecheck` 通过；
- [ ] `pnpm test:server` 通过；
- [ ] `pnpm lint` 通过或记录既有 lint 例外；
- [ ] 更新阶段完成记录。
