/**
 * 单实例锁（core 基本能力）。
 *
 * 两个进程指向同一个数据目录会真出事：后启动的那个会覆盖运行时文件，先启动的进程
 * **失去身份**——`stop` 再也找不到它，它却还占着端口、还开着同一对 SQLite 文件。
 * 端口冲突只能挡住「沿用默认端口」的那一半情况，换个端口就绕过去了。
 *
 * 放在 core 而不是命令行宿主里，是因为这件事对**两种形态同等成立**：桌面端双击两次、
 * 或「桌面端在跑 + 命令行指定另一个端口启动」都会踩到同一对数据库文件。谁先认领
 * 数据目录谁就是那个实例，与「怎么把它起来」无关。
 *
 * 为什么不能只看运行时文件：那份文件是**监听成功之后**才写的（早写会让 `status`
 * 报出一个还没在跑的实例），两个进程同时走到那个点之前有一段谁都看不见的空窗。
 * 锁用 `open(path, 'wx')` 的原子创建把这个空窗收掉：并发时只有一个能创建成功。
 *
 * 锁**不长期持有句柄**：Windows 上 `fs` 的默认共享模式允许别的进程删掉它，持有句柄
 * 并不能形成强制锁。所以它是一份「带 pid 的声明」，残留靠三条判断来识别：
 *   1. 持有的就是**本进程自己**（见 `acquireInstanceLock` 里那段注释：崩溃重启的残影，
 *      或 pid 被系统回收后恰好又回到自己身上）→ 残留；
 *   2. 持有者 pid 已死 → 残留；
 *   3. 心跳过期 → 残留。**只看 pid 是不够的**：系统会把 pid 复用给无关进程，
 *      那时「pid 活着」并不代表锁的主人还在，用户会被一个自己不认识的理由永久拦住，
 *      只能手删锁文件。心跳由持有者定时改写，被复用的 pid 不会替我们续期。
 */

import fs from 'node:fs/promises'
import path from 'node:path'

export const LOCK_FILE_NAME = 'instance.lock'

/**
 * 「锁文件刚建出来、内容还没写进去」的宽限期。
 *
 * 创建与写入之间必然有一瞬是空文件。读到空文件时不能立刻当成残留删掉——那会让两个
 * 进程都以为自己拿到了锁。按 mtime 给一小段宽限，超过它才是**真的**残留（上次崩溃
 * 留下的半截文件）。取 5s 是因为这段时间远大于一次本地写入，又远小于人手重试的间隔。
 */
const WRITE_GRACE_MILLISECONDS = 5_000

/** 持有者的心跳间隔。 */
const HEARTBEAT_INTERVAL_MILLISECONDS = 5_000

/**
 * 心跳过期阈值。
 *
 * 取心跳间隔的 6 倍：既容得下事件循环被一次长任务占住（比如启动时的一次性迁移），
 * 又远小于「用户以为进程已经死了、去手动清理」的耐心。调得太小会把活着的实例误判成
 * 残留，那是双实例的直接成因，比误判成「有人在跑」严重得多。
 */
const HEARTBEAT_STALE_MILLISECONDS = HEARTBEAT_INTERVAL_MILLISECONDS * 6

/** 抢锁的重试次数：每次重试都意味着撞上了一个刚被判定为残留的锁。 */
const MAX_ATTEMPTS = 3

export interface LockHolder {
  pid: number
  startedAt: string
  /** 最后一次心跳的 ISO 时间；老版本写下的锁文件没有这一项，按 `startedAt` 兜底。 */
  heartbeatAt?: string
}

export interface InstanceLock {
  /** 可重复调用。 */
  release(): Promise<void>
}

export type AcquireLockResult =
  | { ok: true; lock: InstanceLock }
  | { ok: false; reason: 'held'; holder: LockHolder }
  /** 锁文件存在但读不出持有者，且还没过宽限期——无法判断，按「有人在动」处理。 */
  | { ok: false; reason: 'indeterminate'; filePath: string }

/**
 * 「这个数据目录已经被别的实例认领」。
 *
 * 单独一个错误类型，是因为两个宿主都必须把它与「端口被占」「数据库打不开」区分开：
 * 前者的正确处理是「聚焦已有实例 / 提示已经在运行」，后者才是启动失败。
 */
export class InstanceLockError extends Error {
  constructor(readonly holder: LockHolder | null, readonly filePath: string) {
    super(holder === null
      ? `Another instance is starting in this data directory (lock is unreadable: ${filePath})`
      : `Another instance is already running in this data directory (pid ${holder.pid})`)
    this.name = 'InstanceLockError'
  }
}

export function lockFilePath(dataDir: string): string {
  return path.join(dataDir, LOCK_FILE_NAME)
}

