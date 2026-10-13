# 插件机制（Plugin）

> **本文负责插件产品语义与实现契约。** 插件是「Provider 的供给层」：它只负责**产出**一条
> Provider 记录（端点、密钥、模型清单），产出之后代理、调度、协议转换、日志、健康全部复用
> 现有机制，**一行不改**。首次落地的能力只有一种：**自定义供应商**（`capabilities: ['provider']`）。
>
> **当前实现是 P0（供给层）**：§1–§13 描述的就是它，代码已经跑通。
> **P1（插件即上游一跳）已设计未实现**，见 §14：那时插件不再只是供给层，而是**上游那一跳的实现者**——
> 但只在它自己注册的供应商上生效。

## 1. 定位与不变量

- 插件**不是**代理内核的扩展点。它不参与候选过滤、不参与协议转换、不参与调度排序。
  （**P1 只放开一处**：见 §14，插件可以顶替这一跳的**传输实现**，但候选过滤、协议转换与调度排序
  仍然不参与。）
- 对于「plan 订阅型供应商」这类场景，插件的职责是把订阅登录、计划授权和目标服务商接口统一成一个可用的 Provider。它在 `obtainCredential` 中拿登录态，在 `listModels` 中拿真实模型清单，在 `resolveRequest` 中在请求真正发生前才决定最终上游 `url` 和 `Authorization`，而不是在同步阶段把所有值写死。
- 插件只做两件事：**拿到一把可用的 API Key**，**拿到一份模型清单**。其余交给现有 CRUD
  （`createProvider` / `replaceProviderEndpoints` / `createProviderModelRoute` / `upsertSchedulingPolicy`）。
- 宿主边界：插件代码**只在 core 的 worker 沙箱里执行**。它不能碰数据库、不能直接读密钥、
  不能直连网络——唯一出站口是宿主注入的 `http`（经 `coreNetworkClient`，因此复用出站代理设置）。
- 密钥红线不变：数据库里**只存引用**（`provider.apiKeyReference` 与
  `plugin::<key>::<input>` 形式的引用），明文一律进宿主 `SecretStore`（见
  [security-privacy.md](./security-privacy.md) 的「密钥存储」）。

## 2. 两层：声明式与可执行

同一套清单、同一个界面，复杂度递进：

| 层 | 形态 | 能做什么 | 适合 |
| --- | --- | --- | --- |
| **L0 声明式** | 只有 `plugin.json` | 声明 `endpoints`（协议 → URL 模板）+ `models`（一个可插值的 models 地址），用户手填 Key | 任何 OpenAI 兼容服务；不用写代码 |
| **L1 可执行** | `plugin.json` + `entry.js` | 用代码拿 Key（OAuth / 设备码 / 轮询）、拉模型、多账户 | 需要「代码获取 apikey」「接入第三方免费/代管服务」的场景 |

两层**共用**完成后的同步引擎、托管标记、管理接口与界面。L0 是 L1 的真子集：
L0 的 `endpoints` / `models` 在 L1 里可以完全由 hook 覆盖。

## 3. 插件形态（一个目录）

```
<pluginsDir>/<key>/
├── plugin.json      # 必需：清单（下一页）
├── entry.js         # 可选：可执行 hook（无它即 L0）
└── icon.svg         # 可选：品牌图标（取不到就用通用图标）
```

`pluginsDir` = `<数据目录>/plugins`（开发档 `~/.osw-development/plugins`），由宿主的
`RuntimeConfig.pluginsDirectory` 给出。**仓库内置插件不落这个目录**——它只放用户安装/自建的插件；
内置厂商仍走 `packages/console/source/catalog/providers/`（见 [provider-model.md](./provider-model.md)）。

## 4. 清单 `plugin.json`

