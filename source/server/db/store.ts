import { getDb } from './index'
import type {
  Provider,
  LogicalModel,
  ModelBinding,
  ProviderHealth,
  Settings,
  RequestLog,
  RequestAttempt,
  RequestStatus,
} from '@common/schemas'
import { generateId, now } from '@common/utils'

// ========== Provider ==========

export function listProviders(includeDeleted = false): Provider[] {
  const db = getDb()
  const sql = includeDeleted
    ? 'SELECT * FROM providers ORDER BY createdTime DESC'
    : 'SELECT * FROM providers WHERE deletedTime IS NULL ORDER BY createdTime DESC'
  return db.prepare(sql).all() as Provider[]
}

export function getProvider(id: string): Provider | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as Provider | undefined
}

export function createProvider(input: Omit<Provider, 'id' | 'createdTime' | 'updatedTime' | 'deletedTime'>): Provider {
  const db = getDb()
  const id = generateId('prov_')
  const time = now()
  const provider: Provider = { ...input, id, createdTime: time, updatedTime: time, deletedTime: null }
  db.prepare(`
    INSERT INTO providers (id, name, apiKeyReference, timeoutMilliseconds, enabled, createdTime, updatedTime, deletedTime)
    VALUES (@id, @name, @apiKeyReference, @timeoutMilliseconds, @enabled, @createdTime, @updatedTime, @deletedTime)
  `).run(provider)
  // 同步创建 health 记录
  db.prepare(`
    INSERT INTO provider_health (providerId, consecutiveFailures, cooldownUntilTime, lastSuccessTime, lastFailureTime, updatedTime)
    VALUES (?, 0, NULL, NULL, NULL, ?)
  `).run(id, time)
  return provider
}

export function updateProvider(id: string, updates: Partial<Omit<Provider, 'id' | 'createdTime'>>): Provider {
  const db = getDb()
  const current = getProvider(id)
  if (!current) throw new Error(`Provider ${id} not found`)
  const updated = { ...current, ...updates, updatedTime: now() }
  const fields = Object.keys(updates).filter(k => k !== 'id' && k !== 'createdTime')
  const setClause = fields.map(k => `${k} = @${k}`).join(', ')
  db.prepare(`UPDATE providers SET ${setClause}, updatedTime = @updatedTime WHERE id = @id`).run({ ...updated, id })
  return updated
}

export function deleteProvider(id: string): void {
  const db = getDb()
  db.prepare('UPDATE providers SET deletedTime = ?, updatedTime = ? WHERE id = ? AND deletedTime IS NULL').run(
    now(),
    now(),
    id,
  )
}

// ========== Logical Model ==========

export function listLogicalModels(includeDeleted = false): LogicalModel[] {
  const db = getDb()
  const sql = includeDeleted
    ? 'SELECT * FROM logical_models ORDER BY createdTime DESC'
    : 'SELECT * FROM logical_models WHERE deletedTime IS NULL ORDER BY createdTime DESC'
  return db.prepare(sql).all() as LogicalModel[]
}

export function getLogicalModel(id: string): LogicalModel | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM logical_models WHERE id = ?').get(id) as LogicalModel | undefined
}

export function createLogicalModel(
  input: Omit<LogicalModel, 'id' | 'createdTime' | 'updatedTime' | 'deletedTime'>,
): LogicalModel {
  const db = getDb()
  const id = generateId('model_')
  const time = now()
  const model: LogicalModel = { ...input, id, createdTime: time, updatedTime: time, deletedTime: null }
  db.prepare(`
    INSERT INTO logical_models (id, name, description, enabled, createdTime, updatedTime, deletedTime)
    VALUES (@id, @name, @description, @enabled, @createdTime, @updatedTime, @deletedTime)
  `).run(model)
  return model
}

export function updateLogicalModel(
  id: string,
  updates: Partial<Omit<LogicalModel, 'id' | 'createdTime'>>,
): LogicalModel {
  const db = getDb()
  const current = getLogicalModel(id)
  if (!current) throw new Error(`LogicalModel ${id} not found`)
  const updated = { ...current, ...updates, updatedTime: now() }
  const fields = Object.keys(updates).filter(k => k !== 'id' && k !== 'createdTime')
  const setClause = fields.map(k => `${k} = @${k}`).join(', ')
  db.prepare(`UPDATE logical_models SET ${setClause}, updatedTime = @updatedTime WHERE id = @id`).run({ ...updated, id })
  return updated
}

