# 上游出站代理设置

## 文档状态

本文定义 One Switch 访问模型供应商时使用指定网络代理的产品与技术契约。功能尚未实现，本文作为后续开发和验收依据。

## 背景与目标

部分网络环境无法直接访问模型供应商，或要求所有外部流量经过公司网关、调试代理或本地代理软件。One Switch 当前使用 Node.js `http.request` / `https.request` 直接访问上游，用户只能依赖进程环境变量或操作系统网络配置，控制台内没有可见、可验证的出站代理设置。

本功能提供应用级全局出站代理，使用户可以：

- 指定 One Switch 访问模型供应商时使用的代理服务器；
- 对本地地址或指定域名绕过代理；
- 在保存前测试代理是否能够访问目标地址；
- 在不重启本地监听服务的情况下，让新请求使用最新配置；
- 从明确的错误信息中区分配置错误、代理不可达、认证失败、超时和目标站点错误。

## 术语与边界

本文区分两类方向相反的代理：

| 名称 | 方向 | 说明 |
| --- | --- | --- |
| 本地代理服务 | AI 客户端 → One Switch | One Switch 在 `listenHost:listenPort` 上提供的模型 API 入口 |
| 上游出站代理 | One Switch → 网络代理 → 模型供应商 | 本文新增的网络访问能力 |

“启用上游代理”不修改本地代理服务的监听地址、端口或访问控制，也不代表接管系统代理。

### 首版范围

- HTTP 和 HTTPS 模型 API 请求；
- SSE 流式响应；
- 模型管理中的供应商模型列表获取；
- 模型连接测试，因为该能力复用真实模型请求链路；
- `http://`、`https://`、`socks4://`、`socks5://` 代理地址；
- 主机名、IP 地址和端口形式的绕过规则；
- 使用当前未保存表单值执行连接测试。

### 非目标

- 不修改操作系统、Shell 或其他应用的代理设置；
- 不代理 Electron 自动更新、GitHub 发布页、遥测或其他非模型网络流量；
- 不提供 PAC 脚本；
- 不在首版保存代理用户名或密码；
- 不为正在进行的请求动态切换代理；
- 不将代理失败直接解释为 Provider 或 ProviderModel 故障并触发健康冷却；
- WebSocket 上游传输尚未实现，因此首版不包含 WS 验收；未来实现时必须复用本文的代理选择结果和 Agent 工厂。

## 产品交互

### 设置区域

运行设置页在“监听配置”之后增加“上游代理”设置区域。监听配置描述客户端如何访问 One Switch，上游代理描述 One Switch 如何访问供应商，两者相邻但语义独立。

设置项：

| 字段 | 控件 | 默认值 | 行为 |
| --- | --- | --- | --- |
| 启用上游代理 | Switch | 关闭 | 关闭时所有请求直连，地址与绕过规则保留 |
| 代理地址 | URL 输入框 | 空 | 支持 `http`、`https`、`socks4`、`socks5` |
| 绕过代理 | 文本输入框 | `localhost,127.0.0.1,::1` | 逗号或换行分隔；命中时直接连接目标 |
| 测试目标 | URL 输入框 | `https://www.gstatic.com/generate_204` | 仅用于本次测试，不进入全局设置 |
| 测试连接 | 次级按钮 | — | 使用当前表单中的代理地址、绕过规则和测试目标 |

交互规则：

- 关闭上游代理时，地址和绕过输入框禁用，测试按钮禁用；
- 代理地址为空或格式不合法时，测试按钮禁用，并在输入框附近显示校验信息；
- 测试进行中禁止重复提交，按钮显示加载状态；
- 测试成功后展示 HTTP 状态码、耗时，以及本次实际使用“代理”或“直连”；
- 测试失败使用可操作的中文错误信息，不展示包含代理凭据的原始 URL；
- 测试不会自动保存设置，也不会修改运行中的代理配置；
- 保存设置后只影响后续新请求，已经建立的请求继续使用创建时配置；
- 页面主操作文案改为“保存设置”。只有监听地址或端口变化时，保存流程才重启本地代理服务。

### 为什么测试目标可编辑

只检测代理主机和端口是否可连接无法证明代理可用：端口可以接受 TCP 连接，但仍可能拒绝认证、拒绝 HTTPS `CONNECT`、无法解析目标域名或无法访问公网。测试必须通过代理发起一次真实 HTTP(S) 请求。

默认目标返回 `204 No Content`，响应体很小。用户处于受限网络或无法访问默认目标时，可以改为实际供应商的健康地址或其他可信 URL。任意 HTTP 状态响应均表示网络链路已经建立；状态码仍展示给用户，由用户判断目标端业务结果。

## 配置契约

