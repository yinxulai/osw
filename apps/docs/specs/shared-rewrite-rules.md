# 共享重写规则目录

> **状态：已实现，本文对齐当前代码实现。**
>
> 本文描述共享重写规则目录（community rules directory）的端到端设计：契约、Worker 存储、
> 内核管理 API 转发、控制台页面，以及部署这一份目录所需的手工步骤。规则本身的语义见
> [request-rewrite-rules.md](./request-rewrite-rules.md)；本文只覆盖「把一条规则拿出本机、
> 放进一份公共目录、再让别人拿回去」这一条链路。

## 1. 背景与目标

[请求重写规则](./request-rewrite-rules.md) 是本机的一份配置，写好了只能自己用。很多兼容性
补丁其实是同一个问题在很多人身上重复出现（去掉某个字段、补一个 `User-Agent`、折叠某个
私有结构）。目标是让这些规则可以被分享、被发现、被复用，于是新用户不必从空白开始。

由此定下四条产品契约，它们是本文其余部分的出发点：

- **匿名。** 发布与使用都不要登录，不采集任何身份标识，目录里也没有任何一列可以关联回一台
  机器。目录持有的是**内容**，不是**作者**。
- **以使用量排名。** 热度信号只有一种：这条规则被「使用」过多少次。没有点赞、没有评分、
  没有评论——每一种都会引入一个「谁做的」，而那与匿名直接冲突。
- **无需安装，保存即用。** 从目录取一条规则，落地就是本机规则库里一条普通的规则：来源标成
  `imported`、默认启用，立刻能在请求重写页里编辑、在 ProviderModel 上绑定。没有「插件」
  「市场条目」这类需要单独管理的中间态。
- **缺配置不假装是空目录。** 目录依赖 Cloudflare D1。没绑定数据库时，端点返回一个明确的
  `not_configured`，而不是一个看起来正常、却永远返回零条规则的列表。

## 2. 非目标

- 登录、账号、发布者主页或任何可以指认作者的维度；
- 点赞、评分、评论、下载记录等除「使用量」以外的热度信号；
- 规则的版本管理、更新推送、撤回或审核流程；
- 私有目录、组织内共享或权限控制；
- 目录侧执行、校验或试跑规则（目录只存内容与计一次数，不理解规则语义，见 §5）。

## 3. 契约

契约是唯一的形状来源，客户端与服务端共用，避免两边各写一份必然漂移。定义在
`packages/contracts/source/shared-rewrite-rules.ts`。

| 常量 | 值 | 说明 |
| --- | --- | --- |
| `SHARED_REWRITE_RULES_PATH` | `/v1/rules` | 目录在 Worker 上的路径前缀 |
| `SHARED_REWRITE_RULES_ENDPOINT` | `https://api.osw.yinxulai.com/v1/rules` | 默认端点；实际端点由遥测设置派生，见 §4 |
| `SHARED_REWRITE_RULE_ACTIONS` | `list` / `get` / `publish` / `use` | 四条子路径 |
| `SHARED_REWRITE_RULES_MAX_REQUEST_BYTES` | 64 KiB | 单次请求上限，超限拒绝，**不截断** |
| `SHARED_REWRITE_RULES_MAX_LIST_LIMIT` | 100 | 服务端硬上限；界面取更少是界面的事 |
| `SHARED_REWRITE_RULES_DEFAULT_LIST_LIMIT` | 30 | 列表默认一页 |
| `SHARED_REWRITE_RULES_MAX_QUERY_LENGTH` | 100 | 关键词长度上限 |
| `SHARED_REWRITE_RULE_MAX_NAME_LENGTH` | 100 | 与本地规则一致 |
| `SHARED_REWRITE_RULE_MAX_DESCRIPTION_LENGTH` | 1000 | 与本地规则一致 |

### 3.1 载荷（可被发布的那一半）