export function deleteLogicalModel(id: string): void {
  const db = getDb()
  db.prepare(
    'UPDATE logical_models SET deletedTime = ?, updatedTime = ? WHERE id = ? AND deletedTime IS NULL',
  ).run(now(), now(), id)
  // 同步软删除关联的 bindings
  db.prepare(
    'UPDATE model_bindings SET deletedTime = ?, updatedTime = ? WHERE logicalModelId = ? AND deletedTime IS NULL',
  ).run(now(), now(), id)
}

// ========== Model Binding ==========

export function listBindingsByModel(logicalModelId: string, includeDeleted = false): ModelBinding[] {
  const db = getDb()
  const sql = includeDeleted
    ? 'SELECT * FROM model_bindings WHERE logicalModelId = ? ORDER BY priority ASC'
    : 'SELECT * FROM model_bindings WHERE logicalModelId = ? AND deletedTime IS NULL ORDER BY priority ASC'
  return db.prepare(sql).all(logicalModelId) as ModelBinding[]
}

export function listBindingsByProvider(providerId: string, includeDeleted = false): ModelBinding[] {
  const db = getDb()
  const sql = includeDeleted
    ? 'SELECT * FROM model_bindings WHERE providerId = ? ORDER BY priority ASC'
    : 'SELECT * FROM model_bindings WHERE providerId = ? AND deletedTime IS NULL ORDER BY priority ASC'
  return db.prepare(sql).all(providerId) as ModelBinding[]
}

export function getBinding(id: string): ModelBinding | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM model_bindings WHERE id = ?').get(id) as ModelBinding | undefined
}

export function createBinding(
  input: Omit<ModelBinding, 'id' | 'createdTime' | 'updatedTime' | 'deletedTime'>,
): ModelBinding {
  const db = getDb()
  const id = generateId('bind_')
  const time = now()
  const binding: ModelBinding = { ...input, id, createdTime: time, updatedTime: time, deletedTime: null }
  db.prepare(`
    INSERT INTO model_bindings (id, logicalModelId, providerId, protocol, upstreamUrl, upstreamModelId, priority, enabled, customAuthHeader, createdTime, updatedTime, deletedTime)
    VALUES (@id, @logicalModelId, @providerId, @protocol, @upstreamUrl, @upstreamModelId, @priority, @enabled, @customAuthHeader, @createdTime, @updatedTime, @deletedTime)
  `).run(binding)
  return binding
}

export function updateBinding(
  id: string,
  updates: Partial<Omit<ModelBinding, 'id' | 'createdTime'>>,
): ModelBinding {
  const db = getDb()
  const current = getBinding(id)
  if (!current) throw new Error(`Binding ${id} not found`)
  const updated = { ...current, ...updates, updatedTime: now() }
  const fields = Object.keys(updates).filter(k => k !== 'id' && k !== 'createdTime')
  const setClause = fields.map(k => `${k} = @${k}`).join(', ')
  db.prepare(`UPDATE model_bindings SET ${setClause}, updatedTime = @updatedTime WHERE id = @id`).run({ ...updated, id })
  return updated
}

export function deleteBinding(id: string): void {
  const db = getDb()
  db.prepare('UPDATE model_bindings SET deletedTime = ?, updatedTime = ? WHERE id = ? AND deletedTime IS NULL').run(
    now(),
    now(),
    id,
  )
}

// ========== Provider Health ==========

export function getProviderHealth(providerId: string): ProviderHealth | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM provider_health WHERE providerId = ?').get(providerId) as
    | ProviderHealth
    | undefined
}

export function listProviderHealth(): ProviderHealth[] {
  const db = getDb()
  return db.prepare('SELECT * FROM provider_health').all() as ProviderHealth[]
}

export function recordHealthSuccess(providerId: string): void {
  const db = getDb()
  const time = now()
  db.prepare(`
    UPDATE provider_health
    SET consecutiveFailures = 0, cooldownUntilTime = NULL, lastSuccessTime = ?, updatedTime = ?
    WHERE providerId = ?
  `).run(time, time, providerId)
}

export function recordHealthFailure(providerId: string, cooldownUntil: number | null): void {
  const db = getDb()
  const time = now()
  db.prepare(`
    UPDATE provider_health
    SET consecutiveFailures = consecutiveFailures + 1,
        cooldownUntilTime = ?,
        lastFailureTime = ?,
        updatedTime = ?
    WHERE providerId = ?
  `).run(cooldownUntil, time, time, providerId)
}

