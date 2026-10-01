import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * 配置库（`config-v1.db`）：**用户写的东西**。
 *
 * 供应商、模型、端点、协议转换、逻辑模型、路由策略、改写规则、工作流、全局设置——
 * 全部是用户在界面上敲出来的、丢了就得重敲一遍的内容。文件名的 schema 版本见
 * `@common/database-file`。
 *
 * 三条不变量，改动这个文件前先读完：
 *
 *   1. **不许 import `./data-schema`**，也不许反过来。两个库之间不存在外键、JOIN 与事务，
 *      这是「日志炸了配置也不受牵连」的全部依据。`packages/core/scripts/check-database-boundaries.mjs`
 *      会拒绝任何同时引到两边的**非白名单**文件。
 *   2. **不许在这里放「每次请求都要写」的东西。** 请求日志、用量、正文、运行时日志、
 *      健康状态（连续失败次数与冷却截止时间）全部属于数据库。健康状态是这套拆分里最容易
 *      放错的一处：它的主键看着像配置（供应商 id、供应商模型 id），但它在**每一个成功的
 *      请求**上都要写一次——留在配置库等于「每个请求都写配置库」，那就把这次拆分想解决的
 *      问题原样搬了回来。见 `apps/docs/specs/data-model.md` 的数据库拆分一节。
 *   3. 库内保留 `references()`：同一文件内的外键仍然由 SQLite 维护（连接时开
 *      `foreign_keys`）。跨库那两条已经删掉了，见数据库的说明。
 *   4. **「不许重名」这类规则只写在应用层，不写成唯一索引。** 这些表的每一行都有一个
 *      服务端生成的记录 id（`prov_` / `model_` / `end_` / `pme_` / `conv_` / `lm_` / `rule_` /
 *      `workflow_`），身份是它，不是用户起的名字；名字只在「当前可用（未删除）的行之间」
 *      不许重复，而这句话的主语是活着的那些行。写成 DB 约束就变成「这个值不许第二次出现」，
 *      删除路径为了满足它就不得不打标让位、改名腾位，用户看得见的「删掉再建一个同名的」
 *      就成了一次莫名其妙的冲突。所以：**删掉的行让出名字、规则由 store 回答，
 *      违反时给一句能照做的 409**（见 `logical-model-store.ts` 的 `assertLogicalModelIdAvailable`）。
 *
 * 只读操作（分析页、路由工作台的预览）会同时用到两个库，那是**读**的组合，
 * 由 `packages/core/source/database/index.ts` 给出的两个句柄在调用方拼，
 * 不在 schema 层提供任何「联合」。
 */

export const settings = sqliteTable(
  'settings',
  {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
    valueType: text('valueType').notNull().default('string'),
    updatedTime: integer('updatedTime').notNull(),
  },
  table => [index('idx_settings_updated_time').on(table.updatedTime)],
)

export const providers = sqliteTable(
  'providers',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    /**
     * 供应商在管理页侧栏里的展示顺序，数值越小越靠前。
     * 全为 0（种子行与早期导入行）时回退到 `createdTime` 排序。
     */
    sortOrder: integer('sortOrder').notNull().default(0),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
    deletedTime: integer('deletedTime'),
  },
  table => [
    index('idx_providers_enabled').on(table.enabled),
    index('idx_providers_deleted_time').on(table.deletedTime),
  ],
)

export const providerSettings = sqliteTable(
  'provider_settings',
  {
    providerId: text('providerId').notNull().references(() => providers.id),
    key: text('key').notNull(),
    value: text('value').notNull(),
    valueType: text('valueType').notNull().default('string'),
    updatedTime: integer('updatedTime').notNull(),
  },
  table => [
    primaryKey({ columns: [table.providerId, table.key] }),
    index('idx_provider_settings_key').on(table.key),
  ],
)

