# 上游出站代理设置

## 文档状态

本文定义 One Switch 访问模型供应商时使用指定网络代理的产品与技术契约。功能尚未实现，技术选型已确定使用 `proxy-agent`，本文作为后续开发和验收依据。

## 背景与目标

部分网络环境无法直接访问模型供应商，或要求所有外部流量经过公司网关、调试代理或本地代理软件。One Switch 当前使用 Node.js `http.request` / `https.request` 直接访问上游，用户只能依赖进程环境变量或操作系统网络配置，控制台内没有可见、可验证的出站代理设置。

本功能提供应用级全局出站代理策略，使用户可以：

- 明确选择强制直连、跟随系统代理或使用自定义代理；
- 为自定义代理配置包含账号密码的完整代理 URL；
- 对本地地址或指定域名绕过自定义代理；
- 在保存前测试当前代理策略是否能够访问目标地址；
- 在不重启本地监听服务的情况下，让新请求使用最新配置；
- 从明确的错误信息中区分配置错误、代理不可达、认证失败、超时和目标站点错误。

## 术语与边界

本文区分两类方向相反的代理：

| 名称 | 方向 | 说明 |
| --- | --- | --- |
| 本地代理服务 | AI 客户端 → One Switch | One Switch 在 `listenHost:listenPort` 上提供的模型 API 入口 |
| 上游出站代理 | One Switch → 网络代理 → 模型供应商 | 本文新增的网络访问能力 |

上游代理策略不修改本地代理服务的监听地址、端口或访问控制。“使用系统代理”只读取操作系统或 Electron 会话解析出的代理结果，不修改系统配置，也不影响其他应用。

### 首版范围

- HTTP 和 HTTPS 模型 API 请求；
- SSE 流式响应；
- 模型管理中的供应商模型列表获取；
- 模型连接测试，因为该能力复用真实模型请求链路；
- “不使用任何代理”“使用系统代理”“自定义代理”三种互斥模式；
- 自定义代理支持 `http://`、`https://`、`socks4://`、`socks5://` 地址及 URL userinfo 账号密码；
- 主机名、IP 地址和端口形式的自定义代理绕过规则；
- 系统代理模式支持操作系统静态代理和 PAC 解析结果；
- 使用当前未保存表单值执行连接测试。

### 非目标

- 不修改操作系统、Shell 或其他应用的代理设置；
- 不代理 Electron 自动更新、GitHub 发布页、遥测或其他非模型网络流量；
- 不在应用内编辑或托管 PAC 脚本；
- 不为正在进行的请求动态切换代理；
- 不将代理失败直接解释为 Provider 或 ProviderModel 故障并触发健康冷却；
- WebSocket 上游传输尚未实现，因此首版不包含 WS 验收；未来实现时必须复用本文的代理选择结果和共享出站连接器。

## 产品交互

### 设置区域

运行设置页在“监听配置”之后增加“上游代理”设置区域。监听配置描述客户端如何访问 One Switch，上游代理描述 One Switch 如何访问供应商，两者相邻但语义独立。

设置项：

| 字段 | 控件 | 默认值 | 行为 |
| --- | --- | --- | --- |
| 代理模式 | 单选组或分段控件 | 使用系统代理 | 可选“不使用任何代理”“使用系统代理”“自定义代理” |
| 代理地址 | URL 输入框 | 空 | 仅自定义模式显示；支持 `http`、`https`、`socks4`、`socks5` 和 URL 账号密码 |
| 绕过代理 | 文本输入框 | `localhost,127.0.0.1,::1` | 仅自定义模式显示；逗号或换行分隔，命中时直接连接目标 |
| 测试目标 | URL 输入框 | `https://www.gstatic.com/generate_204` | 仅用于本次测试，不进入全局设置 |
| 测试连接 | 次级按钮 | — | 使用当前表单中的代理模式、地址、绕过规则和测试目标 |

交互规则：

