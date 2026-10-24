import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { safeStorage } from 'electron'
import type { SecretStore } from '@common/secret-store'

export class ElectronSecretStore implements SecretStore {
  /**
   * 写入排队。管理接口同时处理多个请求，两次 `set` 若读到同一份 JSON，
   * 后一次写回会盖掉先写入的密钥；供应商侧只存哈希，盖掉就找不回来。
   */
  private operation: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  set(reference: string, value: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      return Promise.reject(new Error('System encryption is unavailable'))
    }
    return this.runSerialized(async () => {
      const secrets = await this.readSecrets()
      secrets[reference] = safeStorage.encryptString(value).toString('base64')
      await this.writeSecrets(secrets)
    })
  }

  async get(reference: string): Promise<string | null> {
    const encrypted = (await this.readSecrets())[reference]
    if (!encrypted) return null
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch (error) {
      // 保留原密文：应用名、系统钥匙串或迁移状态恢复后，它仍可能被解开。
      console.warn(`[secrets] failed to decrypt ${reference}`, error)
      return null
    }
  }

  delete(reference: string): Promise<void> {
    return this.runSerialized(async () => {
      const secrets = await this.readSecrets()
      if (!(reference in secrets)) return
      delete secrets[reference]
      await this.writeSecrets(secrets)
    })
  }

  /** 失败的那次不能卡住后面的写入，所以链上的拒绝要吞掉；调用方拿到的仍是原来的那次拒绝。 */
  private runSerialized(operation: () => Promise<void>): Promise<void> {
    const result = this.operation.then(operation, operation)
    this.operation = result.catch(() => undefined)
    return result
  }

  private async readSecrets(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Record<string, string>
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw error
    }
  }

  private async writeSecrets(secrets: Record<string, string>): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    // 每次写入用自己的临时文件。共用一个 `.tmp` 时，后完成的 rename 会把先写好的文件挪走。
    const temporaryPath = `${this.filePath}.${crypto.randomBytes(8).toString('hex')}.tmp`
    try {
      await fs.writeFile(temporaryPath, JSON.stringify(secrets), { mode: 0o600 })
      await fs.rename(temporaryPath, this.filePath)
    } catch (error) {
      // 名字是随机的，下一次写入不会盖掉它。失败就删，避免把密文留在数据目录里。
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    }
  }
}
