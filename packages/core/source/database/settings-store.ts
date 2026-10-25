import { SettingsSchema } from '@common/schemas'
import type { Settings } from '@common/schemas'
import { now } from '@common/utils'
import { getConfigDb } from './index'
import { settings } from './config-schema'

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
  listenHost: string
  listenPort: number
  /**
   * 管理面是否要求登录。
   *
   * 它不是常量，而是**按这次启动的监听地址算出来的**：管理服务只监听回环时默认关
   * （旧行为，不打扰本机用户），监听非回环地址时默认开（那是「装到服务器上给别人用」
   * 的形态，不设防等于把明文密钥的导出接口挂到公网上）。
   *
   * 算这一步的地方是 `runtime/server-runtime.ts`——它是唯一同时知道
   * 「这次监听在哪儿」和「设置默认值是什么」的位置。宿主不必各自判一遍。
   */
  managementAuthEnabled: boolean
}

let settingsDefaults: SettingsDefaults = {
  listenHost: '127.0.0.1',
  listenPort: 9300,
  managementAuthEnabled: false,
}

/**
 * 配置当前运行环境的设置默认值。默认值只填补数据库中不存在的字段，
 * 已持久化的用户设置始终具有更高优先级。
 *
 * 注意 `managementAuthEnabled` 的默认值**不进数据库**：它是「这次启动的缺省」而不是
 * 「用户的选择」。写进去会把「服务器形态默认开」固化成一个再也不跟随监听地址的值。
 */
export function configureSettingsDefaults(defaults: SettingsDefaults): void {
  settingsDefaults = { ...defaults }
}

/** 当前生效的设置默认值。只读：调用方不该改它，改默认值只能走 `configureSettingsDefaults`。 */
export function getSettingsDefaults(): Readonly<SettingsDefaults> {
  return settingsDefaults
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
    console.warn(`[store] invalid stored JSON ignored key=${key}`)
    return undefined
  }
}

export async function getSettings(): Promise<Settings> {
  const db = getConfigDb()
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
    listenHost: parsed.listenHost ?? settingsDefaults.listenHost,
    listenPort: parsed.listenPort ?? settingsDefaults.listenPort,
    // 只有真的没存过才用启动期的缺省值。存过 `false` 的用户不能被「服务器形态默认开」顶掉。
    managementAuthEnabled: parsed.managementAuthEnabled ?? settingsDefaults.managementAuthEnabled,
    updatedTime: now(),
  })
}

export async function updateSettings(
  updates: Partial<Omit<Settings, 'id' | 'updatedTime'>>,
): Promise<Settings> {
  const db = getConfigDb()
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
