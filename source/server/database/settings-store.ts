import { SettingsSchema } from '@common/schemas'
import type { Settings } from '@common/schemas'
import { now } from '@common/utils'
import { getDb } from './index'
import { settings } from './schema'

type SettingsChangeListener = (settings: Settings) => void
const settingsChangeListeners: SettingsChangeListener[] = []

export function onSettingsChanged(listener: SettingsChangeListener): () => void {
  settingsChangeListeners.push(listener)
  return () => {
    const idx = settingsChangeListeners.indexOf(listener)
    if (idx >= 0) settingsChangeListeners.splice(idx, 1)
  }
}

function notifySettingsChanged(newSettings: Settings): void {
  for (const listener of settingsChangeListeners) {
    try {
      listener(newSettings)
    } catch (err) {
      console.error('[store] settings change listener error', err)
    }
  }
}

export interface SettingsDefaults {
  listenPort: number
}

const PRODUCTION_SETTINGS_DEFAULTS: SettingsDefaults = {
  listenPort: 9300,
}

/** SettingsSchema 除 id/updatedTime 外的字段，即需要持久化的键 */
const SETTINGS_KEYS = Object.keys(SettingsSchema.shape).filter(
  key => key !== 'id' && key !== 'updatedTime',
)

function parseStoredValue(key: string, raw: string | undefined): unknown {
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    console.warn(`[store] settings key "${key}" has invalid JSON, ignoring`, raw)
    return undefined
  }
}

export async function getSettings(defaults = PRODUCTION_SETTINGS_DEFAULTS): Promise<Settings> {
  const db = getDb()
  const rows = db.select().from(settings).all()
  const stored = new Map(rows.map(row => [row.key, row.value]))
  const parsed: Record<string, unknown> = {}
  for (const key of SETTINGS_KEYS) {
    const value = parseStoredValue(key, stored.get(key))
    if (value !== undefined) parsed[key] = value
  }
  return SettingsSchema.parse({
    id: 'singleton',
    ...parsed,
    listenPort: parsed.listenPort ?? defaults.listenPort,
    updatedTime: now(),
  })
}

export async function updateSettings(
  updates: Partial<Omit<Settings, 'id' | 'updatedTime'>>,
): Promise<Settings> {
  const db = getDb()
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue
    db.insert(settings)
      .values({ key, value: JSON.stringify(value), valueType: typeof value, updatedTime: now() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: JSON.stringify(value), valueType: typeof value, updatedTime: now() },
      })
      .run()
  }
  const result = await getSettings()
  notifySettingsChanged(result)
  return result
}
