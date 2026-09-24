# 配置云同步

## 文档状态

本文定义 OSW「配置云同步」的产品与技术契约。契约分两层：`packages/contracts/source/cloud-sync.ts`（同步什么、怎么管）与 `packages/contracts/source/cloud-backup.ts`（一种承载方式要回答什么）；服务端编排在 `packages/core/source/management/cloud-sync/`，具体后端在它的 `backends/` 下；管理 API 为 `/api/cloud-sync/*`，设置页在运行设置的分区「云同步」里。本文同时作为行为契约与验收依据。

## 背景与目标

OSW 的配置（供应商、上游模型、逻辑模型与它们的排队顺序）只存在本机。用户换一台机器、或在台式机与笔记本之间来回时，只能靠导出供应商包再导入，而逻辑模型和绑定并不在那个包里，等于重建一遍。

本功能让用户把自己的一份配置放在**他自己**的第三方云存储上（首个承载方式是 GitHub Gist），在新机器上点一次拉取就能接着用。

目标是：

- 不引入账号体系，不需要我们运营任何服务器；
- 用户能看懂数据被放到了哪里、由谁保管；
- 上传与拉取都是用户主动触发的一次动作，不做后台定时同步；
- 远端文件不是能直接读的明文：整份快照做一次 base64 编码，落盘后一眼看不出内容；
- 换台机器拉一次就能用，包括各供应商的 API Key（不带密钥的话“能接着用”只成立一半）；
- **换一个云存储不用重做界面**：装载方式是可插拔的。

## 术语与边界

| 名称 | 说明 |
| --- | --- |
| 快照（snapshot） | 一份可移植的配置描述，即远端那一个文件 |
| 承载方式（后端） | 快照存在哪。当前只有 GitHub Gist，接口按可插拔设计（见「承载方式（后端）」） |
| 凭据（credential） | 向后端证明「我是我」的那串东西。Gist 上是用户自建、只勾了 `gist` 权限的细粒度 PAT |
| 远端句柄（target） | 快照具体放在哪。Gist 上是那个 Gist 的 id；未绑定时首次上传可自动新建 |

流量方向是**本机直连所选后端**：`packages/core` 经共享出站连接器访问它的 API（Gist 是 `api.github.com`），因此受用户的[上游出站代理](./outbound-proxy.md)设置约束。我们不参与、不中转、也不知道用户同步了什么。

### 首版范围

- 供应商与上游模型（复用供应商包格式），**含各供应商的 API Key**；
- 逻辑模型（id、名称、说明、启用状态）与它们的顺序；
- 逻辑模型到上游模型的绑定（优先级、启用状态）；
- 手动上传、手动拉取；
- 凭据的保存、清除与「能不能用」的校验；
- 远端的绑定与在浏览器中打开。

**已实现的后端只有 GitHub Gist 一种。** 界面上能看到一个「存储方式」下拉，它自己不会长出第二项——选项来自服务端的注册表。

### 非目标

- **不包含应用设置**（监听地址、出站代理、界面偏好等）。设置是本机环境的属性，把它同步过去等于替另一台机器做决定；
- **只做编码，不做加密**。base64 不是密码学手段，它只是让远处那个文件不一眼可读；拿到文件的人解一下就能还原全部内容，包括 API Key。要做到真正的保密需要引入密钥派生与用户口令，那是另一件事，不在本版；
- 不包含请求日志、用量统计与观测数据；
- 不做自动/定时/后台同步，不做冲突检测与合并，不做多设备实时协同；
- 不实现 Git 仓库、WebDAV、对象存储等其它后端。接口已经按可插拔办好（见「承载方式（后端）」），但每加一种都要有人写、有人维护，所以它们是后续的单独立项，不是这里的承诺；
- 不做 OAuth 授权与设备码登录：凭据由用户自己签发并粘贴。

## 承载方式（后端）

「快照存在哪」是一件可以换掉的事，因此它被收在一个接口后面：

```typescript
// packages/core/source/management/cloud-sync/backends/contract.ts
interface CloudBackupProvider {
  readonly descriptor: CloudBackupDescriptor                        // 给界面看的自述
  normalizeTarget(raw: string): string                              // 用户粘进来的地址 → 规范句柄
  targetUrl(target: string): string                                 // 句柄 → 可以在浏览器打开的地址
  verifyCredential(credential: string): Promise<string>             // 这串凭据是谁？顺带验活
  readDocument(scope: CloudBackupScope, fileName: string): Promise<string | null>
  writeDocument(scope: CloudBackupScope, document: CloudBackupDocument): Promise<CloudBackupWriteResult>
}
```

