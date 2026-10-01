/**
 * 命令行的密钥存储：本地文件 + AES-256-GCM。
 *
 * 实现的是同一个 `SecretStore` 接口（`apps/docs/specs/packaging.md` §5.1），两种形态各有一份实现，
 * 因为「密钥放哪儿」是宿主的能力差异：Electron 有 `safeStorage`（系统钥匙串），
 * 命令行没有原生依赖可依靠。算法不同，落盘文件也就不能同名——见下面 `SECRETS_FILE_NAME`。
 *
 * 取舍写清楚：这是**文件级加密**。它防的是备份被拷走、配置文件被误传、同机器上别的用户
 * 读到了文件。它**不防**「同一个用户下的恶意进程」——那种进程本来就能读到主密钥文件。
 * 想要更强的保证需要系统钥匙串，那会引入原生依赖，与 §8「零原生依赖」的约束冲突。
 *
 * 主密钥（`secrets.key`，32 字节随机，权限 0600）：
 *   - 缺失 → 自动生成。首次使用不该要求用户做任何事。
 *   - 存在但读不出来或长度不对 → **报错退出，绝不重建**。静默重建等于把用户已经存过的
 *     供应商密钥全部作废，而那些 key 在供应商侧只存哈希，是不可再生的。
 *   - `OSW_SECRET_KEY`（base64 的 32 字节）可覆盖，供不落盘主密钥的容器/CI 场景。
 */

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { SecretStore } from '@common/secret-store'
import { describeError } from './errors'

/**
 * 命令行形态的密文与主密钥文件名。
 *
 * **故意不与桌面形态共用**（桌面形态用的是数据目录下的 `secrets.json`）：
 * 密文算法是宿主能力，两种形态写出来的条目互不相识——桌面形态的 `safeStorage`
 * 密文在命令行侧读不出来，命令行的 `v1:iv:tag:ciphertext` 在 `safeStorage` 侧会被当成
 * 非法 base64 直接抛错。同名同址的结果不是「共用一份密钥」，而是**后写的那个把前一个的
 * 条目全部作废**（供应商 key 在服务端只存哈希，作废了不可再生）。
 *
 * 代价写在明处：同一个数据目录里，两个形态的密钥各存各的，用命令行 Web 控制台配过的 key
 * 在桌面端不会自动出现（反之亦然）。共用的是数据库、设置与日志——供应商条目本身就带着
 * `keyReference`，所以另一边看到的是「这个供应商没配密钥」，而不是静默用空密钥发请求。
 * 想真正共用密钥只能让一边放弃自己的密码学实现，见 `apps/docs/specs/packaging.md` §5.1。
 */
export const SECRETS_FILE_NAME = 'secrets.cli.json'
export const MASTER_KEY_FILE_NAME = 'secrets.cli.key'
const MASTER_KEY_BYTES = 32
const INITIALIZATION_VECTOR_BYTES = 12
const ALGORITHM = 'aes-256-gcm'

/** 密文格式版本：以后换算法时靠它区分新旧条目，不至于把旧数据当成损坏。 */
const CIPHER_PREFIX = 'v1'

export const MASTER_KEY_ENVIRONMENT_VARIABLE = 'OSW_SECRET_KEY'

export class EncryptedFileSecretStore implements SecretStore {
  private masterKey: Promise<Buffer> | null = null

  constructor(private readonly dataDirectory: string) {}

  async set(reference: string, value: string): Promise<void> {
    const secrets = await this.readSecrets()
    secrets[reference] = await this.encrypt(value)
    await this.writeSecrets(secrets)
  }

  async get(reference: string): Promise<string | null> {
    const encrypted = (await this.readSecrets())[reference]
    if (!encrypted) return null
    return this.decrypt(encrypted, reference)
  }

  async delete(reference: string): Promise<void> {
    const secrets = await this.readSecrets()
    if (!(reference in secrets)) return
    delete secrets[reference]
    await this.writeSecrets(secrets)
  }

  private async encrypt(value: string): Promise<string> {
    const key = await this.loadMasterKey()
    const initializationVector = crypto.randomBytes(INITIALIZATION_VECTOR_BYTES)
    const cipher = crypto.createCipheriv(ALGORITHM, key, initializationVector)
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    // GCM 的认证标签与密文分开存：四个字段用一个字符串表达，保持 `secrets.json` 仍是
    // 「键 → 字符串」的简单结构，将来换存储也容易搬。base64 里不会有 `:`。
    return [
      CIPHER_PREFIX,
      initializationVector.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      ciphertext.toString('base64'),
    ].join(':')
  }

  private async decrypt(stored: string, reference: string): Promise<string> {
    const [prefix, initializationVector, authTag, ciphertext] = stored.split(':')
    if (prefix !== CIPHER_PREFIX || !initializationVector || !authTag || ciphertext === undefined) {
      throw new Error(`Secret "${reference}" is not in the expected ${CIPHER_PREFIX} format`)
    }
    const key = await this.loadMasterKey()
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(initializationVector, 'base64'))
    decipher.setAuthTag(Buffer.from(authTag, 'base64'))
    // 认证失败（密钥换了、密文被改过）时 `final()` 抛出：让它抛，冒充成「没有这个密钥」
    // 只会让调用方以为用户没配过，然后静默走一遍没密钥的流程。
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8')
  }

  /** 主密钥只解析一次：它要么是常量，要么是一次读盘，没有中途变卦的理由。 */
  private loadMasterKey(): Promise<Buffer> {
    if (!this.masterKey) this.masterKey = resolveMasterKey(this.dataDirectory)
    return this.masterKey
  }

  private async readSecrets(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.dataDirectory, SECRETS_FILE_NAME), 'utf8')) as Record<string, string>
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw error
    }
  }

  private async writeSecrets(secrets: Record<string, string>): Promise<void> {
    await fs.mkdir(this.dataDirectory, { recursive: true })
    const filePath = path.join(this.dataDirectory, SECRETS_FILE_NAME)
    const temporaryPath = `${filePath}.tmp`
    await fs.writeFile(temporaryPath, JSON.stringify(secrets), { mode: 0o600 })
    await fs.rename(temporaryPath, filePath)
  }
}

async function resolveMasterKey(dataDirectory: string): Promise<Buffer> {
  const fromEnvironment = process.env[MASTER_KEY_ENVIRONMENT_VARIABLE]
  if (fromEnvironment) {
    return parseMasterKey(fromEnvironment, `$${MASTER_KEY_ENVIRONMENT_VARIABLE}`)
  }

  const keyPath = path.join(dataDirectory, MASTER_KEY_FILE_NAME)
  let stored: string
  try {
    stored = await fs.readFile(keyPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(
        `Cannot read the OSW master key at ${keyPath} (${describeError(error)}). ` +
          'Refusing to create a new one: the existing secrets would become unreadable.',
      )
    }
    const generated = crypto.randomBytes(MASTER_KEY_BYTES)
    await fs.mkdir(dataDirectory, { recursive: true })
    const temporaryPath = `${keyPath}.tmp`
    await fs.writeFile(temporaryPath, generated.toString('base64'), { mode: 0o600 })
    await fs.rename(temporaryPath, keyPath)
    return generated
  }

  return parseMasterKey(stored.trim(), keyPath)
}

function parseMasterKey(raw: string, source: string): Buffer {
  const key = Buffer.from(raw, 'base64')
  if (key.length !== MASTER_KEY_BYTES) {
    throw new Error(`${source} must be a base64 encoded ${MASTER_KEY_BYTES}-byte key, got ${key.length} bytes`)
  }
  return key
}
