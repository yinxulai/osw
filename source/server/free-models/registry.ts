import type { FreeModelSource } from './types'
import { openRouterFreeSource } from './sources/openrouter'

/**
 * 免费模型源注册表。
 * 新增渠道源时只需：实现一个 FreeModelSource 并加入此数组，
 * 同步引擎、调度器、管理 API 与 UI 会自动识别。
 */
const FREE_MODEL_SOURCES: FreeModelSource[] = [
  openRouterFreeSource,
]

const FREE_MODEL_SOURCES_BY_KEY = new Map<string, FreeModelSource>(
  FREE_MODEL_SOURCES.map(source => [source.key, source]),
)

export function listFreeModelSources(): FreeModelSource[] {
  return FREE_MODEL_SOURCES
}

export function getFreeModelSource(key: string): FreeModelSource | undefined {
  return FREE_MODEL_SOURCES_BY_KEY.get(key)
}