- 不使用任何代理时隐藏自定义地址和绕过规则，测试按钮仍可用于验证直连；
- 使用系统代理时隐藏自定义地址和绕过规则，测试时展示系统最终解析为代理或直连；
- 使用自定义代理时显示地址和绕过规则；地址为空或格式不合法时禁用测试按钮并显示校验信息；
- 代理地址输入框使用普通文本输入，不自动遮挡整条 URL；页面不在其他位置重复显示其中的账号密码；
- 测试进行中禁止重复提交，按钮显示加载状态；
- 测试成功后展示 HTTP 状态码、耗时，以及本次实际使用“直连”“系统代理”或“自定义代理”；
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
outboundProxyMode: 'direct' | 'system' | 'custom'
outboundProxyUrl: string
outboundProxyBypass: string
```

默认值：

```typescript
{
  outboundProxyMode: 'system',
  outboundProxyUrl: '',
  outboundProxyBypass: 'localhost,127.0.0.1,::1',
}
```

`direct` 明确强制直连，不读取系统代理或代理环境变量；`system` 使用 Electron 会话解析的系统代理，也是新安装和旧配置缺少该字段时的默认模式；`custom` 使用用户填写的代理 URL。

### 校验规则

`outboundProxyUrl`：

- `direct` 和 `system` 模式允许为空并忽略已保存值；
- `custom` 模式不能为空；
- 必须是绝对 URL；
- scheme 仅允许 `http:`、`https:`、`socks4:`、`socks5:`；
- 必须包含主机名；
- 如显式填写端口，端口必须在 `1..65535`；
- 允许 URL userinfo，包括用户名、密码或仅用户名形式；账号密码按 URL 标准进行百分号编码；
- 保存时规范化 scheme 和主机名大小写；代理 URL 不允许业务路径、查询参数或 fragment。

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

旧配置文件缺少新字段时使用默认值，保持 schema version 3 的向后兼容。配置导入导出完整保留代理模式、自定义代理 URL 和绕过规则，包括 URL 中的账号密码。

## 安全与隐私

### 代理认证与存储

自定义代理 URL 允许直接携带用户名和密码，例如 `http://user:password@127.0.0.1:7890`。按本功能契约，该完整 URL：

- 作为普通设置值保存在本地 SQLite；
- 随配置导出和导入，不替换为密钥引用；
- 在设置表单中可编辑；
- 交给 `proxy-agent` 生成代理认证信息。

这意味着数据库和导出文件可能包含明文代理凭据。导出操作应提示文件可能包含代理账号密码，用户负责保管。运行日志、请求日志、错误消息、测试结果和诊断信息不得输出完整 URL userinfo；显示代理地址时统一脱敏为 `scheme://***:***@host:port`。不得把 `Proxy-Authorization` 转发给目标服务器。

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
    A[Settings / 当前测试草稿] --> B{代理模式}
    B -->|direct| C[返回空字符串]
    B -->|system| D[Electron session.resolveProxy]
    B -->|custom| E{命中 bypass?}
    E -->|是| C
    E -->|否| F[返回自定义代理 URL]
    D --> G[转换系统 DIRECT / PROXY / HTTPS / SOCKS 结果]
    C --> H[共享出站连接器]
    F --> H
    G --> H
    H --> I[共享 HTTP 传输]
    I --> J[模型 API / 模型列表 / 连接测试]
    J --> K[普通响应 / SSE]
