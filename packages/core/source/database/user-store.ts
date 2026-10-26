/**
 * 管理账号的存储层。
 *
 * 一行的身份是 `id`（`user_` 前缀），不是 `username`：`config-schema.ts` 文件头第 4 条
 * 把「不许重名」这条规则留在应用层，所以这里必须自己回答它，并且给一句能照做的错误
 * （`MANAGEMENT_ACCOUNT_EXISTS`），而不是让 SQLite 抛一个 `UNIQUE constraint failed`。
 *
 * ## 口令在这一层只有一个方向
 *
 * 进：`createAccount` / `changePassword` 收明文，立刻交给 `hashPassword`。
 * 出：本文件**没有任何**返回哈希的公开函数——`listAccounts` 返回的是契约里的
 * `ManagementUser`，四个字段，没有哈希。唯一读哈希的地方是 `verifyCredentials` 内部，
 * 它也只回一个布尔值与账号本身。这条约束不是洁癖：管理 API 的响应会被浏览器、日志与
 * 截图带出去，一个「顺手把行对象返回出去」的改动就能把全站哈希泄到前端。
 */

import { and, eq, ne, sql } from 'drizzle-orm'
import { MANAGEMENT_PASSWORD_MIN_LENGTH, ManagementUsernameSchema, type ManagementUser } from '@common/auth'
import { now } from '@common/utils'
import { generateId } from '@common/utils'
import { AppError } from '@server/errors'
import { users } from './config-schema'
import { getConfigDb } from './index'
import { getDecoyHash, hashPassword, verifyPassword } from '../infrastructure/crypto/password'

type UserRowLike = { id: string; username: string; createdTime: number; lastLoginTime: number | null }

function mapUser(row: UserRowLike): ManagementUser {
  return {
    id: row.id,
    username: row.username,
    createdTime: Number(row.createdTime),
    lastLoginTime: row.lastLoginTime === null ? null : Number(row.lastLoginTime),
  }
}

/**
 * 库里有没有账号。
 *
 * 它是「这台服务要不要登录」的**唯一事实来源**（见 `../management/auth/service.ts`）：
 * 有账号就意味着有人给这台服务设过防，界面与 CLI 都按这一条判断该不该要口令。
 */
export async function hasAnyAccount(): Promise<boolean> {
  const row = getConfigDb().select({ id: users.id }).from(users).limit(1).get()
  return row !== undefined
}

export async function countAccounts(): Promise<number> {
  const row = getConfigDb().select({ value: sql<number>`count(*)` }).from(users).get()
  return Number(row?.value ?? 0)
}

/** 列账号。按创建时间升序：第一个（通常是管理员自己）在最前。 */
export async function listAccounts(): Promise<ManagementUser[]> {
  const rows = getConfigDb().select().from(users).orderBy(users.createdTime).all()
  return rows.map(row => mapUser({ ...row, createdTime: Number(row.createdTime), lastLoginTime: row.lastLoginTime === null ? null : Number(row.lastLoginTime) }))
}

export async function getAccountByUsername(username: string): Promise<ManagementUser | null> {
  const row = getConfigDb().select().from(users).where(eq(users.username, username)).get()
  return row ? mapUser({ ...row, createdTime: Number(row.createdTime), lastLoginTime: row.lastLoginTime === null ? null : Number(row.lastLoginTime) }) : null
}

export async function getAccountById(id: string): Promise<ManagementUser | null> {
  const row = getConfigDb().select().from(users).where(eq(users.id, id)).get()
  return row ? mapUser({ ...row, createdTime: Number(row.createdTime), lastLoginTime: row.lastLoginTime === null ? null : Number(row.lastLoginTime) }) : null
}

/**
 * 口令强度下限。
 *
 * 只卡长度，理由见 `@common/auth` 的 `MANAGEMENT_PASSWORD_MIN_LENGTH`。
 * 错误码是 `MANAGEMENT_WEAK_PASSWORD`：界面要能说清「差在哪儿」，而不是「保存失败」。
 */
function assertPasswordStrength(password: string): void {
  if (password.length < MANAGEMENT_PASSWORD_MIN_LENGTH) {
    throw new AppError('MANAGEMENT_WEAK_PASSWORD', 400, `password must be at least ${MANAGEMENT_PASSWORD_MIN_LENGTH} characters`, {
      details: { minimum: MANAGEMENT_PASSWORD_MIN_LENGTH },
    })
  }
}

