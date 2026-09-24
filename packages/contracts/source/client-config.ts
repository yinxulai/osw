import { z } from 'zod'

/**
 * 「客户端配置管理」的共享契约。
 *
 * 这一页做的事只有两件：**把本机某个客户端配置文件改成指向 One Switch**，
 * 以及**在改之前把原文件存成一个版本**。所以契约里也就三块东西：
 * 文件当前状态、一次改动的结果、版本记录。
 *
 * 文件读写在 core（只有那里拿得到 `homedir()` 与进程环境变量，也才符合包边界），
 * 控制台只通过管理 API 拿这里的结构渲染。
 */

/**
 * 自动填充时照抄的 API Key。
 *
 * 不是密钥：OSW 不签发调用方凭证，本地服务也不校验鉴权（见 `docs/product/security-privacy.md`），
 * 这个值只在转发时被换成渠道自己的密钥。给一个固定值让用户照抄，比自己编一个更省事；
 * 与接入说明页共用同一个字面量，避免两处各写一份。
 */
export const CLIENT_CONFIG_SAMPLE_API_KEY = 'sk-osw'

export const ClientConfigFormatSchema = z.enum(['json', 'jsonc', 'toml', 'yaml', 'env'])
export type ClientConfigFormat = z.infer<typeof ClientConfigFormatSchema>

/**
 * 自动填充在该文件上是否可用。
 *
 * `unparsable`、`unsupported-format` 与 `unsupported-client` 是三种不同的失败：
 * 分别是「内容坏了（用户自己写错了语法）」「这个格式我们还没有结构化写入器」
 * 与「这个客户端没有可指向本地服务的地址字段」——三种要用户做的事不一样（改语法 / 改手填 /
 * 换个客户端），所以不能合并成一句「不支持」。
 */
export const ClientConfigAutoFillSchema = z.enum(['ready', 'unparsable', 'unsupported-format', 'unsupported-client'])
export type ClientConfigAutoFill = z.infer<typeof ClientConfigAutoFillSchema>

// ========== 文件当前状态 ==========

export const ClientConfigFileStateSchema = z.object({
  /** 注册表里的客户端 key。 */
  clientKey: z.string(),
  /** 注册表里声明的那条 `~/` 路径（原样返回，界面按它取数据）。 */
  filePath: z.string(),
  /** 展开后的真实绝对路径，展示给用户确认改的是哪个文件。 */
  resolvedPath: z.string(),
  format: ClientConfigFormatSchema,
  exists: z.boolean(),
  /** 文件全文；不存在时为空串。 */
  content: z.string(),
  /** 内容摘要（sha256），去重与「是否变化」的判断依据。 */
  contentHash: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  /** 最后修改时间（毫秒）；文件不存在时为 null。 */
  modifiedTime: z.number().int().nullable(),
  /** 自动填充是否可用。 */
  autoFill: ClientConfigAutoFillSchema,
  /**
   * 已识别到的字段当前值，键是注册表里的 `fields[].key`。
   *
   * 只做展示回显：解析不出来或格式不支持时就是空对象，界面按「读不到」渲染，
   * 不能让用户以为读到的是空字符串。
   */
  detected: z.record(z.string(), z.string()),
})

export type ClientConfigFileState = z.infer<typeof ClientConfigFileStateSchema>

// ========== 版本记录 ==========

export const ClientConfigVersionOriginSchema = z.enum(['apply', 'restore', 'manual'])
export type ClientConfigVersionOrigin = z.infer<typeof ClientConfigVersionOriginSchema>

export const ClientConfigVersionSummarySchema = z.object({
  id: z.string(),
  clientKey: z.string(),
  filePath: z.string(),
  contentHash: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  origin: ClientConfigVersionOriginSchema,
  note: z.string(),
  createdTime: z.number().int(),
  /** 开头若干字符，供列表快速辨认；不是完整内容。 */
  preview: z.string(),
})

export type ClientConfigVersionSummary = z.infer<typeof ClientConfigVersionSummarySchema>

export const ClientConfigVersionSchema = ClientConfigVersionSummarySchema.extend({
  content: z.string(),
})

export type ClientConfigVersion = z.infer<typeof ClientConfigVersionSchema>

// ========== 一次改动的结果 ==========

export const ClientConfigChangeSchema = z.object({
  /** 配置文件里的键路径。 */
  path: z.string(),
  /** 改动前的值；原来没有这个键时为 null。 */
  before: z.string().nullable(),
  /** 改动后的值。 */
  after: z.string(),
})

export type ClientConfigChange = z.infer<typeof ClientConfigChangeSchema>

/**
 * 一次提交的产物。
 *
 * `backedUp` 为 null 表示**本次没有新增版本**——要么文件本来就不存在（没什么可备份的），
 * 要么这份内容已经存在于历史里（hash 去重命中）。这正是用户要的规则：
 * 「基于 hash，如果之前已经有版本了，就不更新，否则创建一个新版本」。
 */
export const ClientConfigWriteResultSchema = z.object({
  state: ClientConfigFileStateSchema,
  backedUp: ClientConfigVersionSummarySchema.nullable(),
})

export type ClientConfigWriteResult = z.infer<typeof ClientConfigWriteResultSchema>

export const ClientConfigApplyResultSchema = ClientConfigWriteResultSchema.extend({
  changes: z.array(ClientConfigChangeSchema),
})