```jsonc
{
  "manifestVersion": 1,
  "key": "acme-free",                       // ^[a-z][a-z0-9-]*$，唯一
  "name": "Acme Free",
  "description": "免费模型聚合渠道",
  "homepage": "https://acme.example",       // 可选
  "providerName": "Acme Free",              // 自动创建的 Provider 显示名
  "capabilities": ["provider"],             // 首期只有 provider
  "entry": "entry.js",                      // 可选，默认 entry.js；文件不存在即声明式

  // 动态表单：渲染成设置项，值持久化（secret=true 的进 SecretStore，不进配置库）
  "inputs": [
    { "key": "serverUrl", "label": "服务地址", "type": "url", "required": true },
    { "key": "apiKey", "label": "API Key", "type": "password", "secret": true }
  ],

  // 端点模板：{{inputKey}} 会被插值；协议取自 ProtocolSchema
  "endpoints": {
    "openai-completions": "{{serverUrl}}/v1/chat/completions"
  },

  // 声明式模型列表拉取（无 entry.js 时生效）
  "models": {
    "url": "{{serverUrl}}/v1/models",
    "method": "GET",
    "path": "data[].id"                     // 取值路径；缺省按常见形状（data[].id / models[].id / [].id）自动探测
  }
}
```

字段契约以 `packages/contracts/source/plugin.ts` 的 `PluginManifestSchema` 为准（zod）。
**清单是纯数据，落在 `contracts`，不得 import 任何 Node 内置模块。**

## 5. Hook 契约（`entry.js`）

`entry.js` 的**求值结果**是一个 hooks 对象。写法约定：脚本体是一个返回对象的函数体：

```js
// entry.js
return {
  async obtainCredential(ctx) { /* ... */ },
  async listModels(ctx) { /* ... */ },
  async resolveRequest(ctx) { /* ... */ },
}
```

沙箱只注入一个 `ctx` 参数，**没有 `require` / `import` / `eval` / `Function` / 定时器 / 文件系统**：

```ts
interface PluginContext {
  inputs: Record<string, string>              // 用户在设置页填的非密钥项
  secrets: {                                  // 命名空间限本插件，引用形如 plugin::<key>::hook::<name>
    get(name: string): Promise<string | null> // 先找 hook 自己写的，再回退到同名 secret 输入项
    set(name: string, value: string): Promise<void>
    delete(name: string): Promise<void>
  }
  storage: {                                  // 插件私有持久化，在 SecretStore 里（引用 plugin::<key>::storage::<name>）
    get(name: string): Promise<string | null>
    set(name: string, value: string): Promise<void>
  }
  http(request: {                             // 唯一出站口，经 coreNetworkClient + 出站代理
    method?: string; url: string
    headers?: Record<string, string>; body?: string
  }): Promise<{ status: number; headers: Record<string, string>; body: string }>
  log(level: 'log' | 'warn' | 'error', message: string): void
  now(): number
}
```

三个 hook（都可选，但至少要有一个能与声明式回退配合）：

```ts
obtainCredential?(ctx): Promise<CredentialResult>
listModels?(ctx): Promise<{ models: Array<{ id: string; name?: string }> }>
resolveRequest?(ctx): Promise<PluginRequestResolutionResult>
```

`PluginRequestResolutionResult` 是**每次真实请求**都会问一次的那一份答案（同步阶段根本不会调用它）：

```ts
type PluginRequestResolutionResult = {
  url?: string                            // 最终真上游地址，缺省用同步阶段定下的端点
  apiKey?: string                         // 当前订阅账户对应的临时凭据
  customAuthHeader?: string               // 换密钥落在哪个头（如从 authorization 换成 x-api-key）
  headers?: Record<string, string>        // 附带的其他头（组织标识、租户 ID 等）
}
```

`resolveRequest` 的 `ctx.request` 是这次请求的投影（`plugin.ts` 的 `PluginRequestContextSchema`）：
`logicalModelId` / `providerModelId` / `providerModelName` / `protocol` / `method` / `path` / `headers` /
`body` / `url`（同步阶段定下的那个端点）。没有 `resolveRequest`（或它回了空对象）时，请求按同步
阶段写下的端点与密钥发出。

`CredentialResult` 是四态联合，把「代码要 Key」变成可交互流程：

```ts
type CredentialResult =
  | { status: 'ready'; apiKey: string; endpointOverrides?: Partial<Record<Protocol, string>> }
  | { status: 'input-required'; fields: PluginInputField[] }   // 界面弹补充表单
  | { status: 'action-required'; instruction: string; actionUrl?: string; pollIntervalMs?: number } // 打开授权页 + 轮询重跑
  | { status: 'failed'; message: string }
```