/** 用户名不合规时给同一句能照做的提示，与口令强度分开。 */
function assertUsername(username: string): string {
  const parsed = ManagementUsernameSchema.safeParse(username)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 400, 'username must be 1-64 characters of letters, digits, dot, underscore or hyphen')
  }
  return parsed.data
}

/**
 * 建账号。
 *
 * 「不许重名」在这里判：先查一次，写完之后再查一次也不算多余——本服务是单进程、单线程
 * 写一条 SQLite，两次登录请求不会真的交错，一次检查足够；多一次检查只是多一次全表扫。
 *
 * 调用方（`../routes/operations/auth.ts`）负责「第一个账号可以在没有凭证时创建」这类
 * 授权判断，本函数只管数据是否成立。
 */
export async function createAccount(username: string, password: string): Promise<ManagementUser> {
  const name = assertUsername(username)
  assertPasswordStrength(password)

  const db = getConfigDb()
  if (db.select({ id: users.id }).from(users).where(eq(users.username, name)).get()) {
    throw new AppError('MANAGEMENT_ACCOUNT_EXISTS', 409, `account ${name} already exists`, { details: { username: name } })
  }

  const time = now()
  const row = {
    id: generateId('user_'),
    username: name,
    passwordHash: await hashPassword(password),
    lastLoginTime: null,
    createdTime: time,
    updatedTime: time,
  }
  db.insert(users).values(row).run()
  return mapUser(row)
}

/**
 * 校验口令。
 *
 * **账号不存在也走一遍哈希**（对着 `getDecoyHash()`）。少了这条，响应时间就成了一张
 * 用户名清单：不存在的账号立刻返回，存在的账号要等 30 MiB 的 scrypt 跑完。
 *
 * 返回 `null` 表示「用户名或口令不对」，不区分两者——同一个理由。
 */
export async function verifyCredentials(username: string, password: string): Promise<ManagementUser | null> {
  const row = getConfigDb().select().from(users).where(eq(users.username, username)).get()
  const matches = await verifyPassword(password, row?.passwordHash ?? await getDecoyHash())
  // 两个条件都要判：`matches` 在账号不存在时是 false，但在一个畸形的哈希行上也会是 false。
  if (!row || !matches) return null

  const time = now()
  getConfigDb().update(users).set({ lastLoginTime: time, updatedTime: time }).where(eq(users.id, row.id)).run()
  return mapUser({ ...row, createdTime: Number(row.createdTime), lastLoginTime: time })
}

/**
 * 改口令。
 *
 * 不校验旧口令：调用方已经过了网关那道门（要么带着启动凭证，要么带着一张有效会话），
 * 再问一次旧口令只是让「用户忘了口令想重置」变成一个走不通的死角。真要更严，那是
 * 「改自己的口令」这个具体入口该做的，不是存储层的规则。
 */
export async function changePassword(id: string, password: string): Promise<ManagementUser> {
  assertPasswordStrength(password)
  const db = getConfigDb()
  const row = db.select().from(users).where(eq(users.id, id)).get()
  if (!row) throw new AppError('MANAGEMENT_ACCOUNT_NOT_FOUND', 404, `account ${id} not found`, { details: { id } })

  const time = now()
  const passwordHash = await hashPassword(password)
  db.update(users).set({ passwordHash, updatedTime: time }).where(eq(users.id, id)).run()
  return mapUser({ ...row, createdTime: Number(row.createdTime), lastLoginTime: row.lastLoginTime === null ? null : Number(row.lastLoginTime) })
}

/**
 * 删账号。
 *
 * **不许删掉最后一个**：删完之后这台服务就再也登不进去了（而它可能正监听在
 * `0.0.0.0` 上、被一堆人用着）。要换成别的账号，先建新的再删旧的。
 *
 * 这条规则和「不许重名」一样是应用层的规则，不是 DB 约束——它约束的是「这一行的存在
 * 与其它行的关系」，写不进一行里。
 */
export async function deleteAccount(id: string): Promise<void> {
  const db = getConfigDb()
  const row = db.select().from(users).where(eq(users.id, id)).get()
  if (!row) throw new AppError('MANAGEMENT_ACCOUNT_NOT_FOUND', 404, `account ${id} not found`, { details: { id } })

  const remaining = db.select({ id: users.id }).from(users).where(ne(users.id, id)).limit(1).get()
  if (!remaining) {
    throw new AppError('MANAGEMENT_LAST_ACCOUNT', 409, 'the last account cannot be deleted', { details: { username: row.username } })
  }

  db.delete(users).where(and(eq(users.id, id))).run()
}
