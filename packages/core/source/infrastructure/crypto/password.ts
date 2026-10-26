/**
 * 管理账号的口令哈希。
 *
 * ## 为什么是 `scrypt` 而不是别的
 *
 * 三个候选都考虑过：
 *
 *   - **明文 / 可逆加密**：直接排除。管理面板能导出明文供应商密钥，口令与它同级。
 *   - **SHA-256 加盐**：错在**快**。快哈希在现代 GPU 上是每秒十亿次量级，一个 8 位口令
 *     的整片搜索空间只要几分钟。口令哈希需要的恰恰是「慢」，而 `node:crypto` 里
 *     **只有 `scrypt` 是内存硬（memory-hard）的**——每个并发猜测都要占 N×r×128 字节的
 *     内存，把「用显存堆并发」这条路直接堵死。
 *   - **`argon2` / `bcrypt`**：都要原生依赖。这个仓库的既定取舍是零原生依赖
 *     （连密钥库都是 AES-256-GCM 自己写的，见 `security-privacy.md`），加一个要在
 *     Electron、三平台、Node 22 都编译通过的 native 模块，代价远大于收益。
 *
 * 所以是 `scrypt`，参数取 OWASP 的推荐档：`N=2^15, r=8, p=1`（约 32 MiB / 次）。
 *
 * ## 为什么存「自描述的编码串」而不是裸摘要
 *
 * `scrypt$2^15$8$1$<salt-b64>$<hash-b64>`——参数跟着每一行走。将来调高 N 时，老账号
 * 仍然按**它自己那行的参数**验证，不需要一次全表重算；也可以在验证成功后按新参数
 * 顺手重写一次（本文件不自动做，`accounts.ts` 也没做：现在只有一档参数，做迁移是
 * 白写的代码，说明留在注释里就够）。
 *
 * ## 时序
 *
 * 验证失败与「用户不存在」必须走**同样长**的路：`accounts.ts` 在账号不存在时也会跑一次
 * 本文件的 `verifyPassword`（对着一个固定的假哈希），否则响应时间就成了一张用户名清单。
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keyLength: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>

/**
 * 当前参数。
 *
 * `maxmem` 必须显式给：Node 的默认上限是 32 MiB，而 `N=2^15, r=8` 恰好需要
 * `128 * 8 * 32768 = 32 MiB`，正好卡在边界上——不给就会随机抛 `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`。
 */
const SCRYPT_N = 2 ** 15
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024
const SALT_BYTES = 16
const KEY_BYTES = 32

/**
 * 账号不存在时用来「陪跑」的哈希。
 *
 * 内容无所谓（没人知道对应的口令），要紧的是它**能被解析**、参数与真哈希一致，于是
 * 那条路径的耗时分毫不差。生成时机是模块加载，只在第一次校验时付一次代价。
 */
let decoyHashPromise: Promise<string> | null = null

function decode(encoded: string): { N: number; r: number; p: number; salt: Buffer; hash: Buffer } | null {
  const parts = encoded.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null
  const N = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return null
  if (N <= 0 || r <= 0 || p <= 0) return null
  try {
    return { N, r, p, salt: Buffer.from(parts[4], 'base64'), hash: Buffer.from(parts[5], 'base64') }
  } catch {
    return null
  }
}

/** 把口令编成自描述的哈希串。口令只在这里出现一次，不落任何缓存。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const hash = await scryptAsync(password, salt, KEY_BYTES, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAX_MEMORY })
  return ['scrypt', String(SCRYPT_N), String(SCRYPT_R), String(SCRYPT_P), salt.toString('base64'), hash.toString('base64')].join('$')
}

/**
 * 校验口令。
 *
 * 一律用 `timingSafeEqual`：`===` 在第一个不同字节就返回，把「前几个字符猜对了」这件事
 * 变成了一个可观测的信号。
 *
 * 哈希串畸形时返回 `false` 而不是抛错：一条坏掉的行不该让整个登录接口 500——那会把
 * 「这个账号坏了」广播给任何尝试登录的人。
 */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const decoded = decode(encoded)
  if (!decoded) return false
  const computed = await scryptAsync(password, decoded.salt, decoded.hash.length, {
    N: decoded.N,
    r: decoded.r,
    p: decoded.p,
    // 老行可能带着比当前更大的 N：上限要跟着那一行走，否则将来降参数会让老账号验证直接抛错。
    maxmem: Math.max(SCRYPT_MAX_MEMORY, 128 * decoded.r * decoded.N * 2),
  })
  if (computed.length !== decoded.hash.length) return false
  return timingSafeEqual(computed, decoded.hash)
}

/** 账号不存在时对着它跑一遍，让两条路径耗时一致。见文件头的「时序」。 */
export async function getDecoyHash(): Promise<string> {
  decoyHashPromise ??= hashPassword(randomBytes(24).toString('base64'))
  return decoyHashPromise
}