几个刻意的选择：

- **每种后端只有两个槽位**：凭据与远端句柄。Gist 是「令牌 + Gist id」，WebDAV 会是「密码 + 目录」，对象存储会是「密钥 + 桶/前缀」。界面因此只需要一套控件，不必为每种后端写一份表单。
- **读不到文件返回 `null` 而不报错**：这是正常状态（还没上传过），把它变成错误是编排层的策略，不是后端的结论。
- **`descriptor` 里放的是文案 key，不是句子**：界面拿 key 去查目录。后端因此能带上自己的措辞，而界面里没有一行属于某个具体后端的文案。
- **注册表是手写的**（`backends/index.ts` 里的一个 `Record`）：加一个后端等于「多一条出网路径 + 多一套凭据处理」，这该是一次看得见的决定，而不是「多放一个文件就自动生效」的副作用。
- **凭据按 `kind` 分开存**（密钥库引用为 `cloud_backup_credential.<kind>`）：换到别的后端再换回来，旧凭据还在。远端绑定与两个时间戳则属于上一个后端，换的时候一起清掉。

接一种新的承载方式，改动量是：契约枚举加一项 + `backends/` 下加一个实现 + 注册表加一行 + 目录里补几段文案。**界面与编排层不用动。**

一个已知的边界：接口给的是「按名字读/写一个文件」，所以后端必须能按名字存取单个对象；只支持「整库覆盖」的存储不适合这套接口。

## 产品交互

运行设置页在「数据」之后新增分区「云同步」，内含一张卡片，分四行：**存储方式、凭据、远端、备份与恢复**。后三行的标题、行内说明与占位符都来自所选后端自述里的 key，界面不写死任何后端的措辞。

卡片头右侧有一个状态徽标（`已连接` / `未连接`），不必逐行看完就知道这张卡现在是不是配好了。

### 第 1 行：存储方式

| 元素 | 行为 |
| --- | --- |
| 存储方式下拉 | 选项来自服务端回的 `providers`（即注册表），当前项是 `provider` |
| 切换方式 | 清掉上一个后端的远端绑定与两个时间戳；**凭据不清** |

**换方式会清掉旧绑定。** 一个 Gist id 当 WebDAV 目录毫无意义，留着只会变成「已绑定」的假象。凭据不清，因为它本来就属于那个后端自己，换回来还要用。重复选中同一个方式是空操作——手滑一下不该丢掉绑定。

### 第 2 行：凭据

| 元素 | 行为 |
| --- | --- |
| 凭据输入框 | `type=password`，等宽字体；值只留在组件本地状态里，不进入设置草稿 |
| 连接 | 未连接时的主按钮；先联网校验再落库，成功后清空输入框 |
| 更换凭据 | 已连接时出现；点开才把输入框放回来（按钮这时变成「保存」），旁边给一个「取消」 |
| 忘记凭据 | 仅在已连接时出现；从密钥库删除，并清空已记录的账号名 |

**已经配好就不再摆输入框。** 未连接时这一行是「输入框 + 连接」，说明区显示后端给的提示（Gist 是「只需 `gist` 权限」）；一旦连上，输入框收起，说明区换成账号名（`已连接为 @login`），控件只剩「更换凭据 / 忘记凭据」。一个空输入框摆在「已连接为 @x」旁边，谁也说不清它是要改、还是没填完。

已连接但没有账号名时，说明区显示「凭据已保存，但还没校验过」。

**保存前先校验**：一个错凭据如果能存进去，用户要等到第一次备份时才看到报错，而那时报错离他刚才的动作已经很远。校验顺带拿到账号名，界面因此能立刻显示「已连接为谁」。

### 第 3 行：远端

| 元素 | 行为 |
| --- | --- |
| 远端输入框 | 未绑定时出现；内容由后端自己解析；留空并绑定视为解绑 |
| 绑定 | 交给后端的 `normalizeTarget` 规范化后写入设置 |
| 更换位置 | 已绑定时出现；点开才把输入框放回来（预填当前值），旁边给一个「取消」 |
| 在浏览器打开 | 仅在已绑定时出现；用系统浏览器打开后端给出的 `targetUrl` |
| 解除绑定 | 仅在已绑定时出现；以空值写入 `target`，等价于「留空并绑定」 |