失败语义：
- hook 抛异常 / 超时 → 本次同步失败，`plugin.state.lastSyncError` 记录，**不动已有配置**
  （不删模型、不改端点），下一次同步可重试。
- `obtainCredential` 返回 `input-required` / `action-required` → 同步暂停在该状态，
  以**已有**密钥/端点继续可用（不把 provider 改坏）。
- `listModels` 返回空数组 → 视为「供应商当前没有模型」，**不清理**已有模型（只有成功拿到非空
  清单时才做 diff 删除），避免一次上游抖动把用户的模型全删了。

## 6. 执行与隔离（worker）

- 插件脚本在 **`worker_threads`** 里执行（**不是**主线程 `node:vm`）：因为插件会 `await` 网络，
  而 `node:vm` 的 `timeout` 只能中断同步循环、**打不断 await**。worker 可以由宿主
  `worker.terminate()` **硬杀**，同时通过 `resourceLimits` 限内存。
- worker 内部再用 `node:vm` 的 `createContext` 关掉 `codeGeneration`（`strings: false` / `wasm: false`），
  与路由脚本沙箱同一策略（见 [security-privacy.md](./security-privacy.md) §路由脚本沙箱）。
- 宿主 API（`http` / `secrets` / `storage` / `log`）以 **RPC 桥**暴露：沙箱里发一条消息、
  等宿主回一条消息，沙箱侧**拿不到**任何宿主对象。
- 每次 hook 调用有超时（默认 30s，清单可用 `timeoutMilliseconds` 覆盖），超时即 `terminate`。
- 执行入口抽象为 `PluginRunner`，内部实现（worker）对调用方不可见——将来换更强的隔离不改调用方。

## 7. 数据落点（不新增表）

托管关系与状态全部复用 `provider_settings`（现有 KV，`upsertProviderSetting`），
挂在**被托管的 Provider** 行上：

| key | 值 |
| --- | --- |
| `plugin.key` | 插件 key（这一行的存在 = 这个插件已启用并托管了一个 Provider） |
| `plugin.inputs` | JSON：非密钥输入项的值 |
| `plugin.state` | JSON：`PluginSyncState` —— `{ credentialStatus, credentialMessage, actionUrl, credentialFields, lastSyncTime, lastSyncError, modelCount, secretReferences }` |

密钥：
- Provider 的 API Key → `provider.apiKeyReference`（现有机制）。
- 插件声明的 `secret: true` 输入项 → SecretStore 引用 `plugin::<key>::input::<inputKey>`。
- hook 通过 `ctx.secrets.set(name, value)` 写的 → SecretStore 引用 `plugin::<key>::hook::<name>`。
- `ctx.storage.set(name, value)` 写的（插件私有持久化，不是密钥但同样按引用取）→
  SecretStore 引用 `plugin::<key>::storage::<name>`。

`plugin.state.secretReferences` 记的是上面这些引用的**全称**：`SecretStore` 只能按引用取值、
没有「列出这个插件写过什么」的接口，不记全称就等于留下永远删不掉的密钥；卸载时逐个 `delete`。

**不新增数据库表**：这份设计刻意不引入 `plugins` 表——插件的身份是磁盘上的目录，
它的运行时状态本来就依附于它托管的 Provider。禁用插件 = 删除 Provider（级联清理）。
**不实施**迁移与历史兼容（见 [roadmap.md](./roadmap.md) 的「不考虑兼容」口径）。

## 8. 订阅型 plan provider 接入流程

对于 plan / SaaS 订阅型服务，插件通常要解决的不是单一固定的 API Key，而是一个更真实的链路：