在全局 `SettingsSchema` 增加：

```typescript
outboundProxyEnabled: boolean
outboundProxyUrl: string
outboundProxyBypass: string
```

默认值：

```typescript
{
  outboundProxyEnabled: false,
  outboundProxyUrl: '',
  outboundProxyBypass: 'localhost,127.0.0.1,::1',
}
```

### 校验规则

`outboundProxyUrl`：

- 关闭代理时允许为空；
- 开启代理时不能为空；
- 必须是绝对 URL；
- scheme 仅允许 `http:`、`https:`、`socks4:`、`socks5:`；
- 必须包含主机名；
- 如显式填写端口，端口必须在 `1..65535`；
- 禁止 URL userinfo，即 `username` 和 `password` 必须为空；
- 保存时规范化 scheme 和主机名大小写，但保留用户明确填写的路径之外部分；代理 URL 不允许业务路径、查询参数或 fragment。

`outboundProxyBypass`：

- 逗号和换行均视为分隔符；
- 忽略首尾空白和空项；
- 主机名匹配不区分大小写；
- `localhost`、`127.0.0.1`、`::1` 默认绕过，用户可显式修改；
- 首版支持精确主机、域名后缀和可选端口，例如 `localhost`、`.example.com`、`api.example.com:8443`；
- 首版不支持 CIDR、通配路径或正则表达式。

### 持久化与导入导出

设置继续使用现有通用 `settings` 键值表，不新增数据库表或迁移。新增字段必须同步到：

- `SettingsSchema` 与 `Settings` 类型；
- 设置更新接口；
- 配置文档 `ConfigSettingsSchema`；
- 配置导出和导入流程；
- 设置页草稿与保存请求。

旧配置文件缺少新字段时使用默认值，保持 schema version 3 的向后兼容。导出文件可以包含无凭据的代理地址和绕过规则。

## 安全与隐私

### 代理认证

首版禁止在 URL 中携带用户名和密码。原因：全局设置存储在普通 SQLite 键值表中，且会进入配置导出；直接支持 `http://user:password@proxy` 会让凭据以明文形式出现在数据库、导出文件、错误对象或调试日志中。

后续如增加认证能力，必须：

1. 使用现有 Secret Store 保存用户名、密码或 Token；
2. 设置表只保存不可逆的密钥引用；
3. 导出配置仅包含占位符，不包含明文凭据；
4. 日志和错误信息对 `Proxy-Authorization` 及代理 URL userinfo 脱敏；
5. 测试接口只接收密钥引用或临时安全通道中的凭据，不回显秘密。

### 请求可见性

启用上游代理意味着网络代理可以观察连接元数据。对于 HTTP 目标，代理能够读取完整请求和响应；对于 HTTPS 目标，普通 `CONNECT` 代理通常只能看到目标主机和流量元数据，但安装了自定义根证书的中间人代理可能读取内容。设置区域应以简短说明提醒用户只使用可信代理。

### SSRF 边界

代理测试接口允许管理端指定测试目标，属于本地管理能力的一部分。它必须继续受 Management API 现有网络可达性和访问控制边界约束，并满足：

- 只允许 `http:` 和 `https:` 测试目标；
- 禁止重定向，避免目标通过 3xx 绕过用户可见地址；
- 限制连接和总响应时间；
- 不保存测试响应体；
- 最多读取少量响应数据后立即释放连接；
- 错误日志不记录完整查询参数或敏感头。

## 技术架构

### 请求覆盖范围

```mermaid
flowchart TD
    A[Settings / 当前测试草稿] --> B[出站代理策略]
    B --> C{目标命中 bypass?}
    C -->|是| D[Node 默认 Agent 直连]
    C -->|否| E[代理 Agent 工厂]
    E --> F[HTTP / HTTPS / SOCKS Agent]
    D --> G[共享 HTTP 传输]
    F --> G
    G --> H[模型 API 请求]
    G --> I[供应商模型列表获取]
    G --> J[代理连接测试]
    H --> K[普通响应 / SSE]
```

现有真实模型请求经过 `executeProxyRequest` 和 `sendUpstreamRequest`；模型连接测试复用该链路，因此主传输层接入后自然生效。

供应商模型列表获取当前在 Management 路由中直接调用 Node HTTP 模块，未经过共享传输层。实现时必须迁移到同一出站请求能力，不能保留独立直连，否则会出现模型调用可以使用代理、模型列表仍然失败的不一致行为。

### 模块职责

建议新增 `source/server/infrastructure/network/`：

```text
network/
├── outbound-proxy.ts        # 配置校验、规范化、bypass 匹配
├── outbound-agent.ts        # 按代理 URL 与目标协议创建、缓存 Agent
└── outbound-request.ts      # 将策略应用到 Node RequestOptions
```