export const providerEndpoints = sqliteTable(
  'provider_endpoints',
  {
    id: text('id').primaryKey(),
    providerId: text('providerId').notNull().references(() => providers.id),
    protocol: text('protocol').notNull(),
    url: text('url').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
    deletedTime: integer('deletedTime'),
  },
  table => [
    // 同一供应商同一协议只允许一条**未删除**的端点，但这条规则**不在这儿**。
    //
    // 「当前可用（未删除）的不许重复」说的是活跃行之间的事，不是「这个值永远不能出现第二次」。
    // 把它写成部分唯一索引，就把「删掉再建同一条」的责任推给了删除路径：连删都不能删干净，
    // 只能靠打标让位，而每一次写入又要先想清楚自己会不会撞上历史行。判据其实只有一句
    // 「现在有没有另一条活跃行占着（供应商，协议）」，这句话由
    // `provider-store.ts` 的 `findResurrectableProviderEndpoint` 在应用层回答：它先找活跃行，
    // 没有就找同一（供应商，协议）的历史行**原地复活**，都没有才插入新行。
    // 于是「删掉端点 → 再加回同一协议」既不会撞约束，也不会在表里堆出一条看不见的历史行。
    index('idx_provider_endpoints_provider_protocol').on(table.providerId, table.protocol),
    index('idx_provider_endpoints_protocol').on(table.protocol, table.enabled),
    index('idx_provider_endpoints_deleted_time').on(table.deletedTime),
  ],
)

export const providerModels = sqliteTable(
  'provider_models',
  {
    /**
     * **数据记录 id**：这一行的身份，`model_*`。
     *
     * 供应商模型的对外身份也是它，不是 `modelName`：调度绑定
     * （`scheduling_policies.providerModelId`）、端点绑定、协议转换器全都锚在这儿，
     * 所以改名不动它、软删除也不动它，改名的代价就只是一次 UPDATE。
     */
    id: text('id').primaryKey(),
    providerId: text('providerId').notNull().references(() => providers.id),
    /**
     * 模型名：给上游看的字符串，也是用户在界面上认的那一行。
     *
     * 同一供应商下**允许重名**：同一个模型接两个区域、两套密钥、两条不同的端点，
     * 是很正常的用法（两条记录各自绑自己的端点）。因此这里既没有唯一索引，也没有
     * 「活跃行不许重名」的应用层检查——重名不会撞上任何既有的行，只会在列表里并排出现两行，
     * 与「删掉再建一个同名的」走的是同一条路径。要区分它们靠 `id`，不靠名字。
     */
    modelName: text('modelName').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
    deletedTime: integer('deletedTime'),
  },
  table => [
    index('idx_provider_models_provider_model').on(table.providerId, table.modelName),
    index('idx_provider_models_enabled').on(table.providerId, table.enabled, table.deletedTime),
  ],
)

export const providerModelEndpoints = sqliteTable(
  'provider_model_endpoints',
  {
    id: text('id').primaryKey(),
    providerModelId: text('providerModelId').notNull().references(() => providerModels.id),
    providerEndpointId: text('providerEndpointId').notNull().references(() => providerEndpoints.id),
    url: text('url'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
    deletedTime: integer('deletedTime'),
  },
  table => [
    // 「一个模型对一条端点只留一条活跃绑定」同样由应用层回答：`replaceRouteEndpoints`
    // 先找活跃绑定，没有就找同一（模型，端点）的历史绑定**原地复活**，都没有才插入。
    // 于是「取消绑定再重新绑上」不会撞约束，也不会在表里留下一条再也用不到的行。
    index('idx_provider_model_endpoints_unique').on(table.providerModelId, table.providerEndpointId),
    index('idx_provider_model_endpoints_provider_endpoint').on(table.providerEndpointId, table.enabled),
    index('idx_provider_model_endpoints_deleted_time').on(table.deletedTime),
  ],
)

export const requestRewriteRules = sqliteTable('request_rewrite_rules', {
  id: text('id').primaryKey(), name: text('name').notNull(), description: text('description').notNull().default(''), enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true), scope: text('scope').notNull().default('model'), schemaVersion: integer('schemaVersion').notNull().default(1), source: text('source').notNull().default('user'), match: text('match').notNull(), actions: text('actions').notNull(), testCases: text('testCases').notNull().default('[]'), createdTime: integer('createdTime').notNull(), updatedTime: integer('updatedTime').notNull(), deletedTime: integer('deletedTime'),
}, table => [index('idx_request_rewrite_rules_enabled').on(table.enabled), index('idx_request_rewrite_rules_scope').on(table.scope), index('idx_request_rewrite_rules_deleted_time').on(table.deletedTime)])