```

现有真实模型请求经过 `executeProxyRequest` 和 `sendUpstreamRequest`；模型连接测试复用该链路，因此主传输层接入后自然生效。

供应商模型列表获取当前在 Management 路由中直接调用 Node HTTP 模块，未经过共享传输层。实现时必须迁移到同一出站请求能力，不能保留独立直连，否则会出现模型调用可以使用代理、模型列表仍然失败的不一致行为。

### 模块职责

建议新增 `source/server/infrastructure/network/`：

```text
network/
├── outbound-proxy.ts        # 配置校验、规范化、bypass 匹配
└── outbound-connector.ts    # 解析三态策略并接入 Node RequestOptions
```

职责边界：

| 模块 | 职责 | 明确不做 |
| --- | --- | --- |
| `outbound-proxy.ts` | 解析配置、判断目标直连或代理、生成脱敏描述 | 不发起网络请求 |
| `outbound-connector.ts` | 持有共享出站连接器，为目标 URL 生成底层请求选项 | 不解析模型协议报文 |
| `proxy/response/transport.ts` | 执行 HTTP I/O、超时、中止、响应生命周期 | 不决定业务路由或保存设置 |
| Management 测试路由 | 校验输入、调用共享出站连接器、映射测试结果 | 不修改全局配置 |

业务代码、配置字段、日志与 UI 统一使用“出站连接器”“代理模式”“代理策略”等名称，不使用 `agent` 命名；`Agent` 仅限第三方库类型和 Node.js 底层 API 边界。

### `proxy-agent` 与系统代理集成

项目直接依赖 `proxy-agent`，不使用锁文件中的传递依赖，也不通过修改 `HTTP_PROXY`、`HTTPS_PROXY` 或 `NO_PROXY` 环境变量来切换模式。

底层实现使用一个长生命周期 `ProxyAgent`，通过异步 `getProxyForUrl(targetUrl)` 回调读取当前内存配置。该类型只封装在 `outbound-connector.ts` 内部，不进入业务接口：

- `direct`：始终返回空字符串，明确绕过系统代理和代理环境变量；
- `custom`：命中应用 bypass 时返回空字符串，否则返回包含 userinfo 的规范化自定义代理 URL；
- `system`：调用 Electron 默认会话的 `session.resolveProxy(targetUrl)`，将 Chromium 代理解析结果转换为 `proxy-agent` 支持的 URL；
- `proxy-agent` 根据最终 URL scheme 自动选择 HTTP、HTTPS 或 SOCKS 实现；
- 底层库负责按目标协议和代理 URL 缓存具体连接实现，并在缓存淘汰时释放连接资源；
- 应用退出或网络运行时销毁时释放共享出站连接器。

`session.resolveProxy()` 可能返回按优先级排列的 `DIRECT`、`PROXY host:port`、`HTTPS host:port`、`SOCKS host:port`、`SOCKS4 host:port` 等 Chromium 代理规则。解析器按顺序选择首个受支持结果；`DIRECT` 返回空字符串；无法识别或系统解析失败时返回稳定错误，不静默回退到其他来源。系统代理解析通过运行时注入的适配器提供，保持 `source/server` 核心模块可测试且不直接依赖 Electron。

设置更新后不需要重启监听服务。出站连接器对每个新请求读取最新配置，进行中的请求继续使用建连时选定的路径。测试草稿创建短生命周期连接器，测试结束后释放资源，不会修改或污染已保存配置对应的共享实例。

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
  "mode": "custom",
  "proxyUrl": "http://user:password@127.0.0.1:7890",
  "bypass": "localhost,127.0.0.1,::1",
  "targetUrl": "https://www.gstatic.com/generate_204"
}
```

测试接口始终按请求中的三态草稿配置执行。`direct` 和 `system` 模式忽略 `proxyUrl` 与 `bypass`；`custom` 模式完成全部 URL 与 bypass 校验。请求体允许携带代理账号密码，但服务端不得记录原始请求体或完整代理 URL。

成功响应：

```json
{
  "targetUrl": "https://www.gstatic.com/generate_204",
  "route": "custom-proxy",
  "statusCode": 204,
  "durationMilliseconds": 183
}
```

`route` 可为 `direct`、`system-direct`、`system-proxy` 或 `custom-proxy`。自定义目标命中绕过规则时返回 `direct`；系统代理解析为 `DIRECT` 时返回 `system-direct`。任意有效 HTTP 响应都返回成功结构，不要求状态码属于 2xx。

失败响应沿用 Management API 错误包装，建议增加或稳定映射以下错误码：

| 错误码 | HTTP 状态 | 用户提示语义 |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | 代理模式、地址、绕过规则或目标 URL 不合法 |
| `SYSTEM_PROXY_RESOLUTION_FAILED` | 502 | 无法读取或解析当前系统代理配置 |
| `OUTBOUND_PROXY_UNREACHABLE` | 502 | 无法连接代理服务器 |
| `OUTBOUND_PROXY_AUTH_REQUIRED` | 502 | 代理要求认证，或填写的账号密码无效 |
| `OUTBOUND_PROXY_TUNNEL_REJECTED` | 502 | 代理拒绝连接目标地址 |
| `UPSTREAM_UNAVAILABLE` | 502 | 已连接代理，但目标地址不可达 |
| `UPSTREAM_TIMEOUT` | 504 | 代理连接或目标响应超时 |
| `CLIENT_REQUEST_ABORTED` | 499 | 用户离开页面或取消测试 |

底层错误文本只能用于服务端诊断，返回 UI 的消息必须稳定、可操作且不泄露代理账号密码。

## 出站请求行为

### 普通 HTTP 与 HTTPS