职责边界：

| 模块 | 职责 | 明确不做 |
| --- | --- | --- |
| `outbound-proxy.ts` | 解析配置、判断目标直连或代理、生成脱敏描述 | 不发起网络请求 |
| `outbound-agent.ts` | 创建和缓存 Node Agent，释放旧连接池 | 不读取业务 Provider |
| `outbound-request.ts` | 为目标 URL 生成 `agent` 等请求选项 | 不解析模型协议报文 |
| `proxy/response/transport.ts` | 执行 HTTP I/O、超时、中止、响应生命周期 | 不决定业务路由或保存设置 |
| Management 测试路由 | 校验输入、调用共享出站请求、映射测试结果 | 不修改全局配置 |

### Agent 选择与缓存

实现使用兼容 Node `http.request` / `https.request` 的 Agent，不迁移到另一套 Dispatcher API。建议直接依赖 `proxy-agent` 或其底层明确代理 Agent 包，不依赖锁文件中的传递依赖。

缓存键至少包含：

- 规范化后的代理 URL；
- 目标协议；
- 不含秘密的 Agent 选项。

设置更新后不需要重启监听服务：

- 每次新请求根据最新设置选择 Agent；
- 进行中的请求保留创建时 Agent，不中断；
- 不再引用的 Agent 应在安全时机调用 `destroy()`，释放空闲 socket；
- 并发更新配置时，Agent 缓存替换必须是原子的；
- 测试草稿使用独立或按草稿键缓存的 Agent，不能污染已保存配置状态。

### 健康状态语义

全局代理故障通常会同时影响所有 Provider。如果把代理连接失败计入单个 Provider 的连续失败次数，会依次冷却全部供应商并掩盖真正原因。因此：

- 可以明确归因于代理的连接、认证或隧道错误，不更新 Provider / ProviderModel 健康；
- 通过代理成功建立上游连接后，收到的模型业务状态码继续使用现有健康分类；
- 无法可靠区分代理和目标错误时，保留原始错误阶段信息，并优先避免错误冷却；
- 请求日志和 attempt 错误摘要应记录 `connectionStage: proxy | upstream` 或等价结构，以便诊断。

## Management API

新增：

```text
POST /api/outbound-proxy/test
```

请求：

```json
{
  "proxyUrl": "http://127.0.0.1:7890",
  "bypass": "localhost,127.0.0.1,::1",
  "targetUrl": "https://www.gstatic.com/generate_204"
}
```

测试接口始终按请求中的草稿配置执行，不读取 `outboundProxyEnabled`，因为 UI 只有在启用状态下才允许调用。服务端仍需独立完成全部校验。

成功响应：

```json
{
  "targetUrl": "https://www.gstatic.com/generate_204",
  "route": "proxy",
  "statusCode": 204,
  "durationMilliseconds": 183
}
```

当测试目标命中绕过规则时，`route` 返回 `direct`。任意有效 HTTP 响应都返回成功结构，不要求状态码属于 2xx。

失败响应沿用 Management API 错误包装，建议增加或稳定映射以下错误码：

| 错误码 | HTTP 状态 | 用户提示语义 |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | 代理地址、绕过规则或目标 URL 不合法 |
| `OUTBOUND_PROXY_UNREACHABLE` | 502 | 无法连接代理服务器 |
| `OUTBOUND_PROXY_AUTH_REQUIRED` | 502 | 代理要求认证，首版不支持保存认证信息 |
| `OUTBOUND_PROXY_TUNNEL_REJECTED` | 502 | 代理拒绝连接目标地址 |
| `UPSTREAM_UNAVAILABLE` | 502 | 已连接代理，但目标地址不可达 |
| `UPSTREAM_TIMEOUT` | 504 | 代理连接或目标响应超时 |
| `CLIENT_REQUEST_ABORTED` | 499 | 用户离开页面或取消测试 |

底层错误文本只能用于服务端诊断，返回 UI 的消息必须稳定、可操作且不泄露敏感信息。

## 出站请求行为

### 普通 HTTP 与 HTTPS

- 关闭代理或命中 bypass 时使用 Node 默认 Agent 直连；
- HTTP 目标通过 HTTP(S) 代理时使用代理支持的绝对请求地址语义；
- HTTPS 目标通过 HTTP(S) 代理时使用 `CONNECT` 隧道；
- SOCKS 代理由 Agent 完成 TCP/TLS 建连；
- 目标 TLS 校验继续使用 Node 默认信任链，不因为启用代理而关闭证书校验；
- 不向目标服务器转发 `Proxy-Authorization`；
- 原有连接超时、响应空闲超时、客户端取消和 SSE 流式边界保持不变。

