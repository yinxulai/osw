# OSW（One Switch）产品规格文档

本地大模型代理自动切换工具。在本机运行一个 HTTP 代理服务，各类 AI 工具只需配置一个本地 Base URL 和统一虚拟模型名；代理按优先级把请求透传到多个供应商，在网络错误、超时、429/5xx、鉴权失败或模型不可用时自动切换到下一个渠道。

> **文档状态：v0.3 工程实现基本完成，进入发布验收阶段。** 23 张核心表数据库基线、关系模型、核心路由、协议适配器、请求观测和管理界面已经落地；剩余工作集中在协议转换补充验收、跨平台和发布包端到端验证。最终状态以 [roadmap.md](./roadmap.md) 为准。

## 名称与理念

**OSW 是 One Switch 的简称。** 名字就是产品：给你手上所有渠道装一个开关 —— 入口只有一个本地地址，供应商只需配在这一处，哪个渠道挂了就拨到下一个。

这条「一个开关」的隐喻决定了下面几条不可让步的设计取向，它们是本目录所有文档的共同前提：

- **一个入口。** 客户端只面向一个本地地址与一个统一模型名；供应商、账号、模型的增删改都收在代理内部，下游不必跟着变。
- **故障是常态。** 渠道会挂是预期内的事，不是意外。自动接续是产品的核心能力，而不是一个附加的重试选项。
- **默认透传。** 不解析、不改写、不转换，除非用户明确开启。最安全也最快的请求，是代理几乎没碰过的那一个（见下文「核心原则」）。
- **默认只在本地。** 默认只监听回环地址，密钥交给系统存储；不经我们的服务器中转（见 [security-privacy.md](./operations/security-privacy.md)）。把管理面开放到非回环（装到服务器上共享给多人用）是用户显式选择，那种形态默认要求账号登录，见同文「账号与会话」。配置可以经用户自己的第三方云存储（当前是 GitHub Gist）手工同步，但那是用户主动触发、由他本机直连完成的过程，我们不参与也不中转（见 [cloud-sync.md](./data/cloud-sync.md)）。
- **一切可查。** 每次请求实际走到哪里、第几次尝试才成功、耗时与用量如何，都必须留下可回溯的记录（见 [observability.md](./operations/observability.md)）。

## 核心原则

**默认零协议转换。** 代理默认不解析、不修改、不转换任何协议的报文结构。每个 ProviderModel 端点直接配置某协议下的完整 Provider 地址；代理根据请求 path 自动识别协议类型，只在配置了该协议端点的 Provider 模型中选择。可选的[协议兼容转换器](./proxy/protocol-conversion.md)允许在 Provider 模型的端点绑定上按需开启跨协议转换。

## 文档地图

**一个主题只在一处展开。** 下表右列是每个主题的权威文档；其它文档提到同一主题时只写一句结论加一个链接，不再复述细节。发现两处描述不一致时，以权威文档和代码为准。

本目录（`specs/`）是**内部产品规格**，只服务实现与评审，**不进静态站**——使用者的「怎么用」写在 [`../source/`](../source/)（分类与布局见 [`../README.md`](../README.md)）。

**文档按主题分七个子目录**，一簇一个目录，目录名就是这一簇的简称；`README.md`（本文）与 `roadmap.md` 留在根上——它们是全局索引与全局进度，不属于任何一簇。

| 子目录 | 这一簇回答的问题 |
|--------|-----------------|
| [`overview/`](./overview/) | 系统由哪些部分组成、包怎么切、服务怎么起、控制台怎么分层 |
| [`proxy/`](./proxy/) | 一次请求在代理里怎么走：契约、引擎分层、协议转换、重写、出站代理 |
| [`routing/`](./routing/) | 请求落到哪个逻辑模型：路由语义、图执行、画布 |
| [`data/`](./data/) | 配置长什么样、存在哪、怎么同步、怎么本地化 |
| [`design/`](./design/) | 界面与设计系统：tokens、组件、无障碍、排版、图标、主题、颜色 |
| [`platform/`](./platform/) | 交付形态：桌面端与命令行的打包、数据目录、宿主适配 |
| [`operations/`](./operations/) | 运行期可查性：观测、诊断、安全隐私、匿名统计 |

一节一张表，顺序与目录一致：**总览 → 代理与请求 → 路由 → 配置与数据 → 界面与设计系统 → 形态与工程 → 观测与安全**。