export type ClientConfigApplyResult = z.infer<typeof ClientConfigApplyResultSchema>

// ========== 请求体 ==========

export const ClientConfigFileRequestSchema = z.object({
  clientKey: z.string().min(1),
  filePath: z.string().min(1),
})

export const ClientConfigSaveRequestSchema = ClientConfigFileRequestSchema.extend({
  content: z.string(),
  note: z.string().optional(),
})

export const ClientConfigApplyRequestSchema = ClientConfigFileRequestSchema.extend({
  baseUrl: z.string().min(1),
  apiKey: z.string(),
  model: z.string().min(1),
  /** 小模型/后台模型；留空时回落到 `model`。 */
  smallModel: z.string().optional(),
})

export const ClientConfigVersionRequestSchema = z.object({
  id: z.string().min(1),
})

/**
 * 恢复某个版本：既要有版本 id，也要带上它属于哪个文件。
 *
 * 不带 `clientKey` / `filePath` 的话，「这个版本属于哪个文件」就只能从版本行里反推，
 * 而回退的落点必须是**注册表声明过的那个文件**——多一层显式校验，少一条越界写入的路径。
 */
export const ClientConfigVersionRestoreRequestSchema = ClientConfigFileRequestSchema.extend({
  id: z.string().min(1),
})

// ========== 列表页：每个客户端的覆盖状态 ==========

/**
 * 「这个客户端的配置现在被我们覆盖到什么程度」。
 *
 * 判据是一次 **dry run**：拿服务端自己那套默认值（本地地址、固定密钥、兜底模型）先算一遍
 * 「如果现在点一键生效会改哪些键」，改动为空就是 `applied`。这样列表上的状态与按钮的真实行为
 * 永远同源，不会出现「显示已生效、点一下却改了三处」这种自相矛盾。
 *
 * 四个值的区别在于用户要做什么：
 * - `applied`：什么都不用做；
 * - `pending`：点一下就好（还会改 N 处）；
 * - `absent`：配置文件还不存在，一键生效会直接建一个；
 * - `unavailable`：没有配方 / 格式不支持 / 内容语法坏了，只能手改（具体是哪种看 `autoFill`）。
 */
export const ClientConfigCoverageSchema = z.enum(['applied', 'pending', 'absent', 'unavailable'])
export type ClientConfigCoverage = z.infer<typeof ClientConfigCoverageSchema>

export const ClientConfigOverviewItemSchema = z.object({
  clientKey: z.string(),
  /** 主配置文件（注册表 `files[0]`）：列表里的状态、时间与版本都以它为准。 */
  filePath: z.string(),
  resolvedPath: z.string(),
  format: ClientConfigFormatSchema,
  exists: z.boolean(),
  sizeBytes: z.number().int().nonnegative(),
  /** 主配置文件的最后修改时间（毫秒）；文件不存在时为 null。 */
  modifiedTime: z.number().int().nullable(),
  /** 主配置文件的自动填充可用性，也是 `unavailable` 时的具体原因。 */
  autoFill: ClientConfigAutoFillSchema,
  coverage: ClientConfigCoverageSchema,
  /** 现在的配置距离「已生效」还差几处改动；`applied` 时恒为 0。 */
  pendingChanges: z.number().int().nonnegative(),
  /** 这个客户端名下所有文件存过的版本总数。 */
  versionCount: z.number().int().nonnegative(),
  /** 最近一次备份的时间；没有版本时为 null。 */
  lastVersionTime: z.number().int().nullable(),
})

export type ClientConfigOverviewItem = z.infer<typeof ClientConfigOverviewItemSchema>

/**
 * 概览不需要任何入参：看哪个客户端的哪个文件是注册表定死的，状态由服务端自己算。
 * 仍然留一个（空的）请求体校验，好在路由层一眼看出「这个入口不吃参数」。
 */
export const ClientConfigOverviewRequestSchema = z.object({})

// ========== 一键生效 ==========

/**
 * 一键生效对单个客户端的结果。
 *
 * `unchanged`（本来就是对的）与 `applied`（刚刚改了）必须分开：合成一句「已生效」，
 * 用户就看不出这一下到底动了几个客户端。
 */
export const ClientConfigFillStatusSchema = z.enum(['applied', 'unchanged', 'skipped', 'failed'])
export type ClientConfigFillStatus = z.infer<typeof ClientConfigFillStatusSchema>

export const ClientConfigFillResultItemSchema = z.object({
  clientKey: z.string(),
  status: ClientConfigFillStatusSchema,
  /** 本次真正写入的文件；跳过或失败时为空数组。 */
  filePaths: z.array(z.string()),
  /** 写入的改动条数汇总。 */
  changeCount: z.number().int().nonnegative(),
  /** 新增的版本数；内容重复时不会新增，所以可能小于写入的文件数。 */
  newVersions: z.number().int().nonnegative(),
  /** 跳过或失败的原因；成功时为空串。 */
  message: z.string(),
})

export type ClientConfigFillResultItem = z.infer<typeof ClientConfigFillResultItemSchema>

/**
 * 一键生效的入参。
 *
 * 不带 `clientKey` 就是「全部客户端」（页面右上角那颗按钮），带上就是列表行内那一颗。
 * 两种入口共用同一套默认值与同一条写入路径，不另开第二条实现。
 */
export const ClientConfigFillRequestSchema = z.object({
  clientKey: z.string().optional(),
})