export const providerModelRequestRewriteRules = sqliteTable('provider_model_request_rewrite_rules', {
  providerModelId: text('providerModelId').notNull().references(() => providerModels.id), requestRewriteRuleId: text('requestRewriteRuleId').notNull().references(() => requestRewriteRules.id), priority: integer('priority').notNull(), enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true), createdTime: integer('createdTime').notNull(), updatedTime: integer('updatedTime').notNull(), deletedTime: integer('deletedTime'),
}, table => [
  // 主键就是（供应商模型，改写规则）：一条绑定要么在，要么不在。
  //
  // 这里过去还有一条 `(providerModelId, priority) WHERE deletedTime IS NULL` 的部分唯一索引，
  // 「同一模型下优先级不重复」由它来保证。现在这条规则回到应用层
  // （`request-rewrite-rule-store.ts` 的 `replaceProviderModelRequestRewriteRuleBindings`）：
  // 违反它的是用户在一个请求体里填了两个相同的优先级，那是输入问题，该收到一句
  // 能照做的 409，而不是一个从 SQLite 消息里抠出来的列名。
  //
  // 另外，主键本身也说明为什么不需要额外的唯一索引：**绑定是按主键原地复活的**
  // （`onConflictDoUpdate` 会把 `deletedTime` 清回 `null`），删掉再加回同一对
  // （模型，规则）只更新那一行，不会新增、也不会撞上任何历史行。
  primaryKey({ columns: [table.providerModelId, table.requestRewriteRuleId] }),
  index('idx_provider_model_request_rewrite_rules_priority').on(table.providerModelId, table.priority),
  index('idx_provider_model_request_rewrite_rules_deleted_time').on(table.deletedTime),
])

export const protocolConverters = sqliteTable(
  'protocol_converters',
  {
    id: text('id').primaryKey(),
    providerModelEndpointId: text('providerModelEndpointId').notNull().references(() => providerModelEndpoints.id),
    clientProtocol: text('clientProtocol').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
    deletedTime: integer('deletedTime'),
  },
  table => [
    // 同 `providerModelEndpoints`：一条绑定对一个客户端协议只留一条活跃转换器，
    // 由 `syncProtocolConverters` 先找活跃行、再找历史行原地复活。
    index('idx_protocol_converters_unique').on(table.providerModelEndpointId, table.clientProtocol),
    index('idx_protocol_converters_protocol').on(table.clientProtocol, table.enabled),
    index('idx_protocol_converters_deleted_time').on(table.deletedTime),
  ],
)

export const logicalModels = sqliteTable(
  'logical_models',
  {
    /**
     * **数据记录 id**：本机生成的内部主键，不是对外的模型名。
     *
     * 它只承担两件事：标识这一行、给外键当锚点。所以它必须稳定——改名不动它、软删除也不动它。
     * 调度绑定（`scheduling_policies.logicalModelId`）指着它，那些引用就永远不可能因为一次改名
     * 而变成悬空行，也不需要 `ON UPDATE CASCADE` 这类「改一处搬一片」的补救。
     *
     * 用 `generateId('lm_')` 生成，与 `prov_` / `end_` / `pm_` 同一套做法。
     */
    id: text('id').primaryKey(),
    /**
     * **模型 id**：对外的路由目标，客户端请求里的模型名就是它。
     *
     * 与 `provider_models.modelName` 处在同一个位置：它是用户起的、可以被改的，
     * 所以绝不能拿来当外键的锚点。它与数据记录 id 是**两个字段**，
     * 合成一个的代价是「改名」等于「换身份」，每加一处引用就要多一处搬运。
     *
     * 活跃行之间唯一；已删除的行可以重名，因此这里**没有**唯一索引 —— 判据是「当前可用，
     * 不许重复」，而不是「这个名字历史上出现过没有」。那条规则由
     * `logical-model-store.ts` 的 `assertLogicalModelIdAvailable` 把守，给出一句能照做的
     * 409，而不是让用户撞上一个语法层面的约束。
     */
    modelId: text('modelId').notNull(),
    description: text('description').notNull().default(''),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    /**
     * 逻辑模型在管理页的展示顺序，数值越小越靠前。
     * 全为 0（含 `default`）时回退到 `createdTime` 排序。
     */
    sortOrder: integer('sortOrder').notNull().default(0),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
    deletedTime: integer('deletedTime'),
  },
  table => [
    index('idx_logical_models_enabled').on(table.enabled),
    index('idx_logical_models_deleted_time').on(table.deletedTime),
  ],
)

