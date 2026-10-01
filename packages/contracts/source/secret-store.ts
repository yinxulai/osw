/**
 * 密钥存储契约。
 *
 * 设计目标：API Key 等敏感信息不落数据库，数据库里只留一个 reference ID。
 * 这里只描述形状，具体实现由宿主提供——core 不知道密钥存在哪儿，也就不会
 * 长出「Electron 专属」的分支（见 `apps/docs/product/packaging.md` §5.1）。
 *
 * | 宿主 | 实现 | 载体 |
 * | --- | --- | --- |
 * | App | `ElectronSecretStore` | `safeStorage` + 本地文件 |
 * | CLI | `EncryptedFileSecretStore` | 本地文件 AES-256-GCM |
 */

export interface SecretStore {
  set(reference: string, value: string): Promise<void>
  get(reference: string): Promise<string | null>
  delete(reference: string): Promise<void>
}

/** 生成 key reference ID。数据库里存的只有它，取回密钥时用它换。 */
export function generateKeyReference(prefix = 'key_'): string {
  return `${prefix}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