`SharedRewriteRulePayloadSchema`（`.strict()`）刻意**不含** `id` / `createdTime` /
`updatedTime` / `deletedTime`：这些是**存储事实**，由目录在收到时产生。也不含 `enabled` 与
`source`：前者是本机的启用状态（装回来默认启用，是本机的决定），后者是本机的来源标注
（装回来的东西来源就是 `imported`）。

`match` / `actions` / `testCases` 直接复用本机的 `RequestRewriteRule*` schema——目录**不重新
定义**一条规则，否则「本机能跑」与「装回来能跑」就成了两件要各自验证的事。

| 字段 | 约束 |
| --- | --- |
| `name` | 1–100 字符 |
| `description` | ≤1000 字符，默认 `''` |
| `scope` | 复用 `RuleScopeSchema` |
| `schemaVersion` | 正整数，默认 1 |
| `match` | 复用 `RequestRewriteRuleMatchSchema`，默认 `{}` |
| `actions` | 1–50 条 |
| `testCases` | ≤50 条，默认 `[]` |

### 3.2 记录（目录里的一条规则）

`SharedRewriteRuleSchema = SharedRewriteRulePayloadSchema.extend({ id, usageCount, createdTime,
updatedTime })`。`id` 是内容签名（§5.1），`usageCount` 是排名依据，也是唯一的强度信号。

### 3.3 输入 / 输出

- `SharedRewriteRuleListInputSchema`：`{ query?, sort: 'popular'|'recent', limit, offset }`；
- `SharedRewriteRuleGetInputSchema` / `Publish` / `Use`：`{ id }`；
- `SharedRewriteRuleListResultSchema`：`{ rules, total, limit, offset }`——`total` 是满足条件的
  总条数（不受本页 `limit` 影响），用来渲染「还有更多」。

### 3.4 阶段闸门

`sharedRewriteRuleDisabledReason(payload)` 在发布前判断一条规则是否可以被分享。当前会拦下带
**响应阶段动作**的规则：响应阶段在本机受功能闸门控制（见 request-rewrite-rules.md §6.2），
把一份依赖它才能工作的规则放进公共目录，只会让装回来的人以为它坏了。返回非空原因即拒绝，
内核据此映射成 `RESPONSE_REWRITE_DISABLED`。

## 4. 客户端（内核管理 API）

控制台不直连目录，而是经本机的管理服务转发——这样端点、超时、错误码 `code` 与 CORS 都只在
一处决定。

- `packages/core/source/management/shared-rules/client.ts`：出站客户端。端点由
  `getSettings().telemetryEndpoint` 派生（缺失时退回 `SHARED_REWRITE_RULES_ENDPOINT`），用
  每次调用各自建立的直连连接 POST JSON。`404`→`RESOURCE_NOT_FOUND`，非 2xx 或 `!ok`→
  `UPSTREAM_ERROR`，JSON 解析失败→`INVALID_RESPONSE`。`User-Agent` 为 `OSW-Shared-Rules`，
  超时 10s。
- `packages/core/source/management/shared-rules/service.ts`：
  - `browseSharedRules(input)` / `readSharedRule(id)`——读；
  - `publishRuleToDirectory(ruleId)`——剥掉本机字段后发布；命中阶段闸门时返回
    `RESPONSE_REWRITE_DISABLED`；
  - `adoptSharedRule(id)`——把目录里的一条落成**本机规则**（`source:'imported'`, `enabled:true`），
    随后**尽力**把目录侧计数 +1：计数失败只 `console.debug`，不影响「已经装好了」这个事实。
- `packages/core/source/management/routes/relations/shared-rewrite-rules.ts`：暴露
  `POST /api/shared-rewrite-rule/{list,get,publish,use}`。

## 5. Worker 存储（`apps/apis`）

目录与遥测**共用同一个 Worker、同一个域名、同一套日志与状态码约定**，但两件事各自独立：遥测
是「收下一批就转发走」的追加流，目录是「一份可读、可写、被计数的小型存储」。所以它们是两条
路由、两个 handler，只在入口处汇合。

