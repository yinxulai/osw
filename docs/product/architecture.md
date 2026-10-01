# 系统架构与核心概念

## 整体架构

```mermaid
flowchart LR
   UI[Electron 控制台 UI] --> Host[Electron 主进程<br/>窗口 / 托盘 / 菜单 / 自动更新]
   Host -->|RPC| Service[核心服务进程<br/>Electron utilityProcess<br/>node:sqlite 的唯一连接持有者]
   Service --> Management[管理服务<br/>127.0.0.1:9301]
   Management --> Store[(SQLite + 密钥存储)]
   Management --> Lifecycle[代理生命周期控制]

   Client[AI 客户端] --> Proxy[代理服务<br/>设置中的 listenHost:listenPort]
   Lifecycle --> Proxy
   Proxy --> Store
   Proxy --> Router[协议识别、路由与故障切换]
   Router --> OpenAI[OpenAI Completions / Responses 供应商]
   Router --> Anthropic[Anthropic Messages 供应商]
```

管理服务与代理服务是两个独立的 HTTP 监听器。两者共享应用级配置和密钥存储，但代理可以单独启动、停止或重启，管理服务在此过程中持续可用。

**核心服务跑在专用子进程里（Electron `utilityProcess`），不在 Electron 主进程里。** `node:sqlite` 的 `DatabaseSync` 只有同步 API，一条聚合查询就会阻塞它所在的事件循环：实测 `/api/analytics/summary?range=30d` 打到 6.6 GB 库上时 p50 159 ms、max 330 ms，而同时段的 `/api/settings/get` 空闲时只要 1.9 ms——同一时间片里的界面与托盘全部陪等（issue #9）。所以整个 `core` 由 `utilityProcess.fork()` 起成一个真进程（入口 `output/command/service-main.mjs`），主进程只剩这个进程的遥控器（`apps/app/source/server-host.ts`），两者之间只有 KB 级控制消息，没有请求体/响应体过线。

用真进程而不是 `worker_threads` 的关键原因在打包侧：`worker_threads` 的 `fs` 没有被 Electron 的 asar 补丁包住，读不到 `app.asar` 里的文件，只能把服务代码摊到 `app.asar.unpacked`/`extraResources`；而 `utilityProcess` 走的是和主进程同一套模块加载路径，asar 原生可读，于是**所有资源重新收回 `app.asar` 一个文件**（见 [packaging.md](./packaging.md)）。代价是一次冷启动约多 100 ms。

由此带来四条必须遵守的约束：

- 主进程**不得** import 任何会拉起 `node:sqlite` 的模块。宿主与服务进程共享的只有类型（`packages/core/source/host/protocol.ts`），一旦那个文件出现运行期代码，整个搬家就白做。
- 跨进程传的东西必须能结构化克隆。`startProxyServer()` 返回的 `http.Server` 带函数字段，直接 `postMessage` 会 `DataCloneError`，所以协议里这两个方法的 `result` 就是 `void`。
- 服务进程的启动参数（dataDir、监听端口…）没有 `workerData` 可用，所以取法是在服务进程起来后的第一个动作主动向宿主调 `runtime.config`；宿主在 `fork()` 的同一拍就把这个 handler 注册好，因此不存在启动竞态。
- 进程隔离是双向的：服务进程崩了不会带走宿主，宿主在 `exit` 回调里按退避重启（`service-host.ts` 的 `RESTART_POLICY`），所以服务进程内 `process.exit()` 是安全的。

两个监听器的内部模块划分与依赖方向见 [server-architecture.md](./server-architecture.md)；代理侧的分层职责见 [proxy-engine.md](./proxy-engine.md)；代理对外可见的行为契约见 [proxy.md](./proxy.md)；服务进程的打包与部署约束见 [packaging.md](./packaging.md)。

## 核心概念

概念只在这里做一句话定位；定义、字段与取值范围一律以右列权威文档为准，本文不再复述。

| 概念 | 一句话定位 | 权威文档 |
|------|-----------|---------|
| Provider | 一个模型服务渠道，负责稳定身份、生命周期和 Provider 级设置 | [provider-model.md](./provider-model.md) |
| ProviderEndpoint | Provider 在某协议下的默认端点 URL（`provider_endpoints`） | [provider-model.md](./provider-model.md) |
| ProviderModel | Provider 上一个真实模型，是路由的最小单元 | [provider-model.md](./provider-model.md) |
| 端点绑定 | ProviderModel → ProviderEndpoint 的绑定，可覆盖 URL、可启用协议转换器（`provider_model_endpoints`） | [provider-model.md](./provider-model.md)、[protocol-conversion.md](./protocol-conversion.md) |
| Protocol | 由请求 path 识别的 API 协议，当前只有 `openai-completions`、`openai-responses`、`anthropic-messages` | [proxy.md](./proxy.md) |
| Logical Model | 对外暴露的路由模型；v0.3 只有兜底用的 `default` | [data-model.md](./data-model.md) |
| 调度绑定 | LogicalModel × ProviderModel 的候选池绑定，含优先级、权重、启用状态（`scheduling_policies`） | [data-model.md](./data-model.md) |
| Route | 一次请求的路由决策结果与决策依据，由当前生效的路由定义（工作流图或规则表）算出后写进 `route` 命名空间 | [route-design.md](./route-design.md) |
| Attempt | 一次上游调用尝试：ProviderModel、耗时、HTTP 状态、错误分类、是否流式 | [data-model.md](./data-model.md)、[observability.md](./observability.md) |
| Health | Provider 与 ProviderModel 两级的运行时健康状态与冷却 | [observability.md](./observability.md)、[data-model.md](./data-model.md) |

概念之间的字段级关系见 [data-model.md](./data-model.md) 的关系概览；健康状态与冷却判定见 [observability.md](./observability.md)。

协议仅用于路由过滤，代理默认不解析任何协议的报文结构（见下方原则 2）。

## 协议路由与转换原则

1. 当前支持的客户端/上游协议只有 `openai-completions`、`openai-responses`、`anthropic-messages`，各协议的识别路径见 [proxy.md](./proxy.md) 的协议识别表；Gemini 等其它协议尚未实现，不属于当前能力。
2. 同协议请求只做最小请求处理：根据 path 识别协议、将请求体中的 `model` 替换为 ProviderModel 的 `modelName`、注入认证头并安全透传端到端 header。
3. 协议转换不是全协议自动互转，而是由 ProviderModel 端点绑定上显式启用的转换器控制。当前注册的方向以 `packages/core/source/proxy/protocols/shared/conversion-registry.ts` 与各协议的 `conversion-adapters.ts` 为准，包括 OpenAI Completions ↔ Anthropic Messages、OpenAI Responses → OpenAI Completions，以及各协议直连；未注册方向必须拒绝。转换开关、矩阵与候选过滤见 [protocol-conversion.md](./protocol-conversion.md)。
4. 已启用转换时，请求由 `packages/core/source/proxy/protocols/shared/request-conversion*.ts` 改写，响应及 SSE 由 `packages/core/source/proxy/protocols/shared/response-conversion*.ts` 处理；转换可能改变响应格式，不能概括为“始终逐块透传”。
5. 每个 `provider_endpoints` 配置 Provider 的原生协议 URL；`provider_model_endpoints.url` 非空时覆盖默认 URL。路由只考虑当前 LogicalModel 的 `scheduling_policies` 绑定、健康状态和协议原生匹配/显式转换匹配的候选。