### 重定向

真实模型请求沿用当前“不自动跟随重定向”的行为。代理测试也不自动跟随重定向，直接返回 3xx 状态码，确保测试结果对应用户填写的目标。

### WebSocket 扩展

未来实现 [websocket-transport.md](./websocket-transport.md) 时：

- WS/WSS 握手必须使用同一代理策略和 bypass 规则；
- 兼容 Node Agent 的 WS 客户端可以复用 Agent 工厂；
- 一条已建立连接在生命周期内固定使用创建时代理；
- 代理设置变化只影响后续新连接；
- WS 连接失败同样需要区分代理阶段与上游阶段。

## 配置生效流程

```mermaid
sequenceDiagram
    participant UI as 运行设置页
    participant API as Management API
    participant Store as settings-store
    participant Request as 新上游请求
    participant Agent as Agent 工厂

    UI->>API: 保存 Settings
    API->>Store: updateSettings
    Store-->>UI: 返回规范化后的 Settings
    Note over UI,Store: 代理设置变化不重启本地监听服务
    Request->>Store: 获取最新 Settings 快照
    Request->>Agent: 目标 URL + 代理配置
    Agent-->>Request: 直连或代理 Agent
```

## 实施改动面

### 公共模型与持久化

- `source/common/schemas.ts`
- `source/common/config-schemas.ts`
- `source/server/database/settings-store.ts` 及测试
- `source/server/management/config/export-config.ts` 及配置导入导出测试

### 服务端网络与管理 API

- 新增共享出站网络基础设施模块；
- `source/server/proxy/response/transport.ts`
- `source/server/proxy/execution/attempt-executor.ts`
- `source/server/management/routes/diagnostics/provider-models-fetch.ts`
- 新增代理测试路由并挂载到 Management router；
- `source/server/errors.ts` 增加稳定错误映射。

### 渲染端

- `source/render/source/api/runtime.ts` 增加测试 API；
- 运行设置页新增上游代理卡片；
- 设置保存请求包含新增字段；
- 保存按钮文案和重启条件按本文调整。

## 测试策略

### 单元测试

- 代理 URL 的合法协议、无效协议、userinfo、端口和多余 URL 部分；
- bypass 的精确主机、域名后缀、端口、大小写、IPv4 和 IPv6；
- 代理 URL 脱敏函数不得输出用户名、密码或查询参数；
- 同配置复用 Agent，配置变化替换 Agent；
- 配置默认值、持久化、监听通知和旧配置导入。

### 传输集成测试

测试中启动本地目标服务器和本地代理服务器，不依赖公网：

- HTTP 目标请求确实经过代理；
- HTTPS 目标通过 `CONNECT` 建立隧道；
- 命中 bypass 后代理服务器没有收到请求；
- 代理不可达、返回 `407`、拒绝隧道和超时能够正确分类；
- 请求体、响应体、SSE chunk、超时和客户端取消行为与直连一致；
- 修改配置后新请求使用新代理，进行中请求不被中断；
- 模型列表获取和真实模型请求使用相同策略。

### UI 测试

- 开关控制输入框与测试按钮状态；
- 测试使用当前草稿而不是已保存设置；
- 请求期间禁用重复操作；
- 成功展示 route、状态码和耗时；
- 失败展示稳定错误，不回显敏感 URL；
- 保存代理设置不会重启本地服务；监听地址或端口变化仍会重启。

## 验收标准

- [ ] 用户可以在运行设置页启用或关闭全局上游代理
- [ ] 支持 HTTP、HTTPS、SOCKS4 和 SOCKS5 代理地址
- [ ] 不合法 URL、未知协议、userinfo 和非法端口无法保存或测试
- [ ] 默认绕过 localhost、127.0.0.1 和 ::1，本地模型访问不受影响
- [ ] 普通模型请求、SSE 请求、模型连接测试和模型列表获取均遵守同一代理设置
- [ ] 测试按钮使用未保存草稿，通过代理访问指定目标并展示 route、状态码和耗时
- [ ] 代理不可达、407、CONNECT 拒绝、目标不可达和超时具有可区分的错误提示
- [ ] 代理阶段失败不会错误冷却单个 Provider 或 ProviderModel
- [ ] 保存代理设置后新请求立即生效，无需重启本地监听服务
- [ ] 修改监听地址或端口时仍按现有流程重启本地代理服务
- [ ] 配置导入导出包含无凭据的代理设置，旧 schema version 3 配置仍可导入
- [ ] 数据库、配置导出、运行日志和 UI 错误中不出现代理认证凭据
- [ ] 关闭上游代理后所有模型网络请求恢复直连
- [ ] `pnpm typecheck`、`pnpm lint` 和完整测试通过