1. 用户在插件里登录到 plan 账户，插件把 token、session 或 refresh token 存入 `ctx.secrets` / `ctx.storage`。
2. `obtainCredential` 负责把 plan 订阅中当前账号的授权态转换成该服务商接受的 credential；如需用户交互，也可以返回 `input-required` 或 `action-required`。
3. `listModels` 调用 plan 提供的服务商接口，把真实模型列表拉回来并以 `PluginModelListing` 形式写入 provider + model route。
4. 每次真实请求到达时，`resolveRequest` 依据 `ctx.request`，动态返回：
   - `url`：最终真上游地址；
   - `apiKey`：当前订阅账户对应的临时凭证；
   - `customAuthHeader`：自定义鉴权头（**换密钥落在哪个头**，例如从 `authorization` 换成 `x-api-key`）；
   - `headers`：随请求附带的其它头（组织标识、租户 ID 等）。

   `headers` 与 `customAuthHeader` 分工不同：前者是「多加一个头」，后者是「换个地方放密钥」。
   因此 `headers` **不能**覆盖鉴权头（`authorization` / `x-api-key` / `x-goog-api-key`，以及 `customAuthHeader`
   的落点）、逐跳头与 `host` / `content-length`——这些由链路统一决定。这条规则只写在
   [packages/core/source/proxy/response/headers.ts](../../packages/core/source/proxy/response/headers.ts)
   一处，`attempt-preparation.ts` 只负责把 `ctx.request` 解析出来的头原样递过去。
5. 运行时链路在 [packages/core/source/proxy/execution/attempt-preparation.ts](../../packages/core/source/proxy/execution/attempt-preparation.ts) 里取最终 `target`、`apiKey`
   与附加 `headers`，因此插件不需要参与路由选择、调度排序，也不需要改现有 proxy 代码。

换句话说，插件的“生产物”仍然是一个标准 Provider，而真正的 plan 级动态鉴权发生在请求时，正好契合“按请求动态提供 URL + API Key”的要求。

## 9. 同步引擎

```
enablePlugin(key, inputs)     写 inputs（secret → SecretStore）→ ensureManagedProvider → syncPlugin
syncPlugin(key)               先 ensureManagedProvider → obtainCredential → listModels → diff → 落 state
disablePlugin(key)            deleteProvider（级联软删模型/端点）+ 删密钥引用 + 显式删调度策略
setPluginInputs(key, values)  更新 inputs → 重新 syncPlugin
```

`ensureManagedProvider`：找 `plugin.key === key` 的 Provider；没有就
`createProvider` + `replaceProviderEndpoints` + 打标记；有就更新端点/密钥。

`syncPlugin` 的 diff（照搬「免费模型源」范式）：

1. `obtainCredential` → `ready` 则 `secretStore.set(provider.apiKeyReference, apiKey)` 并
   `updateProvider`；`endpointOverrides` 覆盖清单端点。
2. `listModels`（无 hook 时用声明式 `models` 拉取）→
   与 `listProviderModelRoutesByProvider(providerId)` 比对：
   - 新增：`createProviderModelRoute`（`endpointUrl: ''` 回退渠道默认端点）+ `upsertSchedulingPolicy`
     （priority 递增，挂在默认逻辑模型上）。
   - 消失：`deleteProviderModelRoute` + `deleteSchedulingPolicy`（**仅当清单非空**）。
3. 写 `plugin.state`（`lastSyncTime` / `modelCount` / `credentialStatus` / 错误）。
4. 模块级 `inFlight: Set<key>` 防并发。

**不注册后台定时器**（P0 刻意）：插件涉及第三方凭据，默认只由用户显式触发（启用 / 手动同步 /
打开插件页时按需刷新）。定时轮换与「距上次同步超过 N 小时自动同步」留待 P1，并要复用
[provider-model.md](./provider-model.md) 的设置项模式。

## 10. 管理接口

一组新路由（全 POST，`packages/core/source/management/routes/operations/plugins.ts`）：

```
POST /api/plugin/list                     → PluginView[]
POST /api/plugin/get          { key }
POST /api/plugin/install      { source }   # P0 只支持 { type: 'directory', path }
POST /api/plugin/uninstall    { key }      # 先 disable（删 Provider + 清密钥），再删插件目录
POST /api/plugin/enable       { key, inputs? }
POST /api/plugin/disable      { key }
POST /api/plugin/sync         { key }
POST /api/plugin/set-inputs   { key, inputs }
POST /api/plugin/reload       { key }      # 重读清单并重新同步；本地开发热重载用
POST /api/plugin/icon         { key }      # 可选 icon.svg 的原文；读不到回 null（不是错误）
```

`PluginView`（界面直接消费的聚合视图，事实源是 `packages/contracts/source/plugin.ts`
的 `PluginViewSchema`）：