export function resetProviderHealth(providerId: string): void {
  const db = getDb()
  db.prepare(`
    UPDATE provider_health
    SET consecutiveFailures = 0, cooldownUntilTime = NULL, lastSuccessTime = NULL, lastFailureTime = NULL, updatedTime = ?
    WHERE providerId = ?
  `).run(now(), providerId)
}

// ========== Settings ==========

const SETTINGS_ID = 'singleton'

export function getSettings(): Settings {
  const db = getDb()
  let settings = db.prepare('SELECT * FROM settings WHERE id = ?').get(SETTINGS_ID) as Settings | undefined
  if (!settings) {
    const time = now()
    settings = {
      id: SETTINGS_ID,
      listenHost: '127.0.0.1',
      listenPort: 9300,
      accessTokenReference: null,
      logRetentionCount: 1000,
      cooldownBaseSeconds: 30,
      cooldownMaxSeconds: 300,
      consecutiveFailureThreshold: 3,
      idleTimeoutMilliseconds: 30000,
      updatedTime: time,
    }
    db.prepare(`
      INSERT INTO settings (id, listenHost, listenPort, accessTokenReference, logRetentionCount,
        cooldownBaseSeconds, cooldownMaxSeconds, consecutiveFailureThreshold, idleTimeoutMilliseconds, updatedTime)
      VALUES (@id, @listenHost, @listenPort, @accessTokenReference, @logRetentionCount,
        @cooldownBaseSeconds, @cooldownMaxSeconds, @consecutiveFailureThreshold, @idleTimeoutMilliseconds, @updatedTime)
    `).run(settings)
  }
  return settings
}

export function updateSettings(updates: Partial<Omit<Settings, 'id' | 'updatedTime'>>): Settings {
  const db = getDb()
  const current = getSettings()
  const updated = { ...current, ...updates, updatedTime: now() }
  const fields = Object.keys(updates).filter(k => k !== 'id')
  const setClause = fields.map(k => `${k} = @${k}`).join(', ')
  db.prepare(`UPDATE settings SET ${setClause}, updatedTime = @updatedTime WHERE id = @id`).run({
    ...updated,
    id: SETTINGS_ID,
  })
  return updated
}

// ========== Request Log ==========

export function createRequestLog(
  input: Omit<RequestLog, 'id' | 'createdTime'>,
): RequestLog {
  const db = getDb()
  const id = generateId('req_')
  const time = now()
  const log: RequestLog = { ...input, id, createdTime: time }
  db.prepare(`
    INSERT INTO request_logs (id, logicalModelId, protocol, status, totalDurationMilliseconds, totalTokens, createdTime)
    VALUES (@id, @logicalModelId, @protocol, @status, @totalDurationMilliseconds, @totalTokens, @createdTime)
  `).run(log)
  return log
}

export function updateRequestLogStatus(
  id: string,
  status: RequestStatus,
  totalDurationMilliseconds: number,
  totalTokens: number | null = null,
): void {
  const db = getDb()
  db.prepare(`
    UPDATE request_logs
    SET status = ?, totalDurationMilliseconds = ?, totalTokens = ?
    WHERE id = ?
  `).run(status, totalDurationMilliseconds, totalTokens, id)
}

export function listRequestLogs(limit = 50): RequestLog[] {
  const db = getDb()
  return db.prepare('SELECT * FROM request_logs ORDER BY createdTime DESC LIMIT ?').all(limit) as RequestLog[]
}

export function createRequestAttempt(
  input: Omit<RequestAttempt, 'id' | 'createdTime'>,
): RequestAttempt {
  const db = getDb()
  const id = generateId('att_')
  const time = now()
  const attempt: RequestAttempt = { ...input, id, createdTime: time }
  db.prepare(`
    INSERT INTO request_attempts (id, requestId, providerId, bindingId, upstreamModelId, attemptIndex, status, errorCode, errorMessage, durationMilliseconds, createdTime)
    VALUES (@id, @requestId, @providerId, @bindingId, @upstreamModelId, @attemptIndex, @status, @errorCode, @errorMessage, @durationMilliseconds, @createdTime)
  `).run(attempt)
  return attempt
}

export function listAttemptsByRequest(requestId: string): RequestAttempt[] {
  const db = getDb()
  return db.prepare('SELECT * FROM request_attempts WHERE requestId = ? ORDER BY attemptIndex ASC').all(requestId) as RequestAttempt[]
}