/**
 * 取锁并开始续心跳。失败**不抛异常**：调用方要用不同文案区分「别人在跑」与
 * 「状态不明」，压成一个异常只剩一句笼统的「启动失败」。
 */
export async function acquireInstanceLock(dataDir: string): Promise<AcquireLockResult> {
  const filePath = lockFilePath(dataDir)
  await fs.mkdir(dataDir, { recursive: true })

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      await fs.writeFile(filePath, JSON.stringify(holder(), null, 2), { flag: 'wx', mode: 0o600 })
      return { ok: true, lock: { release: () => releaseInstanceLock(dataDir) } }
    } catch (error) {
      // 只有「已存在」才是预期的竞争结果，其余（权限、只读目录）照旧往上抛。
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }

    const existing = await readLockHolder(filePath)
    if (existing === null) {
      if (await isWithinWriteGrace(filePath)) return { ok: false, reason: 'indeterminate', filePath }
      // 过了宽限期还读不出来：上次崩溃留下的半截文件，清掉重试。
      await removeLockFile(filePath)
      continue
    }

    // 持有者就是本进程：这锁不再是「别的实例在跑」，而是残影。
    //
    // 正常路径本来撞不到这里：服务跑在**独立进程**里，重启时是新 pid，上一个化身的 pid
    // 已经死了，会被上面的 `isHolderAlive` 收掉（宿主也只在收到进程 exit 之后才重起，
    // 见 `service-host.ts` 的 `scheduleRestart`）。这条分支兜的是两种剩下的情况：
    //   - 宿主处置的是「服务自己报失败」而不是进程退出，那一瞬旧 pid 可能还在；
    //   - pid 被系统回收后，恰好又分给了新的服务进程。
    // 两种都是残留，不是别人在跑——锁的主人是自己这件事，在任何情况下都不构成
    // 「另一个实例正拿着它」。不加这一条，上面两种情况都要干等
    // `HEARTBEAT_STALE_MILLISECONDS`（30s）才能起来。
    // 接管动作仍然只发生在这个竞争者内部，没有给宿主开「替别人清残留」的口子。
    if (existing.pid === process.pid) {
      await removeLockFile(filePath)
      continue
    }

    if (await isHolderAlive(existing)) return { ok: false, reason: 'held', holder: existing }

    // 持有者已经不在（或者心跳早就停了）：崩溃、被强杀或 pid 被复用后留下的锁。
    await removeLockFile(filePath)
  }

  // 重试耗尽说明竞争异常激烈（或每次清掉都立刻被别人抢走）。报「状态不明」而不是
  // 「有人在跑」——我们确实不知道谁在跑，让调用方给出「再试一次」的指引。
  return { ok: false, reason: 'indeterminate', filePath }
}

/**
 * 已经进了 `refreshHeartbeat`、但还没写完的次数。
 *
 * `clearInterval` 只能取消还没开始的那一拍。停在 `writeFile` / `rename` 上的那一次
 * 仍会在锁被删掉之后把旧 pid 写回去。释放必须等它结束（写成或失败都算结束）再删，
 * 否则 `stop` 返回后这次 `rename` 还能把文件造出来。
 */
let pendingHeartbeats = 0
const heartbeatWaiters: Array<() => void> = []

function trackHeartbeat(start: () => Promise<void>): Promise<void> {
  // 先计入，再去读盘。返回前没有 `await`，调用方拿到 promise 时这次写入已经算进行中。
  pendingHeartbeats += 1
  const work = start()
  // 成功和失败都要放行等待者。写失败如果把拒绝留在这条链上，`releaseInstanceLock`
  // 会一直等，`stop` 就不再往下走；调用方拿到的仍是原来的那个 promise。
  void work.then(() => undefined, () => undefined).finally(() => {
    pendingHeartbeats -= 1
    if (pendingHeartbeats > 0) return
    const waiters = heartbeatWaiters.splice(0)
    for (const resolve of waiters) resolve()
  })
  return work
}

function waitForInFlightHeartbeat(): Promise<void> {
  if (pendingHeartbeats === 0) return Promise.resolve()
  return new Promise(resolve => {
    heartbeatWaiters.push(resolve)
  })
}

/**
 * 释放锁。
 *
 * 先等进行中的心跳结束，再确认持有者还是自己。别人（或上一个进程）留下的残留被清算
 * 之后，可能已经有新实例抢到了这把锁，那时把别人的锁删掉会直接打开「双实例」的口子。
 * 心跳落地前不删文件：这次 `rename` 改的仍是自己的锁，等它结束再删，`stop` 返回后
 * 这个进程不会再碰这份文件。
 */