```ts
interface PluginView {
  key: string; name: string; description: string
  homepage: string | null
  providerName: string; capabilities: PluginCapability[]
  /** 这个目录装不上（plugin.json 缺失/不合法/目录名对不上）：有值时其余字段是占位值。 */
  error: string | null
  executable: boolean                      // 清单带 entry.js
  dev: boolean
  enabled: boolean
  credentialStatus: 'none' | 'ok' | 'input-required' | 'action-required' | 'error'
  credentialMessage: string | null
  actionUrl: string | null
  /** 清单声明的字段 + hook 在 input-required 时动态要求的字段（清单在前）。 */
  inputs: PluginInputField[]
  inputValues: Record<string, string>      // 密钥项回占位符，不回明文
  hasSecrets: string[]                     // 已设置过值的密钥项 key（不是布尔）
  providerId: string | null
  modelCount: number
  lastSyncTime: number | null
  lastSyncError: string | null
}
```

两个容易看错的点：

- **没有 `installed`**：磁盘上的目录就是「已安装」，列表里出现即已安装。
- **`hasSecrets` 是 key 数组**而不是布尔：界面据此知道「哪几个密钥项已经设过了」，
  只回一个布尔就分不出是哪一个。

**必填项缺失的两种落法**（刻意分开，别把它们合成一句「同步失败」）：

- **`apiKeyInput` 指向的密钥项没填** → `credentialFromManifest` 回 `input-required`，是**中间态**：
  界面据此给出「去填一下」的入口（复用 `PluginSyncState.credentialFields` 那一套动态表单），
  而不是一句无从下手的错误。
- **端点模板里还有没插上的 `{{...}}`** → 该条端点被**剔除**（`resolveEndpoints`），不原样落库：
  原样写会撞上 `ProviderEndpointSchema.url` 的 `z.string().url()`，用户看到的是一条通用校验错误，
  而真正该做的是回去填输入项。

判定规则收在 `state.ts` 的 `missingRequiredInputs` 一处（`required` 且非空判定：密钥项看「密钥库里
是否已有值」，其余看去空白后是否非空），**目前只有界面用它**做「启用」按钮的可用性；同步入口不做这道
前置校验（缺项最终表现为上面那两种落法）。

**错误码**（进 `ApiErrorCodeSchema`，文案英文，界面本地化）：
`PLUGIN_NOT_FOUND` / `PLUGIN_MANIFEST_INVALID` / `PLUGIN_ENTRY_MISSING` /
`PLUGIN_SOURCE_UNSUPPORTED` / `PLUGIN_RUN_FAILED` / `PLUGIN_TIMEOUT`。

## 11. 本地开发模式

目标：改一行 `entry.js`，点一下就能重跑，不用重启服务。

- **插件目录即源码目录**。开发时把 `pluginsDir` 指到你的仓库（或用 `install` 的
  `type: 'directory'` 指向源码目录，**以符号链接接入**而不是拷贝），改完代码无需重装。
- **`/api/plugin/reload`** 重新读取清单与 `entry.js` 并重新同步。清单里
  `"dev": true` 的插件，界面在详情页显示一个「重新加载」按钮（`reload`）。
- **worker 每次 hook 调用都新建并销毁**：因此**不缓存** `entry.js` 与 hook 结果，
  天然支持热重载——改文件后下一次调用就是新代码（worker 每次从磁盘读 `entry.js`）。
- **运行日志回传**：`ctx.log(...)` 与 hook 抛出的异常都进该次调用的结果，界面在
  「最近一次同步」里展示（与路由脚本的 trace 日志同一体验）。
- **不打包**：插件不需要构建步骤，`entry.js` 就是可直接运行的 JS。
- 校验前置：安装/重载时先 `PluginManifestSchema.parse`，清单不合法直接报
  `PLUGIN_MANIFEST_INVALID`，不把坏目录建进 Provider。

P1（已设计未实现）：从 GitHub 仓库安装——`{ type: 'github', repo, ref?, subdirectory? }`，
经 GitHub `git/trees` 取文件清单、`raw.githubusercontent.com` 逐个取回（**不引第三方 tar 依赖**），
复用同一套 `installPlugin` 落盘与校验。P0 对该类型明确回 `PLUGIN_SOURCE_UNSUPPORTED`，
**不做半个实现**。

## 12. 包边界