与凭据行同一套规则：绑好之后这一行只报告「绑在哪儿」，输入框收起来。

**允许直接粘贴链接**：让用户认识到「地址栏里的东西可以直接粘」比教他手动挑出标识符容易得多。链接可能带锚点或查询串，解析时由后端先切掉再取标识符。

**绑定时清零「上次同步时间」**：那两行时间属于旧绑定的历史，留着会让人以为新绑定的远端已经同步过了。

### 第 4 行：备份与恢复

| 元素 | 前置条件 |
| --- | --- |
| 备份到云端 | 已连接凭据；远端未绑定时还要后端支持 `createsTarget`（按钮此时叫「备份并创建」） |
| 从云端恢复 | 已连接凭据，且已绑定远端 |

前置条件不满足时按钮禁用，并用 `title` 说明缺的是什么；其余时候 `title` 说明这一行会覆盖什么（备份覆盖远端快照，恢复覆盖本机的供应商、模型与绑定）。说明区固定为「上次备份 {时间} · 上次恢复 {时间}」，没做过的那一半显示「从未」——不因为还没同步过就换成另一套排版。

动作名按用户能理解的说法来：「备份到云端 / 从云端恢复」比「上传 / 拉取」少一层翻译。

**恢复前先确认**：恢复会整份盖掉本机的供应商、模型与绑定且无法撤销，因此点按钮先弹一个确认框（`restoreConfirmTitle` / `restoreConfirmDescription`），确认后才真正拉取。备份只写远端、本机不动，不弹确认。

界面规则：

- 各行动作互斥进行，进行中其余控件禁用并显示加载状态；
- 凭据、远端、时间戳都是**一按即写**，不参与页面的「保存设置」流程：混进草稿会出现「界面显示已绑定、服务端还不知道」这类谁都不想要的时间；
- 「更换凭据 / 更换位置」展开出的输入框与初始态共用同一套行布局（左标题、右控件），只是控件从按钮换成「输入框 + 动作 + 取消」；
- 行内不摆图标，图标只出现在卡片头与按钮上；
- 失败用一句可照做的错误信息，成功用一行摘要（搬了多少供应商、模型、逻辑模型）；
- 界面从不回显凭据内容，也从不回显带凭据的 URL；
- 加载中与加载完是**同一套布局**（卡片外壳 + 骨架行），不会先画一半再补。

## 快照契约

```typescript
const CONFIG_SNAPSHOT_FORMAT = 'osw/config-snapshot'
const CONFIG_SNAPSHOT_VERSION = 1
const CONFIG_SNAPSHOT_FILE_NAME = 'osw-config.json'

interface ConfigSnapshot {
  format: 'osw/config-snapshot'
  version: 1
  exportedAt: number
  providers: ProviderBundleProvider[]
  logicalModels: { id: string; name: string; description: string; enabled: boolean }[]
  bindings: { logicalModelId: string; providerName: string; modelName: string; priority: number; enabled: boolean }[]
}
```

`providers` 与供应商包共用同一个 schema（`provider-bundle.ts` 里的 `ProviderBundleProviderSchema`），因此上游模型、端点绑定等字段的变化会同时作用于两条通路。

**绑定用名字而不是 id 指代供应商与模型。** id 是本机的（`prov_…`、`model_…`），换一台机器后必然对不上；名字是用户自己起的，也是他跨机器能认出来的东西。代价是「改名」在同步语义上等于「换一个对象」。

**快照带着密钥。** 导出的供应商条目里包含 `apiKey`，拉取时由供应商导入的既有规则写回本机密钥库。不带的话，新机器拉下来的是一堆需要逐个去官网重签的渠道，而不是一份能直接用的配置。代价是密钥离开了本机，所以界面与文档都把这件事写在明处。

**写往远端的不是这份 JSON，而是它的 base64。** 编码与解码收在 `packages/core/source/management/cloud-sync/snapshot-codec.ts`：导出时对整份正文编码，拉取时先解码再解析。两个理由：一是让那个文件一眼看不出内容，也躲开针对密钥的扫描器；二是以后往快照里加字段时不会出现「新字段忘了编码」这种漏网。

