import { join } from 'node:path'

/**
 * 插件目录的宿主注入点。
 *
 * core 不能自己算出数据目录在哪（那是宿主的知识，见 `RuntimeConfig.pluginsDirectory`），
 * 而插件的每个入口都要用到这个路径。收成一个模块级变量 + 两个函数，
 * 比让每个调用方（路由、同步引擎、安装器）各自带一个 `pluginsDirectory` 参数简单得多，
 * 也不会出现「路由用了 A 目录、同步引擎用了 B 目录」这种只表现为「装的插件同步不了」的分裂。
 *
 * 与 `secret-store.ts` / `config-read-cache.ts` 同一套做法：宿主启动时 `configure`，
 * 停止时清掉。
 */
let pluginsDirectory: string | null = null

export function configurePluginDirectory(directory: string | null): void {
  pluginsDirectory = directory
}

/** 取插件目录；传 `key` 时直接给出该插件目录的绝对路径。未配置就报错（不兜默认路径）。 */
export function getPluginDirectory(key?: string): string {
  if (!pluginsDirectory) throw new Error('Plugins directory is not configured')
  return key === undefined ? pluginsDirectory : join(pluginsDirectory, key)
}
