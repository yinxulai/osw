import { z } from 'zod'
import { CloudBackupDescriptorSchema, CloudBackupKindSchema } from './cloud-backup'
import { ProviderBundleProviderSchema } from './provider-bundle'
import { LogicalModelIdSchema } from './schemas'

/**
 * 云同步：把本机的配置放进一个第三方文件托管处，换台机器时拉回来。
 *
 * 这里只描述**传输的是什么**与**一问一答的形状**，不描述怎么存、怎么取——
 * 「存在哪」由承载方式（后端）的实现决定，它的契约在 `cloud-backup.ts`，
 * 实现与注册表在 `packages/core/source/management/cloud-sync/backends`（见 `docs/product/cloud-sync.md`）。
 *
 * 所以下文尽量避免出现某一个后端的专名：快照里那两样东西一律叫**凭据**（`credential`）与
 * **远端句柄**（`target`），GitHub Gist 只是它们当前唯一的一种取值。
 */

/**
 * 快照的格式标识。
 *
 * 与供应商包一样单独用一个字面量字段：拉回来的东西可能是用户手改过的、也可能是另一个
 * 产品的文件，导入时必须能一眼判断「这是不是一个配置快照」，而不是给出一串字段校验错误。
 */
export const CONFIG_SNAPSHOT_FORMAT = 'osw/config-snapshot'

/**
 * 快照版本。
 *
 * 与供应商包同样的取舍：这里是字面量而不是可升级的联合类型，导入只接受当前这一个值，
 * 换代时把它改成 `2`，让上一代的文件明确报错，而不是被猜着读。
 */
export const CONFIG_SNAPSHOT_VERSION = 1

/** 快照的文件名。固定不变：换名字等于换一个文件，旧内容会被留下变成孤儿。 */
export const CONFIG_SNAPSHOT_FILE_NAME = 'osw-config.json'

/**
 * 快照里的逻辑模型条目。
 *
 * 只带 id 与展示信息，不带 `createdTime` / `deletedTime`：时间戳是本机的记账，
 * 同步过来只会让两边的排序与「什么时候建的」互相污染。
 */
const ConfigSnapshotLogicalModelSchema = z.object({
  id: LogicalModelIdSchema,
  name: z.string().min(1).max(100),
  description: z.string().default(''),
  enabled: z.boolean().default(true),
})

/**
 * 快照里的调度绑定。
 *
 * 供应商与模型用**名称**而不是 id 指向：供应商 id（`prov_*`）与模型 id 都是本机生成的主键，
 * 两台机器上必然不同，只有「哪个供应商的哪个模型」这个组合是跨机稳定的。
 */
const ConfigSnapshotBindingSchema = z.object({
  logicalModelId: LogicalModelIdSchema,
  providerName: z.string().min(1).max(100),
  modelName: z.string().min(1),
  priority: z.number().int().default(0),
  enabled: z.boolean().default(true),
})

/**
 * 配置快照：一次云同步传输的完整内容。
 *
 * 与供应商包是超集关系：`providers` 直接用供应商包的供应商条目（同一份 schema，因此保存与
 * 应用可以直接复用供应商导入导出），在此之上补上逻辑模型与它们的调度绑定——
 * 只同步供应商会丢掉「哪个模型排在前面」，拉回来的是一个能跑但顺序不对的路由。
 *
 * 刻意**不包含**应用设置（监听地址、上游代理、日志保留……）：那些是「这台机器该怎么跑」，
 * 不是「有哪些渠道」。把它们一起同步，只会让换机时莫名其妙地改掉本机端口与代理。
 */
export const ConfigSnapshotSchema = z.object({
  format: z.literal(CONFIG_SNAPSHOT_FORMAT),
  version: z.literal(CONFIG_SNAPSHOT_VERSION),
  exportedAt: z.number().int(),
  /**
   * 供应商条目，**带着明文 API Key**（`apiKey` 字段）。
   *
   * 写往远端时整份文档会做一次 base64（见 `packages/core/source/management/cloud-sync/snapshot-codec.ts`），
   * 所以落到别人硬盘上的不是明文；但在内存与传输对象里它就是明文，别把这个字段当成已经加密。
   * 远端文件被解出来之后，密钥跟着 `providers` 一起还原——这是「换台机器拉一次就能用」的前提。
   */
  providers: z.array(ProviderBundleProviderSchema).default([]),
  /** 逻辑模型。**数组顺序就是展示顺序**，队列次序靠它传递。 */
  logicalModels: z.array(ConfigSnapshotLogicalModelSchema).default([]),
  bindings: z.array(ConfigSnapshotBindingSchema).default([]),
})