### 总览与架构（[`overview/`](./overview/)）

| 主题 | 权威文档 | 覆盖范围 |
|------|---------|---------|
| 系统总览与核心概念 | [architecture.md](./overview/architecture.md) | 概念一句话定义、协议识别与转换总原则 |
| 技术架构 | [tech-architecture.md](./overview/tech-architecture.md) | 技术栈与依赖、构建与打包、仓库顶层结构 |
| 服务端结构 | [server-architecture.md](./overview/server-architecture.md) | 两个监听服务、模块划分、依赖方向、启动与关闭 |
| 控制台分层 | [console-architecture.md](./overview/console-architecture.md) | 五层职责与依赖方向、业务逻辑与 React 的分工、`pnpm lint` 里的分层护栏 |
| 通用任务队列 | [task-queue.md](./overview/task-queue.md) | 进程级队列的生命周期、kind 分工、并发/去重/取消/上限、推送流与外壳浮窗 |

### 代理与请求（[`proxy/`](./proxy/)）

| 主题 | 权威文档 | 覆盖范围 |
|------|---------|---------|
| 代理行为契约 | [proxy.md](./proxy/proxy.md) | 协议识别、候选过滤、自动切换、流式边界、超时、透传规则 |
| 代理引擎内部结构 | [proxy-engine.md](./proxy/proxy-engine.md) | 分层职责、协议无关透传内核、观察/修改扩展接口、协议 × 传输双轴 |
| 协议兼容转换器 | [protocol-conversion.md](./proxy/protocol-conversion.md) | 转换开关、转换矩阵、候选过滤、流式转换、失败语义 |
| 请求重写规则 | [request-rewrite-rules.md](./proxy/request-rewrite-rules.md) | 规则链执行语义、作用位置、排序与失败语义 |
| 上游出站代理 | [outbound-proxy.md](./proxy/outbound-proxy.md) | 三种代理模式、绕过规则、连接测试、错误语义 |

### 路由（[`routing/`](./routing/)）

| 主题 | 权威文档 | 覆盖范围 |
|------|---------|---------|
| 路由设计与节点语义 | [route-design.md](./routing/route-design.md) | 两种模式（工作流图 / 规则表）的划分与语义、`route` 输出契约、路径/类型/操作符、节点设计、默认策略 |
| 工作流引擎语义 | [workflow-engine.md](./routing/workflow-engine.md) | 图模型与边、控制流与迭代、能力注入、校验层次、图持久化 |
| 路由工作台画布 | [route-workbench.md](./routing/route-workbench.md) | 节点外壳与面板分层、端口与插入交互、边与条件分支视觉 |

### 配置与数据（[`data/`](./data/)）

| 主题 | 权威文档 | 覆盖范围 |
|------|---------|---------|
| Provider / 逻辑模型配置 | [provider-model.md](./data/provider-model.md) | Provider、ProviderModel、端点绑定、供应商包格式 |
| 数据模型 | [data-model.md](./data/data-model.md) | 全部表结构与字段定义、JSON 文档版本、初始化与删除规则 |
| 配置云同步 | [cloud-sync.md](./data/cloud-sync.md) | 同步范围、承载方式（后端）与凭据、推送/拉取语义、不传播的动作 |
| 国际化 | [i18n.md](./data/i18n.md) | 三层语言模型、UI 目录、诊断固定英文、错误码契约、迁移阶段 |

### 界面与设计系统（[`design/`](./design/)）

这一簇的入口是 [`design-system.md`](./design/design-system.md)（**总纲**：三层取舍原则、红线、文档地图）。
**一条主题只在一份分册里展开**，总纲只留结论加链接。

