import { eq } from 'drizzle-orm'
import type { ProviderHealth, ProviderModelHealth } from '@common/schemas'
import { now } from '@common/utils'
import { getDb } from './index'
import { providerHealth, providerModelHealth } from './schema'
import type { ProviderModelHealthRow } from './schema'

export async function getProviderHealth(providerId: string): Promise<ProviderHealth | undefined> {
  const row = getDb()
    .select()
    .from(providerHealth)
    .where(eq(providerHealth.providerId, providerId))
    .get()
  return row ? mapProviderHealth(row) : undefined
}

export async function listProviderHealth(): Promise<ProviderHealth[]> {
  return getDb().select().from(providerHealth).all().map(mapProviderHealth)
}

export async function recordHealthSuccess(providerId: string): Promise<void> {
  const time = now()
  getDb()
    .update(providerHealth)
    .set({ consecutiveFailures: 0, cooldownUntilTime: null, lastSuccessTime: time, updatedTime: time })
    .where(eq(providerHealth.providerId, providerId))
    .run()
}

export async function recordProviderFailure(providerId: string, consecutiveFailureThreshold: number, cooldownBaseSeconds: number, cooldownMaxSeconds: number): Promise<void> {
  const db = getDb()
  const time = now()
  db.transaction(transaction => {
    const current = transaction.select().from(providerHealth).where(eq(providerHealth.providerId, providerId)).get()
    const consecutiveFailures = (current?.consecutiveFailures ?? 0) + 1
    transaction.update(providerHealth).set({
      consecutiveFailures,
      cooldownUntilTime: calculateCooldownUntil(consecutiveFailures, consecutiveFailureThreshold, cooldownBaseSeconds, cooldownMaxSeconds, time),
      lastFailureTime: time,
      updatedTime: time,
    }).where(eq(providerHealth.providerId, providerId)).run()
  })
}

export async function resetProviderHealth(providerId: string): Promise<void> {
  const time = now()
  getDb()
    .update(providerHealth)
    .set({ consecutiveFailures: 0, cooldownUntilTime: null, lastSuccessTime: null, lastFailureTime: null, updatedTime: time })
    .where(eq(providerHealth.providerId, providerId))
    .run()
}

export async function getProviderModelHealth(providerModelId: string): Promise<ProviderModelHealthRow | undefined> {
  return getDb().select().from(providerModelHealth).where(eq(providerModelHealth.providerModelId, providerModelId)).get()
}

export async function listProviderModelHealth(): Promise<ProviderModelHealth[]> {
  return getDb().select().from(providerModelHealth).all().map(row => ({
    providerModelId: row.providerModelId,
    consecutiveFailures: row.consecutiveFailures,
    cooldownUntilTime: row.cooldownUntilTime === null ? null : Number(row.cooldownUntilTime),
    lastSuccessTime: row.lastSuccessTime === null ? null : Number(row.lastSuccessTime),
    lastFailureTime: row.lastFailureTime === null ? null : Number(row.lastFailureTime),
    updatedTime: Number(row.updatedTime),
  }))
}

export async function recordProviderModelHealthSuccess(providerModelId: string): Promise<void> {
  const time = now()
  getDb()
    .update(providerModelHealth)
    .set({ consecutiveFailures: 0, cooldownUntilTime: null, lastSuccessTime: time, updatedTime: time })
    .where(eq(providerModelHealth.providerModelId, providerModelId))
    .run()
}

export async function recordProviderModelFailure(providerModelId: string, consecutiveFailureThreshold: number, cooldownBaseSeconds: number, cooldownMaxSeconds: number): Promise<void> {
  const db = getDb()
  const time = now()
  db.transaction(transaction => {
    const current = transaction.select().from(providerModelHealth).where(eq(providerModelHealth.providerModelId, providerModelId)).get()
    const consecutiveFailures = (current?.consecutiveFailures ?? 0) + 1
    transaction.update(providerModelHealth).set({
      consecutiveFailures,
      cooldownUntilTime: calculateCooldownUntil(consecutiveFailures, consecutiveFailureThreshold, cooldownBaseSeconds, cooldownMaxSeconds, time),
      lastFailureTime: time,
      updatedTime: time,
    }).where(eq(providerModelHealth.providerModelId, providerModelId)).run()
  })
}

export async function resetProviderModelHealth(providerModelId: string): Promise<void> {
  const time = now()
  getDb()
    .update(providerModelHealth)
    .set({ consecutiveFailures: 0, cooldownUntilTime: null, lastSuccessTime: null, lastFailureTime: null, updatedTime: time })
    .where(eq(providerModelHealth.providerModelId, providerModelId))
    .run()
}

function calculateCooldownUntil(consecutiveFailures: number, threshold: number, baseSeconds: number, maxSeconds: number, time: number): number | null {
  if (consecutiveFailures < threshold) return null
  const exponent = consecutiveFailures - threshold
  const seconds = Math.min(baseSeconds * Math.pow(2, exponent), maxSeconds)
  return time + seconds * 1000
}

function mapProviderHealth(row: typeof providerHealth.$inferSelect): ProviderHealth {
  return {
    providerId: row.providerId,
    consecutiveFailures: row.consecutiveFailures,
    cooldownUntilTime: row.cooldownUntilTime === null ? null : Number(row.cooldownUntilTime),
    lastSuccessTime: row.lastSuccessTime === null ? null : Number(row.lastSuccessTime),
    lastFailureTime: row.lastFailureTime === null ? null : Number(row.lastFailureTime),
    updatedTime: Number(row.updatedTime),
  }
}
