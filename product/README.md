# One Switch 产品规格文档

本地大模型代理自动切换工具。在本机运行一个 HTTP 代理服务，各类 AI 工具只需配置一个本地 Base URL 和统一虚拟模型名；代理按优先级把请求透传到多个供应商，在网络错误、超时、429/5xx、鉴权失败或模型不可用时自动切换到下一个渠道。

> **文档状态：v0.3 工程实现基本完成，进入发布验收阶段。** 17 表数据库基线、关系模型、核心路由、协议适配器、请求观测和管理界面已经落地；剩余工作集中在协议转换补充验收、跨平台和发布包端到端验证。最终状态以 `roadmap.md` 为准。

## 核心原则

**默认零协议转换。** 代理默认不解析、不修改、不转换任何协议的报文结构。每个 ProviderModel 端点直接配置某协议下的完整 Provider 地址；代理根据请求 path 自动识别协议类型，只在配置了该协议端点的 Provider 模型中选择。可选的[协议兼容转换器](./protocol-conversion.md)允许在 Provider 模型的端点绑定上按需开启跨协议转换。

## 文档索引

| 文档 | 内容 |
|------|------|
| [architecture.md](./architecture.md) | 系统架构、核心概念、零协议转换原则 |
| [proxy.md](./proxy.md) | 本地代理服务：协议识别、路由、自动切换、流式边界 |
| [websocket-transport.md](./websocket-transport.md) | proxy.md 传输层补充：`/v1/responses` 的 WS 透传中继、握手降级、连接级观测（原生透传，非协议转换） |
| [protocol-conversion.md](./protocol-conversion.md) | 协议兼容转换器（可选功能）：转换开关、转换矩阵、流式转换、UI 展示 |
| [provider-model.md](./provider-model.md) | Provider、Logical Model、Provider Model 配置模型 |
| [data-model.md](./data-model.md) | 完整数据模型：数据库表设计、JSON 文档版本、索引、关系 |
| [desktop.md](./desktop.md) | 桌面端形态、菜单栏、控制台页面、用户流程 |
| [security-privacy.md](./security-privacy.md) | 安全边界、密钥存储、隐私策略 |
| [observability.md](./observability.md) | 日志、用量统计、健康状态、冷却 |
| [request-rewrite-rules.md](./request-rewrite-rules.md) | 请求与响应重写设计 |
| [tech-architecture.md](./tech-architecture.md) | 技术架构、框架选型、项目结构、核心模块设计 |
| [roadmap.md](./roadmap.md) | MVP / P1 / P2 版本规划与验收标准 |
