import fs from 'node:fs/promises'
import path from 'node:path'
import { safeStorage } from 'electron'
import type { KeychainApi } from '@common/keychain'

export class ElectronSecretStore implements KeychainApi {
  constructor(private readonly filePath: string) {}

  async set(reference: string, value: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('System encryption is unavailable')
    }
    const secrets = await this.readSecrets()
    secrets[reference] = safeStorage.encryptString(value).toString('base64')
    await this.writeSecrets(secrets)
  }

  async get(reference: string): Promise<string | null> {
    const encrypted = (await this.readSecrets())[reference]
    if (!encrypted) return null
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  }

  async delete(reference: string): Promise<void> {
    const secrets = await this.readSecrets()
    if (!(reference in secrets)) return
    delete secrets[reference]
    await this.writeSecrets(secrets)
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
    const temporaryPath = `${this.filePath}.tmp`
    await fs.writeFile(temporaryPath, JSON.stringify(secrets), { mode: 0o600 })
    await fs.rename(temporaryPath, this.filePath)
  }
}