| 主题 | 权威文档 | 覆盖范围 |
|------|---------|---------|
| 设计系统总纲 | [design-system.md](./design/design-system.md) | 三层取舍（行为层 Radix / 刻度与状态层借成熟系统 / 品牌层自定）、**不许手写的 7 条红线**、文档地图、全局铁律、评审入口清单 |
| 上游刻度映射 | [design-token-mapping.md](./design/design-token-mapping.md) | Carbon / Fluent 2 / Primer → osw 的间距、字号、密度、elevation、状态矩阵对照；**上游证据来源表与未核实项的唯一登记处** |
| 语义 token 与圆角 | [design-system-tokens.md](./design/design-system-tokens.md) | 四层 token 结构、语义 token 全清单、**字面色值与调色板类名的逐条归位**、圆角体系、**新增 token 的 4 条门槛**、明暗覆盖账 |
| 组件 API 约定 | [design-system-components.md](./design/design-system-components.md) | variant vs 组合的判定树、props 命名 11 条、`components-*` 与组件的关系、**新增组件的 7 条门槛** |
| 无障碍基线 | [design-system-accessibility.md](./design/design-system-accessibility.md) | 对比度 / 目标尺寸 / 焦点可见 / 键盘完整性 / 动效降级 / IME / RTL / 播报，含 WCAG 2.2 条文与可执行 checklist |
| 排版规范 | [design-system-typography.md](./design/design-system-typography.md) | 两套字阶（`system-*` 与 `text-*` 的 `sm` 冲突）、11px 下限、字重、行高、字距、数字与等宽、截断与换行 |
| 图标规范 | [design-system-icons.md](./design/design-system-icons.md) | `lucide-react` 唯一来源、尺寸五档、描边三档、基线与文字对齐、品牌标志与协议图标 |
| 表单与数据表格 | [design-system-data-display.md](./design/design-system-data-display.md) | `table-primitives` 类常量、行高与密度、批量操作、空/加载/错误三态、分页 |
| 用语规范 | [design-system-copy.md](./design/design-system-copy.md) | 中英文语气与长度上限、出错文案骨架、标点、术语表（与 [i18n.md](./data/i18n.md) 的机制分层不重叠） |
| 明暗主题机制 | [design-system-theming.md](./design/design-system-theming.md) | `.dark` 的 4 个读写点、token 与 `dark:` 两套机制、**明暗覆盖完整性的三条静态检查**与 11 项人工检查 |
| AI 生成器约束 | [design-system-ai-constraints.md](./design/design-system-ai-constraints.md) | 允许 / 禁止 / 正确做法三段式清单、常见任务配方、提交前自检脚本、不确定时的默认动作 |
| 颜色体系 | [design-system-colors.md](./design/design-system-colors.md) | 借 Radix Colors 的 **12 步「角色骨架」**（零依赖、零改值）、12 步 → osw 落位表、完整色值清单（中性 11 档 / 透明 8 档 / 语义族 / 分类色 / 热力）、**实测到的色值冲突**、新增颜色 token 的门槛 |

### 形态与工程（[`platform/`](./platform/)）

| 主题 | 权威文档 | 覆盖范围 |
|------|---------|---------|
| 包结构与多形态分发 | [packaging.md](./platform/packaging.md) | 包边界、目录归属、CLI 与 App 的宿主适配、运行时配置、阶段划分 |
| 桌面端形态 | [desktop.md](./platform/desktop.md) | 托盘与菜单、控制台页面、用户流程 |

### 观测与安全（[`operations/`](./operations/)）

| 主题 | 权威文档 | 覆盖范围 |
|------|---------|---------|
| 观测 | [observability.md](./operations/observability.md) | 请求日志与正文采集、用量统计、健康状态与冷却 |
| 渠道诊断 | [diagnostics.md](./operations/diagnostics.md) | 两个入口的分工、探测请求构造、多轮汇总口径、交付与取消语义 |
| 安全与隐私 | [security-privacy.md](./operations/security-privacy.md) | 监听边界、访问控制、密钥存储、脚本沙箱、隐私 |
| 匿名使用统计 | [telemetry.md](./operations/telemetry.md) | 默认开启、界面无任何入口的统计口径、事件白名单、上报链路与分析口径 |

### 进度与外部依据

| 主题 | 权威文档 | 覆盖范围 |
|------|---------|---------|
| 版本规划 | [roadmap.md](./roadmap.md) | 唯一的进度与验收状态来源 |
| 上游协议参考 | [../upstream/](../upstream/)（索引见 [../upstream/README.md](../upstream/README.md)） | 三家上游 API 的逐字快照；协议转换器字段映射的唯一外部依据 |

管理 API 清单以代码为准（`packages/core/source/management/router.ts` 与 `packages/core/source/management/routes/`）；控制台页面清单以 `packages/console/source/pages/` 为准；数据库表与字段以 `packages/core/source/database/config-schema.ts`（用户配置）与 `data-schema.ts`（观测数据）为准——两个库各自是一份独立 schema。
