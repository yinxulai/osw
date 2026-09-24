import { CONFIG_SNAPSHOT_FILE_NAME } from '@common/cloud-sync'
import { AppError } from '@server/errors'

/**
 * 快照正文的编解码：**整份文件做 base64**，而不是只挑其中某个字段处理。
 *
 * 远端的那个文件由第三方托管，而快照里装着用户的部署信息（供应商地址、模型名、逻辑模型名）
 * 与各供应商的 API Key。整份编码而不是逐个字段脱敏，图的是两件事：
 *
 * - **一眼看不出内容**：`sk-…` 与 `https://…` 都可以被肉眼扫到，前者还会被密钥扫描器判成泄露；
 *   一整块 base64 两者都不会触发。
 * - **没有漏网字段**：以后往快照里加字段时不需要再想「这个字段要不要编码」——编码发生在整个正文上，
 *   新字段自动被覆盖。
 *
 * **这是编码，不是加密。** 任何拿到这个文件的人 `base64` 解一次就能还原全部内容，包括密钥。
 * 它挡不住有意的读取，真正的边界只有那个容器本身的可见性（Gist 是 `public: false`），
 * 而私密容器也不是加密存储。别把「不是明文」当成「安全」。
 */

/** base64 字母表加上 `=` 补位。 */
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

/** 整份快照正文 → 写进远端文件的内容。 */
export function encodeSnapshotDocument(json: string): string {
  return Buffer.from(json, 'utf8').toString('base64')
}

/**
 * 远端文件内容 → 快照正文。
 *
 * **认 JSON 原文**：整份编码是后加的，在此之前推上去的文件就是 JSON 本身。这类文件靠第一个
 * 字符区分——JSON 必定以 `{` 开头，而 `{` 不在 base64 字母表里，两种格式不会互相冒充。
 * 不兼容旧文件的话，升级后第一次拉取会撞上一个「远端文件坏了」的假故障，而那其实是我们自己换了格式。
 */
export function decodeSnapshotDocument(content: string): string {
  const trimmed = content.trim()
  if (trimmed.startsWith('{')) return trimmed
  // `Buffer.from(…, 'base64')` 遇到非法字符不会报错，只会把它们丢掉——所以合法性得自己判，
  // 否则一段随便什么文本都会「解码成功」成一个更没意义的短串。
  if (trimmed.length === 0 || trimmed.length % 4 !== 0 || !BASE64_PATTERN.test(trimmed)) throw invalidEncoding()
  const decoded = Buffer.from(trimmed, 'base64').toString('utf8')
  // 空串或带替换字符（UTF-8 解坏了）说明这不是我们写出去的东西。
  if (decoded.length === 0 || decoded.includes('\uFFFD')) throw invalidEncoding()
  return decoded
}

function invalidEncoding(): AppError {
  return new AppError(
    'CLOUD_SYNC_REMOTE_FILE_INVALID',
    502,
    `${CONFIG_SNAPSHOT_FILE_NAME} at the remote location is neither base64 nor JSON`,
    { details: { fileName: CONFIG_SNAPSHOT_FILE_NAME } },
  )
}
