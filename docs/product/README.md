# OSW（One Switch）产品规格文档

本地大模型代理自动切换工具。在本机运行一个 HTTP 代理服务，各类 AI 工具只需配置一个本地 Base URL 和统一虚拟模型名；代理按优先级把请求透传到多个供应商，在网络错误、超时、429/5xx、鉴权失败或模型不可用时自动切换到下一个渠道。

> **文档状态：v0.3 工程实现基本完成，进入发布验收阶段。** 22 张核心表数据库基线、关系模型、核心路由、协议适配器、请求观测和管理界面已经落地；剩余工作集中在协议转换补充验收、跨平台和发布包端到端验证。最终状态以 [roadmap.md](./roadmap.md) 为准。

## 名称与理念

**OSW 是 One Switch 的简称。** 名字就是产品：给你手上所有渠道装一个开关 —— 入口只有一个本地地址，供应商只需配在这一处，哪个渠道挂了就拨到下一个。

这条「一个开关」的隐喻决定了下面几条不可让步的设计取向，它们是本目录所有文档的共同前提：

- **一个入口。** 客户端只面向一个本地地址与一个统一模型名；供应商、账号、模型的增删改都收在代理内部，下游不必跟着变。
- **故障是常态。** 渠道会挂是预期内的事，不是意外。自动接续是产品的核心能力，而不是一个附加的重试选项。
- **默认透传。** 不解析、不改写、不转换，除非用户明确开启。最安全也最快的请求，是代理几乎没碰过的那一个（见下文「核心原则」）。
- **只在本地。** 默认只监听回环地址，密钥交给系统存储，没有账号体系、云同步或远程中转（见 [security-privacy.md](./security-privacy.md)）。
- **一切可查。** 每次请求实际走到哪里、第几次尝试才成功、耗时与用量如何，都必须留下可回溯的记录（见 [observability.md](./observability.md)）。

## 核心原则

**默认零协议转换。** 代理默认不解析、不修改、不转换任何协议的报文结构。每个 ProviderModel 端点直接配置某协议下的完整 Provider 地址；代理根据请求 path 自动识别协议类型，只在配置了该协议端点的 Provider 模型中选择。可选的[协议兼容转换器](./protocol-conversion.md)允许在 Provider 模型的端点绑定上按需开启跨协议转换。

## 文档地图

**一个主题只在一处展开。** 下表右列是每个主题的权威文档；其它文档提到同一主题时只写一句结论加一个链接，不再复述细节。发现两处描述不一致时，以权威文档和代码为准。

| 主题 | 权威文档 | 覆盖范围 |
|------|---------|---------|
| 系统总览与核心概念 | [architecture.md](./architecture.md) | 概念一句话定义、协议识别与转换总原则 |
| 代理行为契约 | [proxy.md](./proxy.md) | 协议识别、候选过滤、自动切换、流式边界、超时、透传规则 |
| 代理引擎内部结构 | [proxy-engine.md](./proxy-engine.md) | 分层职责、协议无关透传内核、观察/修改扩展接口、协议 × 传输双轴 |
| 路由设计与节点语义 | [route-design.md](./route-design.md) | 两种模式（工作流图 / 规则表）的划分与语义、`route` 输出契约、路径/类型/操作符、节点设计、默认策略 |
| 路由工作台画布 | [route-workbench.md](./route-workbench.md) | 节点外壳与面板分层、端口与插入交互、边与条件分支视觉 |
| 工作流引擎语义 | [workflow-engine.md](./workflow-engine.md) | 图模型与边、控制流与迭代、能力注入、校验层次、图持久化 |
| 请求重写规则 | [request-rewrite-rules.md](./request-rewrite-rules.md) | 规则链执行语义、作用位置、排序与失败语义 |
| 协议兼容转换器 | [protocol-conversion.md](./protocol-conversion.md) | 转换开关、转换矩阵、候选过滤、流式转换、失败语义 |
| Provider / 逻辑模型配置 | [provider-model.md](./provider-model.md) | Provider、ProviderModel、端点绑定、供应商包格式 |
| 数据模型 | [data-model.md](./data-model.md) | 全部表结构与字段定义、JSON 文档版本、初始化与删除规则 |
| 观测 | [observability.md](./observability.md) | 请求日志与正文采集、用量统计、健康状态与冷却 |
| 上游出站代理 | [outbound-proxy.md](./outbound-proxy.md) | 三种代理模式、绕过规则、连接测试、错误语义 |
| 安全与隐私 | [security-privacy.md](./security-privacy.md) | 监听边界、访问控制、密钥存储、脚本沙箱、隐私 |
| 匿名使用统计 | [telemetry.md](./telemetry.md) | 默认开启、界面无任何入口的统计口径、事件白名单、上报链路与分析口径 |
| 桌面端形态 | [desktop.md](./desktop.md) | 托盘与菜单、控制台页面、用户流程 |
| 服务端结构 | [server-architecture.md](./server-architecture.md) | 两个监听服务、模块划分、依赖方向、启动与关闭 |
| 技术架构 | [tech-architecture.md](./tech-architecture.md) | 技术栈与依赖、构建与打包、仓库顶层结构 |
| 包结构与多形态分发 | [packaging.md](./packaging.md) | 包边界、目录归属、CLI 与 App 的宿主适配、运行时配置、阶段划分 |
| 国际化 | [i18n.md](./i18n.md) | 三层语言模型、UI 目录、诊断固定英文、错误码契约、迁移阶段 |
| 版本规划 | [roadmap.md](./roadmap.md) | 唯一的进度与验收状态来源 |
| 上游协议参考 | [../references/](../references/)（索引见 [../README.md](../README.md)） | 三家上游 API 的逐字快照；协议转换器字段映射的唯一外部依据 |

管理 API 清单以代码为准（`packages/core/source/management/router.ts` 与 `packages/core/source/management/routes/`）；控制台页面清单以 `packages/console/source/pages/` 为准；数据库表与字段以 `packages/core/source/database/config-schema.ts`（用户配置）与 `data-schema.ts`（观测数据）为准——两个库各自是一份独立 schema。
