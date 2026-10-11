# 插件机制（Plugin）

> **本文负责插件产品语义与实现契约。** 插件是「Provider 的供给层」：它只负责**产出**一条
> Provider 记录（端点、密钥、模型清单），产出之后代理、调度、协议转换、日志、健康全部复用
> 现有机制，**一行不改**。首次落地的能力只有一种：**自定义供应商**（`capabilities: ['provider']`）。

## 1. 定位与不变量

- 插件**不是**代理内核的扩展点。它不参与候选过滤、不参与协议转换、不参与调度排序。
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
}
```

沙箱只注入一个 `ctx` 参数，**没有 `require` / `import` / `eval` / `Function` / 定时器 / 文件系统**：

```ts
interface PluginContext {
  inputs: Record<string, string>              // 用户在设置页填的非密钥项
  secrets: {                                  // 命名空间限本插件，引用形如 plugin::<key>::<name>
    get(name: string): Promise<string | null>
    set(name: string, value: string): Promise<void>
  }
  storage: {                                  // 插件私有持久化（token 缓存等）
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

两个 hook（都可选，但至少要有一个能与声明式回退配合）：

```ts
obtainCredential?(ctx): Promise<CredentialResult>
listModels?(ctx): Promise<{ models: Array<{ id: string; name?: string }> }>
```

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
| `plugin.state` | JSON：`{ credentialStatus, credentialMessage, actionUrl, lastSyncTime, lastSyncError, modelCount, hookSecretKeys[] }` |

密钥：
- Provider 的 API Key → `provider.apiKeyReference`（现有机制）。
- 插件声明的 `secret: true` 输入项 → SecretStore 引用 `plugin::<key>::input::<inputKey>`。
- hook 通过 `ctx.secrets.set(name, value)` 写的 → SecretStore 引用 `plugin::<key>::hook::<name>`。

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
   - `customAuthHeader`：自定义鉴权头；
   - `headers`：如需要附加 `Authorization`、组织标识、租户 ID 等。
5. 运行时链路在 [packages/core/source/proxy/execution/attempt-preparation.ts](../../packages/core/source/proxy/execution/attempt-preparation.ts) 里取最终 `target` 与 `apiKey`，因此插件不需要参与路由选择、调度排序，也不需要改现有 proxy 代码。

换句话说，插件的“生产物”仍然是一个标准 Provider，而真正的 plan 级动态鉴权发生在请求时，正好契合“按请求动态提供 URL + API Key”的要求。

## 8. 同步引擎

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

## 9. 管理接口

一组新路由（全 POST，`packages/core/source/management/routes/operations/plugins.ts`）：

```
POST /api/plugin/list                     → PluginView[]
POST /api/plugin/get          { key }
POST /api/plugin/install      { source }   # P0 只支持 { type: 'directory', path }
POST /api/plugin/uninstall    { key }      # 只删插件目录，不删已建 Provider（先 disable）
POST /api/plugin/enable       { key, inputs? }
POST /api/plugin/disable      { key }
POST /api/plugin/sync         { key }
POST /api/plugin/set-inputs   { key, inputs }
POST /api/plugin/reload       { key }      # 重读清单并重新同步；本地开发热重载用
```

`PluginView`（界面直接消费的聚合视图）：

```ts
interface PluginView {
  key: string; name: string; description: string; homepage?: string
  providerName: string; capabilities: PluginCapability[]
  installed: boolean
  enabled: boolean
  credentialStatus: 'none' | 'ok' | 'input-required' | 'action-required' | 'error'
  credentialMessage?: string; actionUrl?: string
  inputs: PluginInputField[]
  inputValues: Record<string, string>      // 密钥项回占位符，不回明文
  hasSecrets: boolean
  providerId: string | null
  modelCount: number
  lastSyncTime: number | null
  lastSyncError: string | null
}
```

**错误码**（进 `ApiErrorCodeSchema`，文案英文，界面本地化）：
`PLUGIN_NOT_FOUND` / `PLUGIN_MANIFEST_INVALID` / `PLUGIN_ENTRY_MISSING` /
`PLUGIN_SOURCE_UNSUPPORTED` / `PLUGIN_RUN_FAILED` / `PLUGIN_TIMEOUT`。

## 10. 本地开发模式

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

## 11. 包边界

| 落点 | 内容 |
| --- | --- |
| `packages/contracts/source/plugin.ts` | 清单 / Hook / `CredentialResult` / `PluginView` 类型与 schema（纯数据，**禁 `node:`**） |
| `packages/core/source/plugins/` | `manifest.ts`（扫描+校验）/ `worker-source.ts` + `runner.ts`（沙箱）/ `sync-engine.ts` / `state.ts`（托管标记读写） |
| `packages/core/source/management/routes/operations/plugins.ts` | 路由组 |
| `packages/console/source/pages/plugins/` + `api/plugins.ts` + `data/plugins.ts` | 界面（**禁 `node:` / electron**） |
| `apps/app` & `apps/cli` | `RuntimeConfig.pluginsDirectory` |

## 12. 安全边界复核

- 插件代码**不注入任何宿主对象**：只有数据与三个 RPC 之后的能力函数。
- 插件**看不到**其他插件、其他 Provider 的密钥；`secrets` 命名空间限定为 `plugin::<key>::*`。
- 插件出站**只经 `http`**，因此受出站代理设置、超时与「请求/响应不设大小上限」的同一条口径约束；
  它**不是**遥测链路，不享受「唯一允许直连」的例外。
- worker 可终止、可限内存；`entry.js` 不能生成新代码。
- 卸载/禁用必须删除密钥引用（`secretStore.delete`）与调度策略（`deleteProvider` 不清理
  `scheduling_policies`，会留孤儿行）。

## 13. 与其它文档的关系

- Provider / 端点 / 逻辑模型 / 调度绑定的实体语义：见 [provider-model.md](./provider-model.md)。
- 脚本沙箱的通用边界（路由脚本那份）：见 [security-privacy.md](./security-privacy.md)。
- 新页面的路由、侧栏与 i18n 约定：见 [desktop.md](./desktop.md)、[i18n.md](./i18n.md)。
- 进度与验收状态：见 [roadmap.md](./roadmap.md)。