**解码兼容没有编码过的旧文件。** 升级后的第一次拉取遇到的可能是旧版本推上去的 JSON 原文——以 `{` 开头就直当 JSON 处理，不必让用户重新上传一遍。反面也有交代：「既不是合法 base64、也不是 JSON」与「base64 解得开但不像 JSON」都归为 `CLOUD_SYNC_REMOTE_FILE_INVALID`，提示用户去查那个文件，而不是把错归到“文件不存在”上。

## 同步语义

**快照对它指名道姓的东西说了算，而不是「清空重来」。**

### 上传

1. 读本机配置生成快照，并把它整份 base64 编码；
2. 已绑定远端 → 覆盖那个文件；未绑定 → 由**后端新建一个**并把句柄回填到设置（Gist 是新建一个私密 Gist）；
3. 记录上传时间；首次新建时把「上次拉取时间」清零。

未绑定时自动新建，是为了让「第一次同步」只需要点一次按钮，而不是先让用户自己去后端的网页上建一个容器、复制句柄、再粘回来。这个能力由后端自述里的 `createsTarget` 声明：能新建的后端在上传时兼管建容器，不能新建的（比如固定目录的 WebDAV）就要求用户先自己建好。Gist 一律 `public: false`——base64 不是加密，但至少那个文件不会在没有任何提示的情况下被搜索引擎收录。

### 拉取

1. 读远端的 `osw-config.json`，先 base64 解码（无编码的旧文件直接当 JSON），文件不存在、读不出来或解出来不是 JSON 时直接报错，不写任何东西；
2. 校验成快照，不通过则报「这不是一份配置快照」并附前几条字段级原因；
3. 应用：
   - **供应商**按名称覆盖，含各自的 API Key，沿用供应商导入的规则（包内未提到的模型软删除）；
   - **逻辑模型**按 id 新建或更新，快照里没有的逻辑模型**不动**；顺序整体按快照重排；
   - **绑定**只重写快照里出现过的逻辑模型：这些逻辑模型上没被提到的绑定会撤销，其余逻辑模型完全不动；
4. 记录拉取时间。

第 2、3 条的取舍与供应商包一致：把一个模型从队列里移掉是常见的编辑动作，它必须能同步过去；但对快照没提到的对象动刀就不是同步而是删除了。

**已知限制：删除一个逻辑模型不会传播。** 因为「快照没提到」与「对面刚删了」是同一件事，无法区分，只能选择不动。要真正删掉它，需要在目标机器上手动删除。

**应用不是事务。** 中途失败会留下半拉架子（比如供应商已经导入、绑定还没重写）；再拉一次即可收敛到同一状态。这与供应商导入的取舍一致，理由见 [import-config-snapshot.ts](../../packages/core/source/management/cloud-sync/import-config-snapshot.ts) 的函数头注释。

## 配置契约

`SettingsSchema` 增加的字段**全部由服务端写入**，不进入设置表单的提交白名单：

```typescript
cloudSyncProvider: CloudBackupKind   // 默认 'github-gist'，当前承载方式
cloudSyncAccountLabel: string        // 默认 ''，校验成功时得到的账号名（Gist 是 '@octocat'）
cloudSyncTarget: string              // 默认 ''，空表示未绑定
cloudSyncLastPushedTime: number      // 默认 0，毫秒时间戳
cloudSyncLastPulledTime: number      // 默认 0
```

`cloudSyncProvider` 带着 `catch` 兜底：旧版本读到一个它不认识的方式时退回默认值，而不是整个设置对象校验失败。

**凭据不进设置表**，只存进宿主密钥库（见 [security-privacy.md](./security-privacy.md) §密钥存储）。引用是**按后端固定**的（`cloud_backup_credential.<kind>`）：换后端不丢旧凭据；而用一个每次启动都变的随机引用会把它彻底弄丢。

## 管理 API

| 路由 | 作用 |
| --- | --- |
| `POST /api/cloud-sync/status` | 读当前状态（当前方式、可选方式列表、是否已配凭据、账号名、远端句柄 / 链接、两个时间戳） |
| `POST /api/cloud-sync/configure` | 切换方式、保存或清除凭据、绑定或解绑远端 |
| `POST /api/cloud-sync/test` | 校验凭据可用；已绑定时顺带确认这份凭据看得见这个远端 |
| `POST /api/cloud-sync/push` | 上传 |
| `POST /api/cloud-sync/pull` | 拉取 |

