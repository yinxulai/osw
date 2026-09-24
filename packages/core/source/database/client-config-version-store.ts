import { createHash } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import { generateId, now } from '@common/utils'
import type { ClientConfigVersion, ClientConfigVersionOrigin, ClientConfigVersionSummary } from '@common/client-config'
import { getConfigDb } from './index'
import { clientConfigVersions } from './config-schema'

/** 内容摘要。去重、以及「这次改动到底改没改」都以它为准。 */
export function hashClientConfigContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

const PREVIEW_LENGTH = 240

function toPreview(content: string): string {
  return content.length > PREVIEW_LENGTH ? content.slice(0, PREVIEW_LENGTH) : content
}

const SUMMARY_COLUMNS = {
  id: clientConfigVersions.id,
  clientKey: clientConfigVersions.clientKey,
  filePath: clientConfigVersions.filePath,
  contentHash: clientConfigVersions.contentHash,
  sizeBytes: clientConfigVersions.sizeBytes,
  origin: clientConfigVersions.origin,
  note: clientConfigVersions.note,
  createdTime: clientConfigVersions.createdTime,
  content: clientConfigVersions.content,
} as const

/** `SUMMARY_COLUMNS` 选出来的行形状；`origin` 在库里是自由文本，取值时才收窄。 */
interface ClientConfigVersionRow {
  id: string
  clientKey: string
  filePath: string
  contentHash: string
  sizeBytes: number
  origin: string
  note: string
  createdTime: number
  content: string
}

function toSummary(row: ClientConfigVersionRow): ClientConfigVersionSummary {
  return {
    id: row.id,
    clientKey: row.clientKey,
    filePath: row.filePath,
    contentHash: row.contentHash,
    sizeBytes: row.sizeBytes,
    origin: (row.origin as ClientConfigVersionOrigin) ?? 'apply',
    note: row.note,
    createdTime: row.createdTime,
    preview: toPreview(row.content),
  }
}

export interface SaveClientConfigVersionInput {
  clientKey: string
  filePath: string
  content: string
  origin: ClientConfigVersionOrigin
  note?: string
}

/**
 * 存一个版本。
 *
 * 这就是用户要的那条规则：**同一份内容只存一次**。命中 `(clientKey, filePath, contentHash)`
 * 唯一索引时 `onConflictDoNothing` 什么也不写，返回 `null` 表示「本次没有新增版本」；
 * 由此「提交前自动备份」天然是幂等的——用户反复点同一个提交，历史里也只有一条。
 *
 * 返回 `null` 还有一个来源：内容为空。空文件不是「一个版本」，存下来只会让历史列表里
 * 多出一堆看不出区别的空条目。
 */
export function saveClientConfigVersion(input: SaveClientConfigVersionInput): ClientConfigVersionSummary | null {
  if (input.content === '') return null

  const db = getConfigDb()
  const time = now()
  const row = {
    id: generateId('ccv_'),
    clientKey: input.clientKey,
    filePath: input.filePath,
    contentHash: hashClientConfigContent(input.content),
    content: input.content,
    sizeBytes: Buffer.byteLength(input.content, 'utf8'),
    origin: input.origin,
    note: input.note ?? '',
    createdTime: time,
  }

  const inserted = db
    .insert(clientConfigVersions)
    .values(row)
    // 冲突即「这个版本已在库里」——按用户的说法，此时不更新、不新增。
    .onConflictDoNothing()
    .returning(SUMMARY_COLUMNS)
    .all()

  const created = inserted[0]
  return created ? toSummary(created) : null
}

/** 某个文件的历史版本，新的在前。 */
export function listClientConfigVersions(clientKey: string, filePath: string, limit = 100): ClientConfigVersionSummary[] {
  const db = getConfigDb()
  return db
    .select(SUMMARY_COLUMNS)
    .from(clientConfigVersions)
    .where(and(eq(clientConfigVersions.clientKey, clientKey), eq(clientConfigVersions.filePath, filePath)))
    .orderBy(desc(clientConfigVersions.createdTime), desc(clientConfigVersions.id))
    .limit(limit)
    .all()
    .map(toSummary)
}

/** 取一个版本的完整内容（恢复时用）。 */
export function getClientConfigVersion(id: string): ClientConfigVersion | null {
  const db = getConfigDb()
  const row = db.select(SUMMARY_COLUMNS).from(clientConfigVersions).where(eq(clientConfigVersions.id, id)).get()
  if (!row) return null
  return { ...toSummary(row), content: row.content }
}

/** 版本总数，用于展示与「历史被清空了吗」这类判断。 */
export function countClientConfigVersions(clientKey: string, filePath: string): number {
  const db = getConfigDb()
  return db
    .select({ id: clientConfigVersions.id })
    .from(clientConfigVersions)
    .where(and(eq(clientConfigVersions.clientKey, clientKey), eq(clientConfigVersions.filePath, filePath)))
    .all().length
}

export interface ClientConfigVersionSummaryCount {
  count: number
  lastTime: number | null
}

/**
 * 某个客户端**名下所有文件**的版本数与最近一次备份时间。
 *
 * 列表页一行一个客户端，而版本是按文件存的（Gemini CLI 有两个文件），
 * 所以这里按客户端聚合，而不是复用 `countClientConfigVersions` 去数某一个文件。
 */
export function summarizeClientConfigVersions(clientKey: string): ClientConfigVersionSummaryCount {
  const row = getConfigDb()
    .select({ count: sql<number>`count(*)`, lastTime: sql<number | null>`max(${clientConfigVersions.createdTime})` })
    .from(clientConfigVersions)
    .where(eq(clientConfigVersions.clientKey, clientKey))
    .get()
  return { count: row?.count ?? 0, lastTime: row?.lastTime ?? null }
}