export const workflows = sqliteTable(
  'workflows',
  {
    /**
     * **数据记录 id**（`workflow_`）：这一行的身份。
     *
     * 对外接口按它来（`router/graph/version` 收的 `id`），版本号只当展示与排序用。
     * 云模式里会有人把自己存的一版路由图分享给别人——那时「第几版」在两边对不上，
     * 能对上的只有这一行的 id 与内容。
     */
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    /**
     * 版本号：**展示用的编号**，取值是「当前最大版本号 + 1」。
     *
     * 它不由数据库约束保证唯一（这条链上没有任何唯一索引）：版本号是历史记录的顺序，
     * 不是身份。也没有软删除，每一版的行一直在，所以「删一版再存回同一个号」这种事不存在，
     * 号永远只会往前走。
     */
    version: integer('version').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    definition: text('definition').notNull(),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
    /**
     * 历史遗留列：版本**从不删除**，所以它恒为 `null`。
     *
     * 一版就是用户存下来的一个可回滚历史，删掉它等于用户自己存的东西找不回来；
     * 版本列表本来就只展示最近若干版，不靠删除来控制体量。
     * 留着这一列只是为了不破坏已发布的基线表结构（改列要重建基线），读取路径也仍然带上
     * `deletedTime IS NULL` 过滤，历史数据里可能存在被打过标的行。
     */
    deletedTime: integer('deletedTime'),
  },
  table => [
    index('idx_workflows_type_version').on(table.type, table.version),
    index('idx_workflows_type').on(table.type, table.deletedTime),
    index('idx_workflows_deleted_time').on(table.deletedTime),
  ],
)

/**
 * 路由规则表（保存下来的版本）。
 *
 * **独立于 `workflows`**：路由图与路由规则是两种不同的东西，过去共用一张 `workflows` 表、
 * 靠 `type` 区分，只是因为它们生命周期相同（一行一版、保存即新版本）。真要让规则的版本
 * 有自己的记录 id、能被单独删掉、日后能被分享给别人，共用一张表就只剩别扭——
 * 一张表的列必须同时容纳两种 definition，而「这个 id 是图的还是表的」这种问题本来就不该存在。
 * 拆开之后各自的读取路径不必再按 `type` 过滤，各自的约束也能落在自己身上。
 *
 * `definition` 存序列化后的 `RouteRuleSet`：整份原文，不是增量。规则表很小（几十行条件），
 * 而整份原文才能保证「恢复这一版」是精确的。
 */
export const routeRuleSets = sqliteTable(
  'route_rule_sets',
  {
    /** **数据记录 id**（`route_`）：这一行的身份，接口按它来。 */
    id: text('id').primaryKey(),
    /**
     * 展示用的版本号，取值是「当前最大版本号 + 1」。
     *
     * 与 `workflows.version` 同构：它是排序用的编号，不是身份。没有唯一索引，
     * 因为分享/导入一版时两边的编号本来就可能撞上，而撞上并不代表是同一版。
     */
    version: integer('version').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    definition: text('definition').notNull(),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
  },
  table => [
    index('idx_route_rule_sets_version').on(table.version),
    index('idx_route_rule_sets_updated_time').on(table.updatedTime),
  ],
)