| 落点 | 内容 |
| --- | --- |
| `packages/contracts/source/plugin.ts` | 清单 / Hook / `CredentialResult` / `PluginView` 类型与 schema（纯数据，**禁 `node:`**） |
| `packages/core/source/plugins/` | `manifest.ts`（扫描+校验）/ `worker-source.ts` + `runner.ts`（沙箱）/ `sync-engine.ts` / `state.ts`（托管标记读写） |
| `packages/core/source/management/routes/operations/plugins.ts` | 路由组 |
| `packages/console/source/pages/plugins/` + `api/plugins.ts` + `data/plugins.ts` | 界面（**禁 `node:` / electron**） |
| `apps/app` & `apps/cli` | `RuntimeConfig.pluginsDirectory` |

## 13. 安全边界复核

- 插件代码**不注入任何宿主对象**：只有数据与三个 RPC 之后的能力函数。
- 插件**看不到**其他插件、其他 Provider 的密钥；`secrets` 命名空间限定为 `plugin::<key>::*`。
- 插件出站**只经 `http`**，因此受出站代理设置、超时与「请求/响应不设大小上限」的同一条口径约束；
  它**不是**遥测链路，不享受「唯一允许直连」的例外。
- worker 可终止、可限内存；`entry.js` 不能生成新代码。
- 卸载/禁用必须删除密钥引用（`secretStore.delete`）与调度策略（`deleteProvider` 不清理
  `scheduling_policies`，会留孤儿行）。

## 14. P1：插件即上游一跳

**状态：已设计未实现。** §1–§13 描述的是已落地的 P0；本节描述 P1 要放开的能力，以及随之而来的约束。

### 14.1 P0 的能力上限

P0 里插件只能产出「地址 + 密钥 + 几个头」，报文形状仍由核心决定。这对非标准接入商不够——问题不在换个地址，而在报文根本不同：

- 请求体不是三种协议之一 → `modifiers/request-modifiers.ts` 的 `body-prepare` 一定会先调
  `adapter.prepareRequest` 把 body 重排一遍；
- 响应体不是三种协议之一 → 没有 `Modifier` 能解析它；
- 流式与否由 `adapters/http-response-sink.ts` 的 `isEventStreamResponse` 读
  `content-type: text/event-stream` 判定；
- `protocolAdapters.resolve()` 是 3×3 的闭集，未知组合直接抛；
- 鉴权只能表达成「值 + 落在哪个头」。

补丁式的补法（开放 `Modifier`、加一个 `translate` hook、声明 `streamWhen`）每一条都要在内核再开一个口子，
而每开一个口子，「转发路径可判定」这条不变量就薄一层（理由见
[proxy-engine.md](./proxy-engine.md) 的「忠诚转发，不自适应」）。

### 14.2 结论：插件是 `Transport` 的第二个实现

`packages/core/source/proxy/contracts/transport.ts` 的 `Transport` 只有一个方法、一个返回值：

```ts
interface Transport {
  readonly transports: readonly TransportKind[]
  connect(target: UpstreamTarget, exchange: ExchangeView, attempt: AttemptView): Promise<UpstreamConnection>
}
interface UpstreamConnection {
  readonly frames: AsyncIterable<Frame>
  readonly outbound?: FrameSink          // 双向传输用（`websocket`），当前无实现
  abort(reason?: Error): void
}
```

`transports/http.ts` 的 `createHttpTransport` 是它的一个实现；**插件是第二个**。插件接收这次任务，
在**自己的 worker 里**发真实请求，把结果规范成标准 `Frame`（`head` / `data` / `end` / `error`）交回宿主，
之后照走核心那条搬运链路。

| 14.1 里列的缺口 | 换成插件即 `Transport` 之后 |
| --- | --- |
| 请求体被迫过 `adapter.prepareRequest` | 消失——请求不再经过 `body-prepare` |
| 响应体必须落进三种协议之一 | 消失——插件交的是 `Frame` |
| 流式靠 `content-type` 猜 | 消失——读什么由插件自己决定 |
| `resolve()` 的 3×3 闭集 | 消失——`resolve()` 不再被调用 |
| 鉴权只能「值 + 头名」 | 消失——凭据由插件自己放 |
| 逐 chunk 走 worker RPC 会毁掉流式 | 消失——每次交换只跨一次 worker 边界 |
| 慢的非流式上游要退化成「16KB/分钟 TPS」+ 空闲超时故障转移 | 消失 |