export async function releaseInstanceLock(dataDir: string): Promise<void> {
  // 没有进行中的心跳时保持原来的同步路径，不额外让出一次微任务。
  if (pendingHeartbeats > 0) await waitForInFlightHeartbeat()

  const filePath = lockFilePath(dataDir)
  const existing = await readLockHolder(filePath)
  if (existing !== null && existing.pid !== process.pid) return
  await removeLockFile(filePath)
}

/**
 * 只读地看一眼当前持有者（`instance-lock.test.ts` 用来断言锁文件里写了什么）。
 *
 * 清理**没有**单独的导出：残留锁的接手就在 `acquireInstanceLock` 里完成（读不出持有者
 * 且过了宽限期、或持有者已死，都会就地清掉重试）。不把它开成一个「谁来清残留」的口子，
 * 是因为一旦宿主也能删，就多出一种「两边同时动手」的可能，而这件事只该有一个主人。
 */
export async function readLockHolder(filePath: string): Promise<LockHolder | null> {
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch {
    return null
  }
  try {
    const value = JSON.parse(raw) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    if (typeof record.pid !== 'number' || typeof record.startedAt !== 'string') return null
    const heartbeatAt = typeof record.heartbeatAt === 'string' ? record.heartbeatAt : undefined
    return { pid: record.pid, startedAt: record.startedAt, ...(heartbeatAt === undefined ? {} : { heartbeatAt }) }
  } catch {
    return null
  }
}

/**
 * 心跳：定时把锁文件改写成「我还活着」。
 *
 * 返回的停止函数必须被调用（`ServerRuntime.stopResources()` 会做），否则进程退出后
 * 定时器会让 Node 一直不退出。
 */
export function startInstanceLockHeartbeat(dataDir: string): () => void {
  const timer = setInterval(() => {
    // 尽力而为：一次写不进去（磁盘忙、文件被别的实例清掉）不该让进程崩掉，
    // 下一次心跳会重试；真的连续失败到超过阈值，别的实例接管本来就是正确行为。
    void refreshHeartbeat(dataDir).catch(() => undefined)
  }, HEARTBEAT_INTERVAL_MILLISECONDS)
  // 不 unref：这个定时器是「我还活着」的证明，必须让事件循环为它保持活跃。
  return () => clearInterval(timer)
}

/**
 * 原子改写自己的心跳时间。
 *
 * 先写临时文件再 rename：`stop` / `status` 随时可能来读，原地覆写会让它们读到写了一半
 * 的 JSON，而「读不出持有者」在宽限期内会被当成「有人在动」——那会变成一次假拒绝。
 *
 * 计数加在本函数返回之前，中间不让出事件循环。调用方拿到 promise 时，这次写入已经算进行中。
 */
export function refreshHeartbeat(dataDir: string): Promise<void> {
  return trackHeartbeat(() => writeHeartbeat(dataDir))
}

async function writeHeartbeat(dataDir: string): Promise<void> {
  const filePath = lockFilePath(dataDir)
  const existing = await readLockHolder(filePath)
  if (existing === null || existing.pid !== process.pid) return

  const temporaryPath = `${filePath}.tmp`
  const next: LockHolder = { pid: existing.pid, startedAt: existing.startedAt, heartbeatAt: new Date().toISOString() }
  await fs.writeFile(temporaryPath, JSON.stringify(next, null, 2), { mode: 0o600 })
  await fs.rename(temporaryPath, filePath)
}

function holder(): LockHolder {
  const now = new Date().toISOString()
  return { pid: process.pid, startedAt: now, heartbeatAt: now }
}

/**
 * 持有者是否还在。
 *
 * 两条判断缺一不可：pid 死了一定不在；pid 活着但心跳早就停了，说明那是被复用的 pid
 * 或者卡死的进程，此时锁已经不再表达「有人在用这个数据目录」。
 */
async function isHolderAlive(holder: LockHolder): Promise<boolean> {
  if (!(await isProcessAlive(holder.pid))) return false

  const heartbeat = holder.heartbeatAt ?? holder.startedAt
  const heartbeatTime = Date.parse(heartbeat)
  if (Number.isNaN(heartbeatTime)) return true
  return Date.now() - heartbeatTime < HEARTBEAT_STALE_MILLISECONDS
}

/**
 * 进程是否还在。
 *
 * `kill(pid, 0)` 不发信号，只做存在性检查。`EPERM` 表示进程存在但不属于当前用户——
 * 算活着，否则以 root 启动的实例在普通用户下会被误判成「已停止」。
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function isWithinWriteGrace(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath)
    return Date.now() - stat.mtimeMs < WRITE_GRACE_MILLISECONDS
  } catch {
    // stat 失败说明文件在我们看它之前就没了：那它就不是「有人在写」，可以直接重试。
    return false
  }
}

async function removeLockFile(filePath: string): Promise<void> {
  try {
    await fs.rm(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