- `direct` 模式和自定义 bypass 命中时使用 Node 默认连接实现直连；
- `system` 模式尊重系统代理对每个目标返回的代理或 `DIRECT` 结果；
- HTTP 目标通过 HTTP(S) 代理时使用代理支持的绝对请求地址语义；
- HTTPS 目标通过 HTTP(S) 代理时使用 `CONNECT` 隧道；
- SOCKS 代理由底层连接器完成 TCP/TLS 建连；
- 代理 URL userinfo 仅用于生成代理认证，不得进入目标请求 URL 或普通请求头；
- 目标 TLS 校验继续使用 Node 默认信任链，不因为启用代理而关闭证书校验；
- 不向目标服务器转发 `Proxy-Authorization`；
- 原有连接超时、响应空闲超时、客户端取消和 SSE 流式边界保持不变。

### 重定向

真实模型请求沿用当前“不自动跟随重定向”的行为。代理测试也不自动跟随重定向，直接返回 3xx 状态码，确保测试结果对应用户填写的目标。

### WebSocket 扩展

未来实现 [websocket-transport.md](./websocket-transport.md) 时：

- WS/WSS 握手必须使用同一代理策略和 bypass 规则；
- WS 客户端复用共享出站连接器提供的底层连接能力；
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
    participant Connector as 出站连接器

    UI->>API: 保存 Settings
    API->>Store: updateSettings
    Store-->>UI: 返回规范化后的 Settings
    Note over UI,Store: 代理设置变化不重启本地监听服务
    Request->>Connector: 发起目标 URL 请求
    Connector->>Store: 读取最新代理模式
    alt direct
        Store-->>Connector: 强制直连
    else system
        Store-->>Connector: session.resolveProxy 结果
    else custom
        Store-->>Connector: 自定义代理 URL 或 bypass 直连
    end
    Connector-->>Request: 选择并复用底层连接
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

- 三种代理模式的默认值、互斥选择和配置校验；
- 代理 URL 的合法协议、无效协议、带账号密码、端口和多余 URL 部分；
- bypass 的精确主机、域名后缀、端口、大小写、IPv4 和 IPv6；
- 代理 URL 脱敏函数不得输出用户名、密码或查询参数；
- `getProxyForUrl` 在 direct、system、custom bypass 和 custom proxy 状态下返回正确结果；
- Chromium `DIRECT`、`PROXY`、`HTTPS`、`SOCKS`、`SOCKS4` 规则转换及未知规则错误；
- 配置变化后新请求读取最新值，测试草稿实例销毁且不修改运行配置；
- 带账号密码的代理 URL 完整持久化及导入导出，日志和错误仍保持脱敏；
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

- 三态控件正确切换直连、系统代理和自定义代理；
- 仅自定义模式显示地址与绕过输入框；
- 测试使用当前草稿而不是已保存设置；
- 请求期间禁用重复操作；
- 成功展示 route、状态码和耗时；
- 失败展示稳定错误，不回显代理账号密码；
- 保存代理设置不会重启本地服务；监听地址或端口变化仍会重启。

## 验收标准

- [ ] 用户可以明确选择不使用任何代理、使用系统代理或自定义代理
- [ ] 新安装及旧配置缺少代理模式字段时默认使用系统代理
- [ ] 不使用任何代理时强制直连，不读取系统代理或代理环境变量
- [ ] 系统代理模式遵守操作系统静态代理、PAC 和 DIRECT 解析结果
- [ ] 自定义模式支持 HTTP、HTTPS、SOCKS4 和 SOCKS5 代理地址
- [ ] 自定义代理 URL 允许携带用户名和密码并可完成代理认证
- [ ] 不合法 URL、未知协议和非法端口无法保存或测试
- [ ] 默认绕过 localhost、127.0.0.1 和 ::1，本地模型访问不受影响
- [ ] 普通模型请求、SSE 请求、模型连接测试和模型列表获取均遵守同一代理设置
- [ ] 测试按钮使用未保存草稿，并展示 direct/system/custom route、状态码和耗时
- [ ] 代理不可达、407、CONNECT 拒绝、目标不可达和超时具有可区分的错误提示
- [ ] 代理阶段失败不会错误冷却单个 Provider 或 ProviderModel
- [ ] 保存代理设置后新请求立即生效，无需重启本地监听服务
- [ ] 修改监听地址或端口时仍按现有流程重启本地代理服务
- [ ] 配置导入导出完整保留代理模式、自定义 URL、账号密码和绕过规则，旧 schema version 3 配置仍可导入
- [ ] 运行日志、请求日志、错误消息和测试结果不出现代理认证凭据
- [ ] `pnpm typecheck`、`pnpm lint` 和完整测试通过