/**
 * 客户端配置文件的版本快照。
 *
 * 用户的诉求是「每次提交前自动备份当前内容，基于 hash 去重：已经有这个版本就不新增」，
 * 所以这张表的主键之外还有一条 **(clientKey, filePath, contentHash) 唯一索引**——
 * 去重规则交给 SQLite 而不是靠先查后写（那中间有竞态，且重复提交会得到两条一模一样的行）。
 * 写入用 `onConflictDoNothing`，冲突即代表「这个版本已在库里」，不更新、不新增。
 *
 * 为什么落在**配置库**：这是用户可回滚的备份数据——删掉它就等于用户自己写过的配置无法找回，
 * 与「数据库整个删掉不影响功能」的前提正相反。但它**不是**每请求写入：只有用户点「应用/恢复」
 * 时才各写一行，所以不违反这个文件顶部的第 2 条不变量。
 *
 * `content` 存的是整份原文（不是 diff）：配置文件都很小（几 KB），而整份原文才能保证
 * 「恢复」是精确的——按 diff 回放一旦中间漏了一次写入就会错位。
 */
export const clientConfigVersions = sqliteTable(
  'client_config_versions',
  {
    id: text('id').primaryKey(),
    /** 注册表里的客户端 key，如 `claude-code`。 */
    clientKey: text('clientKey').notNull(),
    /** 注册表里声明的那条 `~/` 路径（原样存，不展开成绝对路径，便于跨机器）。 */
    filePath: text('filePath').notNull(),
    /** 内容摘要（sha256 十六进制），去重依据。 */
    contentHash: text('contentHash').notNull(),
    /** 该版本的完整文件内容。 */
    content: text('content').notNull(),
    /** 内容字节数，列表里用来展示体量。 */
    sizeBytes: integer('sizeBytes').notNull().default(0),
    /** 快照产生的原因：`apply`（提交覆盖前的备份）/ `restore`（恢复前的备份）。 */
    origin: text('origin').notNull().default('apply'),
    /** 备注，例如「应用 One Switch 地址前」。 */
    note: text('note').notNull().default(''),
    createdTime: integer('createdTime').notNull(),
  },
  table => [
    uniqueIndex('idx_client_config_versions_hash').on(table.clientKey, table.filePath, table.contentHash),
    index('idx_client_config_versions_file').on(table.clientKey, table.filePath, table.createdTime),
  ],
)

export const schedulingPolicies = sqliteTable(
  'scheduling_policies',
  {
    // 指向逻辑模型的**数据记录 id**，不是模型 id：模型 id 可以被改（改名、软删除改写），
    // 外键锚在它上面就等于「改一次要搬一片」；锚在记录 id 上，改名只是一次 UPDATE，
    // 这里一行都不用动，也不需要 `ON UPDATE CASCADE`。
    logicalModelId: text('logicalModelId').notNull().references(() => logicalModels.id),
    providerModelId: text('providerModelId').notNull().references(() => providerModels.id),
    strategy: text('strategy').notNull().default('priority'),
    priority: integer('priority').notNull().default(0),
    weight: integer('weight').notNull().default(100),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
    deletedTime: integer('deletedTime'),
  },
  table => [
    // 主键保留为「逻辑模型 + 供应商模型」：软删除的行会被重新加入时原地复活，
    // 因此不需要为它让位，也就不需要部分索引（主键本身无法条件化）。
    primaryKey({ columns: [table.logicalModelId, table.providerModelId] }),
    index('idx_scheduling_policies_route').on(table.logicalModelId, table.enabled, table.priority, table.weight),
    index('idx_scheduling_policies_deleted_time').on(table.deletedTime),
  ],
)

export type ProviderRow = typeof providers.$inferSelect
export type ProviderSettingRow = typeof providerSettings.$inferSelect
export type ProviderEndpointRow = typeof providerEndpoints.$inferSelect
export type ProviderModelRow = typeof providerModels.$inferSelect
export type ProviderModelEndpointRow = typeof providerModelEndpoints.$inferSelect
export type ProtocolConverterRow = typeof protocolConverters.$inferSelect
export type LogicalModelRow = typeof logicalModels.$inferSelect
export type SchedulingPolicyRow = typeof schedulingPolicies.$inferSelect
export type SettingsRow = typeof settings.$inferSelect
export type WorkflowRow = typeof workflows.$inferSelect
export type RouteRuleSetRow = typeof routeRuleSets.$inferSelect