/**
 * 云同步的当前状态。
 *
 * 只回「用哪种方式、配好了没」与「上次什么时候同步的」，**不回凭据本身**：
 * 凭据一经写入就不再离开密钥库，界面上只需要知道「连上了谁」。
 */
export const CloudSyncStatusSchema = z.object({
  /** 当前使用的承载方式。 */
  provider: CloudBackupKindSchema,
  /**
   * 可选的承载方式，附带各自的自述。
   *
   * 跟着状态一起回而不是单独开一个路由：界面每次都要同时拿到这两样东西，
   * 分成两次请求只会多一次闪烁。而界面**不能**自己写死一份列表——那份列表会和
   * 服务端真正注册的实现悄悄错开。
   */
  providers: z.array(CloudBackupDescriptorSchema),
  /** 密钥库里是否存在这个承载方式的凭据。 */
  credentialConfigured: z.boolean(),
  /** 凭据校验通过后缓存的账号名，用来显示「已连接为谁」；空串表示还没校验过。 */
  accountLabel: z.string(),
  /** 绑定的远端句柄；空串表示还没绑定——能不能自动新建取决于后端的 `createsTarget`。 */
  target: z.string(),
  /** 由 `target` 拼出的浏览地址，空串表示未绑定或这个后端没有这种东西。 */
  targetUrl: z.string(),
  /** 上次上传时间，`0` 表示从未上传。 */
  lastPushedTime: z.number().int().nonnegative(),
  /** 上次拉取时间，`0` 表示从未拉取。 */
  lastPulledTime: z.number().int().nonnegative(),
})

/**
 * 配置请求。
 *
 * 三个字段都可省略，省略表示**不动这一项**（而不是清空）：界面上的「换承载方式」「保存凭据」
 * 「绑定远端」是三次独立操作，各自只应该影响自己那一项。
 */
export const CloudSyncConfigureRequestSchema = z
  .object({
    /** 切换承载方式。切换会清掉旧的远端绑定（它属于上一个后端）。 */
    provider: CloudBackupKindSchema.optional(),
    /** 非空表示替换凭据；空串表示清除凭据。 */
    credential: z.string().optional(),
    /** 非空表示绑定这个远端（接受句柄或完整链接）；空串表示解绑。 */
    target: z.string().optional(),
  })
  .refine(
    input => input.provider !== undefined || input.credential !== undefined || input.target !== undefined,
    { message: 'Configure requires provider, credential or target' },
  )

/** 一次传输覆盖到的条目数，用于给用户一句「搬了多少东西」。 */
export const CloudSyncTransferSummarySchema = z.object({
  providers: z.number().int().nonnegative(),
  models: z.number().int().nonnegative(),
  logicalModels: z.number().int().nonnegative(),
  bindings: z.number().int().nonnegative(),
})

export const CloudSyncPushResultSchema = z.object({
  status: CloudSyncStatusSchema,
  pushed: CloudSyncTransferSummarySchema,
  /** 这次上传是不是顺手新建了一个远端容器（首次上传）。 */
  createdTarget: z.boolean(),
})

export const CloudSyncPullResultSchema = z.object({
  status: CloudSyncStatusSchema,
  pulled: CloudSyncTransferSummarySchema,
  /** 快照的生成时间，用来告诉用户「拉回来的是什么时候的一份」。 */
  exportedAt: z.number().int(),
})

export type ConfigSnapshot = z.infer<typeof ConfigSnapshotSchema>
export type ConfigSnapshotLogicalModel = z.infer<typeof ConfigSnapshotLogicalModelSchema>
export type ConfigSnapshotBinding = z.infer<typeof ConfigSnapshotBindingSchema>
export type CloudSyncStatus = z.infer<typeof CloudSyncStatusSchema>
export type CloudSyncConfigureRequest = z.infer<typeof CloudSyncConfigureRequestSchema>
export type CloudSyncTransferSummary = z.infer<typeof CloudSyncTransferSummarySchema>
export type CloudSyncPushResult = z.infer<typeof CloudSyncPushResultSchema>
export type CloudSyncPullResult = z.infer<typeof CloudSyncPullResultSchema>