**代价必须一起接受**：出站代理 / 直连规则、连接复用（keep-alive）、空闲超时与 `abort`、
客户端断开时立刻拆上游——这四件事现在是 `http.ts` 的职责，交出去之后要么补回来，要么变成每个插件的义务。
补的办法见 §14.4。

### 14.3 边界：插件拥有什么、不拥有什么

| | 归属 |
| --- | --- |
| 上游这一跳的连接、报文形状、读法、翻帧 | 插件 |
| 下游分帧与 `content-length` | 核心（`http-response-sink.ts` 按 `mode` 决定整体缓冲还是增量转发） |
| 请求头合并顺序 | 核心（`proxy/response/headers.ts`） |
| 「这次交付还是丢弃」的判定时机 | 核心（`frame-pipe.ts` → `attempt-executor.ts`） |
| 候选过滤、协议转换、调度排序 | 核心（P1 也不动） |

三条必须说清楚的：

**（一）下游分帧不是插件的。** 出口不允许读上游响应头重新回答「是否边收边发」；下发给客户端的形态
由客户端跳的 `TransportKind` 在入口就定下（见 [proxy-engine.md](./proxy-engine.md) §1）。

**（二）头合并顺序只有一处。** `createUpstreamRequestHeaders` 的顺序是「客户端头 → 协议固定头（只补缺）
→ 凭据落点（覆盖客户端同名头）→ 额外头 → 重算 `content-length`」，`host` / `content-length` / 逐跳头
由链路统一决定。插件在 P0 里只能往「额外头」那一格加东西，`headers` 覆盖不了鉴权头、逐跳头与
`host` / `content-length`（§8 第 4 条）。

**（三）插件必须自己交出与下游预期一致的 `head`。** `kernel/frame-pipe.ts` 在跑修改器**之前**就调 `onHead`，
`execution/attempt-executor.ts` 在那一个回调里写下 `delivery.decision`（`discard` 还是 `deliver`），
所以状态码与分帧形态的判定发生在任何字节落地之前。P1 不需要给这里打补丁——**责任落在「谁拥有这条上游」**：
插件交出的 `head` 必须与它实际要给的 `body` 对得上。

### 14.4 出站：`ctx.http` 是握手口，不是转发口

`ctx.http` 现在落到 `runner.ts` 的 `performHttp` → `coreNetworkClient.requestHttpBuffered`，是**整份收发**的，
承载不了流式，因此插件转发**不能**复用它。宿主必须另外给一条**受管出站路径**：一个面向流的能力
（底层接 `coreNetworkClient.requestHttp`，因此仍然继承出站代理设置、目标校验与 `abort`），
插件在这条路径上开这次上游连接。

红线：**受管的 `ctx.transport.*` 允许，裸 `fetch` 禁止。** 两条理由：绕过出站代理与绕过规则
（与 [telemetry.md](./telemetry.md) 里「本地服务是唯一允许直连的例外」同一类信任问题）；
绕过 `abort()`（宿主只剩 `terminate()` 一条路，上游连接会被泄漏）。

这条红线的实现面是**默认成立**的：worker 沙箱的上下文由 `worker-source.ts` 用一个字面量对象建出来，
里面没有 `fetch`、没有 `Buffer`、也没有 `TextDecoder`。写在这里是为了拦住将来「顺手给沙箱补个 `fetch`」。
同一原因，worker 与宿主之间只走 JSON 文本，**二进制响应体不进插件的处理范围**。

### 14.5 门：能力只能在自己注册的供应商上生效

台账是 §7 的那三行 `provider_settings`（`plugin.key` 存在 = 这个插件托管了这个 Provider）。
要把「只在自己注册的供应商上生效」做成事实而非校验，得先堵三个洞：

