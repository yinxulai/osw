import { z } from 'zod'

/**
 * 云备份的**承载方式**（后端）：配置快照被放到哪儿去。
 *
 * 这里只定义一个后端要回答的**问题**——叫什么、需要用户填哪两样东西、能不能自己新建容器，
 * 不描述怎么存怎么取。实现放在 `packages/core`（`management/cloud-sync/backends`），
 * 所以这份契约里不会出现任何后端的 API 细节。
 *
 * 界面也**不硬编码任何后端**：`CloudSyncStatus` 会把可用后端连同它们的自述一起带回去，
 * 界面照着渲染就行。因此新增一个后端只动「契约里加一个 kind + core 里加一份实现 + 两套目录里的
 * 后端文案」，界面一行都不用改（见 `docs/product/cloud-sync.md`）。
 *
 * 自述里的文案一律是**目录 key** 而不是句子：服务端不知道用户用什么语言，界面才知道。
 */

/**
 * 承载方式的标识。
 *
 * 加一个成员就要在 core 的注册表里补一份实现：那边是 `Record<CloudBackupKind, CloudBackupProvider>`，
 * 漏了编译不过。同时要补上对应的文案 key（core 里有一道测试盯着这件事）。
 */
export const CloudBackupKindSchema = z.enum(['github-gist'])
export type CloudBackupKind = z.infer<typeof CloudBackupKindSchema>

/**
 * 默认承载方式。
 *
 * 只在一处出现（设置的默认值），避免「注册表里的第一个」这种隐式约定——
 * 注册表的顺序是给人看的，不该顺带决定新用户的默认后端。
 */
export const DEFAULT_CLOUD_BACKUP_KIND: CloudBackupKind = 'github-gist'

/** 一行输入的三段文案。字面值都是 `UiCatalogKey`（服务端给 key，界面翻文案）。 */
export const CloudBackupFieldSchema = z.object({
  labelKey: z.string(),
  hintKey: z.string(),
  placeholderKey: z.string(),
})
export type CloudBackupField = z.infer<typeof CloudBackupFieldSchema>

/**
 * 一个后端的自述。
 *
 * `credential` 与 `target` 是**每一种后端都要用户填的两样东西**，只是叫法不同：
 * 「GitHub 令牌 + Gist」与「WebDAV 密码 + 目录」落在同一组槽位上。界面因此只需要一组控件，
 * 不必为每个后端写一套表单。
 */
export const CloudBackupDescriptorSchema = z.object({
  kind: CloudBackupKindSchema,
  /** 选择器里这一项的名字。 */
  labelKey: z.string(),
  /**
   * 未绑定时，首次上传能不能自动新建一个容器。
   *
   * 只影响界面上的措辞：「先绑定，或上传一次自动新建」与「必须先绑定」是两种不同的下一步。
   */
  createsTarget: z.boolean(),
  credential: CloudBackupFieldSchema,
  target: CloudBackupFieldSchema,
})
export type CloudBackupDescriptor = z.infer<typeof CloudBackupDescriptorSchema>
