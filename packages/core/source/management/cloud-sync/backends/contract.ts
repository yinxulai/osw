import type { CloudBackupDescriptor } from '@common/cloud-backup'

/**
 * 云备份后端（承载方式）的实现契约。
 *
 * 一个后端要回答的全部问题就是下面这六个方法：它叫什么、用户粘进来的东西算不算数、
 * 怎么拼浏览地址、凭据能不能用、文档怎么读、文档怎么写。**没有别的**——
 * 编排层（`service.ts`）只认这一个接口，「Gist」「WebDAV」这类词不许越过这条线。
 *
 * 与 `SecretStore` 同样的思路（见 `@common/secret-store`）：core 只定义形状，
 * 「存在哪、怎么访问」由具体实现提供，所以这里既不知道也不关心对方的 HTTP 细节。
 *
 * | 后端 | 实现 |
 * | --- | --- |
 * | GitHub Gist | `./github-gist.ts` |
 */

/** 一次读写的现场：「在哪儿、以谁的身份」。 */
export interface CloudBackupScope {
  /** 用户填的凭据明文。 */
  credential: string
  /** 远端句柄；空串表示还没绑定（能不能自动新建取决于 `descriptor.createsTarget`）。 */
  target: string
}

/** 要写出去的文档。 */
export interface CloudBackupDocument {
  /** 文件名。视作**建议**：只有一个固定位置的后端（自建 HTTP 端点之类）可以忽略它。 */
  fileName: string
  content: string
}

/** 一次写入的结果。 */
export interface CloudBackupWriteResult {
  /** 真正落地的远端句柄。首次写入（`scope.target` 为空）时由后端生成。 */
  target: string
  /** 这次写入是不是顺手新建了一个容器。 */
  created: boolean
}

export interface CloudBackupProvider {
  /** 给界面看的自述。文案是目录 key，不是句子。 */
  descriptor: CloudBackupDescriptor
  /** 用户粘进来的东西 → 规范句柄；空串 = 解绑。认不出来时抛 `VALIDATION_ERROR`。 */
  normalizeTarget(raw: string): string
  /** 句柄 → 可以在浏览器打开的地址；空串表示这个后端没有这种东西。 */
  targetUrl(target: string): string
  /** 校验凭据，返回一个展示用的账号名（界面上的「已连接为谁」）。形式由后端自己决定（GitHub 给 `@octocat`）。不接受时抛错。 */
  verifyCredential(credential: string): Promise<string>
  /**
   * 读远端文档；`null` 表示远端没有这个文件。
   *
   * 「文件不存在」是**正常状态**而不是错误：换台新机器第一次拉取之前，远端本来就什么都没有。
   * 该不该把 `null` 变成错误，是编排层的政策（它才知道用户点的是「拉取」）。
   */
  readDocument(scope: CloudBackupScope, fileName: string): Promise<string | null>
  /** 写远端文档。`scope.target` 为空串表示让后端自己新建一个容器。 */
  writeDocument(scope: CloudBackupScope, document: CloudBackupDocument): Promise<CloudBackupWriteResult>
}