**（一）`plugin.*` 现在会被供应商包带出去。** `export-provider-bundle.ts` 的
`MANAGED_PROVIDER_SETTING_KEYS` 只有 `security.secretReference` 与 `connection.timeoutMilliseconds`，
`buildProviderEntry` 会导出其余全部键，所以插件痕迹会随备份到另一台机器；而 `plugins.ts` 的 `buildView`
对任意 `providerId` 都能 `readPluginSyncState`。P0 无害（插件只给地址和密钥），P1 致命（插件要拥有连接）。
结构修法：给 `provider_settings` 加一列 `owner`（`user` | `plugin:<key>`），哨兵行与导出过滤读**同一列**
——与 `POSITION_HEADERS`、`bodyDeliveryShape` 一样，「靠结构，不靠自觉」。需要一次建表迁移，
按仓库既有迁移模式做。

**（二）`providerId` 是执行期的门，不是绑定期的门。** 今天能用，只因为 `resolveRuntimePluginTarget`
恰好是拿 `target.providerId` 去查 `plugin.key`。破坏它的三件事：故障转移换目标（门必须**逐 target** 判，
不能提到循环外）、复制 Provider 会连带复制 `plugin.key`、导入供应商包会连带带进 key（扩展还没启用）。
修法：收成**一个具名函数**（暂名 `pluginOwnerOf(providerId)`），并要求**每一个**从 `target.providerId`
派生的运行值——插件、密钥引用、inputs、传输实现——都经它取。派生值一律不许自己再查一次台账。

**（三）`Transport` 在执行期门不了。** `transports/registry.ts` 的
`resolveTransportImplementation(resolution: TransportResolution)` **拿不到 `target`**，而 `connect(target, …)`
又太晚（连上之后才知道该不该连）。
**结论：门开在规划期。** 插件传输做成**每 Provider 一个实例**（`createPluginTransport(ctx)`），
由 `TargetPlanner` 在规划期挂到 `UpstreamTarget` 上——别的 Provider 根本不会拿到插件 target。
这一条把「只能在自己注册的供应商上生效」从校验变成了结构事实，顺带解决「规划器要给插件 target 填
`apiKeyReference` / `customAuthHeader` 这类核心字段的假值」的别扭。

两条具名规则：

> **R1**：任何以插件身份取得的运行时权力，都必须从「被托管的 Provider」这一条台账反查而来；
> 反查失败即无权力，回退到核心实现。
>
> **R2**：插件的上游连接由 planner 从被托管 Provider 造出，插件不参与「给定任意目标选实现」；
> `ctx.http` 是握手口，不是转发口。

R1 的两条执行期硬约束：

- **门只读台账，不顺手校验插件目录是否存在。** 否则「禁用」就得先删 Provider，「卸载」就没有东西可删。
  目录存在性该由 `loadPlugin` 在真正加载那一刻拒绝。
- **`resolveRuntimePluginTarget` 每次尝试跑一次，不许在那里加 IO。** `getProviderSetting` 读的是进程内
  sqlite（不是每次尝试的 IPC），但门必须**复用同一次读**，不能另开一次。

### 14.6 待定（本节不替你决定）

- **一个插件管几个 Provider。** 今天两种读法同时存在：`state.ts` 的 `findManagedProviderId` 取第一个匹配，
  而 `readManagedProviderIds` 让后来的覆盖先前的，`markManagedProvider` 也不强制 1:1。这决定 R1 的签名是
  `pluginOwnerOf(providerId)` 还是 `pluginsForProvider(providerId)`，也决定 `plugin.key` 要不要索引。
- **`host` / `content-length` 归谁。** 完全交给插件最省事，但等于允许插件伪造 `Host`；另一条路是把合并
  规则转发给插件（客户端头与目标地址它都拿得到），由它按同一规则自己算一遍。
- **`resolveRequest` 的去留。** 它现在是 P0 的轻量形态。P1 落地后，它是被 `connect` 完全取代，还是保留成
  「声明式插件不想写连接代码」的快捷方式。

## 15. 与其它文档的关系

- Provider / 端点 / 逻辑模型 / 调度绑定的实体语义：见 [provider-model.md](./provider-model.md)。
- 脚本沙箱的通用边界（路由脚本那份）：见 [security-privacy.md](./security-privacy.md)。
- 新页面的路由、侧栏与 i18n 约定：见 [desktop.md](./desktop.md)、[i18n.md](./i18n.md)。
- 进度与验收状态：见 [roadmap.md](./roadmap.md)。