`status` 永远不返回凭据内容，但会带上**所有可选方式的自述**：界面因此不必自己维护一份后端列表，那份列表迟早会和注册表悄悄错开。

`configure` 的三个字段都是可选的，但至少要有一个；同一次请求里**先切方式、再写凭据与远端**——界面上的「换同步方式」与「填凭据」可能一次提交，那时凭据属于新的那一种，不能拿它去问旧后端。

`test` 与「保存凭据时的校验」分开：绑定好远端之后，「这份凭据看得见这个远端吗」是另一件可能出错的事（凭据有效但没勾权限、远端属于别人），需要一个不改动任何东西的问法。

## 错误语义

错误码**不带后端名字**：换一种承载方式不该换一套错误码，否则界面与文案要跟着长一遍。

| 错误码 | 触发条件 | 对用户意味着什么 |
| --- | --- | --- |
| `CLOUD_SYNC_NOT_CONFIGURED` | 未保存凭据就上传/拉取；未绑定远端就拉取 | 缺一步前置操作 |
| `CLOUD_SYNC_AUTH_FAILED` | 后端返回 401 / 403，或凭据查不出账号 | 凭据无效或权限不足 |
| `CLOUD_SYNC_UNREACHABLE` | 连不上后端（DNS、超时、TLS、代理） | 网络问题，不是凭据问题 |
| `CLOUD_SYNC_REMOTE_FILE_MISSING` | 远端没有 `osw-config.json` | 绑错了地方，或还没上传过 |
| `CLOUD_SYNC_REMOTE_FILE_INVALID` | 远端那个文件既不是合法 base64、也不是 JSON（或 base64 解得开但内容不像 JSON） | 文件被改坏了 |
| `VALIDATION_ERROR` | 远端地址解析失败；文件是 JSON 但不是快照 | 输入或文件不对 |
| `RESOURCE_NOT_FOUND` | 后端对句柄返回 404 | 远端不存在，或凭据看不见它 |

**「后端说不行」和「后端连不上」必须分开报。** 复用 `NETWORK_ERROR` 会让界面提示「连不上本地服务」，把排查方向带偏。

## 安全与隐私

- 凭据存在宿主密钥库（桌面形态为 `safeStorage`，命令行形态为 AES-256-GCM 文件），与 Provider API Key 同一套设施，且按后端分别存放、互不影响；
- 凭据不写入 SQLite、不写入日志、不进入任何导出文件；数据库里只有当前方式、账号名、远端句柄与两个时间戳；
- 快照整份只做 base64 编码（`packages/core/source/management/cloud-sync/snapshot-codec.ts`），**这是编码不是加密**：它能挡住“一眼看出内容”和针对密钥的扫描器，但挡不住任何一个能读到那个文件的人；
- **快照里带着各供应商的 API Key**，这是「换台机器拉一次就能用」的前提，也意味着上传就是把密钥交到后端手里。Gist 新建时一律私密，但**私密 Gist 不是加密存储**——GitHub 及其运维方在技术上能读到内容。因此这条通路的适用面是「用户自己信任的容器」，不是「安全的密钥仓库」；
- 界面不摆常驻告知，但文档必须写明这一点：本文件与 [security-privacy.md](./security-privacy.md) 同步写明；
- 出站请求走共享出站连接器，因此受用户的上游代理与绕过规则约束，日志脱敏规则同样适用。

## 验收依据

- 承载方式契约：`packages/contracts/source/cloud-backup.ts`；
- 快照与状态契约：`packages/contracts/source/cloud-sync.ts`；
- 快照生成与应用：`packages/core/source/management/cloud-sync/export-config-snapshot.ts`、`import-config-snapshot.ts`；
- 整份快照的编码与解码：`packages/core/source/management/cloud-sync/snapshot-codec.ts`；
- 后端接口与注册表：`packages/core/source/management/cloud-sync/backends/contract.ts`、`backends/index.ts`；
- GitHub Gist 后端与错误映射：`packages/core/source/management/cloud-sync/backends/github-gist.ts`；
- 编排：`packages/core/source/management/cloud-sync/service.ts`；
- 路由：`packages/core/source/management/routes/operations/cloud-sync.ts`；
- 单元测试：`packages/core/source/management/cloud-sync.test.ts`；
- 界面：`packages/console/source/pages/runtime-settings/components/cloud-sync-card.tsx`。