### 5.1 id 是内容的签名

`apps/apis/source/registry/signature.ts` 把一份载荷映射成稳定 `id`：先过一遍
`SharedRewriteRulePayloadSchema.parse`（补默认值、收敛键序），再对**规范化 JSON**（键按字典
序、数组保序）算 `sha256`，前缀 `sha256:`。于是「语义相同」与「签名相同」重合，发布天然是
幂等 upsert——同一份内容只存在一条，用量在它身上累加，而不是被摊薄成多份。签名的是**内容**，
不是作者，这是匿名目录能成立的前提。

### 5.2 表结构

`apps/apis/schema.sql`（D1 / SQLite），只有一张表 `shared_rewrite_rules`：

| 列 | 说明 |
| --- | --- |
| `id` | 内容签名，主键。靠 `INSERT ... ON CONFLICT` 完成幂等 |
| `payload` | 作者载荷原样存 JSON。目录**不拆解**它 |
| `search_text` | 名称+说明归一化后的副本，只服务关键词搜索，不进响应 |
| `usage_count` | 被用过的次数，唯一的排名信号，不指向任何机器 |
| `created_time` / `updated_time` | 毫秒时间戳；幂等重发时 `created_time` 不变 |

语句幂等（`IF NOT EXISTS`），重复执行无副作用。索引
`idx_shared_rewrite_rules_usage` 支撑「按用量降序、同量按新旧降序」的排名页。

### 5.3 HTTP 层

`apps/apis/source/registry/handler.ts`：四条路径全部 `POST`、共用一份 schema 校验。

| 路径 | 动作 | 幂等 | 计数 |
| --- | --- | --- | --- |
| `POST /v1/rules/list` | 按热度或时间取一页 | 是 | 不动 |
| `POST /v1/rules/get` | 取一条 | 是 | 不动 |
| `POST /v1/rules/publish` | 发布（或重发） | 是 | 不动 |
| `POST /v1/rules/use` | 用一条 | 是 | +1 |

**只有「用一次」计数，列表不算。** 浏览与搜索不动计数，否则一条规则只要被刷到就会涨分，
热度会变成「谁被刷得多」。

错误语义：非 `POST`→405；缺 `SHARED_RULES_DB` 绑定→500 `not_configured`；非 JSON content-type
→415；超 64 KiB→413；非法 JSON→400；schema 不通过→400；未知子路径 / 找不到的 id→404。

## 6. 控制台

- `pages/shared-rules/page.tsx`——社区规则页。一次取回前 50 条（`PAGE_LIMIT`），**本地**过滤
  搜索（一次点击即命中，且不必每敲一个字就发一次请求）；排序必须回服务端，因为它决定的是
  「取哪 50 条」，在截断后本地重排是错的。点「使用」把规则落成本机规则并就地 +1 计数。
- `pages/request-rewrite-rules/`——在规则行加入「分享」动作（`shareRequestRewriteRule`），
  先按 id 取回最新规则再发布。
- 路由：`routePaths.sharedRules = '/shared-rules'`（`routing/routes.ts`），路由与面包屑由
  `routing/router.tsx` 与 `routing/navigation.ts` 注册。

## 7. 部署

目录依赖 Cloudflare D1，需要在 **Cloudflare Workers Builds 之外**手工建库并执行 schema：

1. `wrangler d1 create osw-shared-rules`——把打印出的 `database_id` 填进
   `apps/apis/wrangler.toml` 里 `[[d1_databases]]` 的占位符 `REPLACE_WITH_D1_DATABASE_ID`；
2. `wrangler d1 execute osw-shared-rules --remote --file apps/apis/schema.sql`——建表（幂等）。

在此之前，Worker 会以 `not_configured` 明确失败（见 §3、§5.3），**不会**退化成一个空目录。
本文不触发任何部署动作；建库、填 id、执行 schema 均需具备 Cloudflare 凭据的人在带 `wrangler`
认证的环境里完成。
