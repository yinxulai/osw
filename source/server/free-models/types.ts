import type { Protocol } from '@common/schemas'

/**
 * 免费模型源拉取模型时的上下文。
 * 不同源的鉴权方式不同，但统一通过 apiKey 传入（无需鉴权的源可忽略）。
 */
export interface FreeModelFetchContext {
  /** 渠道保存的 API Key（可能为 null，例如无需鉴权的免费源） */
  apiKey: string | null
  /** 超时时间（毫秒），复用渠道的超时配置 */
  timeoutMilliseconds: number
  /** 中止信号 */
  signal?: AbortSignal
}

/** 免费模型条目：id 为转发时替换 model 字段使用的模型 ID */
export interface FreeModelListing {
  id: string
  /** 上游展示名（可选，仅用于展示） */
  name?: string
}

/**
 * 免费模型源定义。
 *
 * 通用架构中，每个渠道源（OpenRouter 免费、未来的其他免费渠道）只需实现
 * `fetchFreeModels` 这一个差异点；渠道的创建、端点配置、模型 diff 同步、
 * 调度策略、后台定时刷新等行为全部由通用引擎复用。
 */
export interface FreeModelSource {
  /** 唯一标识，如 `openrouter-free` */
  key: string
  /** 展示名称，如 `OpenRouter 免费模型` */
  name: string
  /** 一句话描述，展示在 UI 中 */
  description: string
  /** 对应 source/providers 中的预设 key，用于品牌图标与颜色 */
  presetKey: string
  /** 自动创建出的渠道名称 */
  providerName: string
  /** 是否需要 API Key（某些免费源不填 key 也可用，但限额更低） */
  requiresApiKey: boolean
  /** API Key 输入框占位提示 */
  apiKeyPlaceholder?: string
  /** API Key 获取说明（可选） */
  apiKeyHelpText?: string
  /** 渠道各协议的默认端点 */
  endpoints: Partial<Record<Protocol, string>>
  /**
   * 拉取当前免费模型列表 —— 各个源唯一需要实现的差异点。
   * 抛出错误表示拉取失败，错误信息会记录到同步状态。
   */
  fetchFreeModels(context: FreeModelFetchContext): Promise<FreeModelListing[]>
}

/** 单次同步结果摘要 */
export interface FreeModelSyncResult {
  providerId: string
  /** 本次新增的模型数 */
  added: number
  /** 本次移除（上游已不再免费）的模型数 */
  removed: number
  /** 同步后渠道内免费模型总数 */
  total: number
}

/** 持久化在 providerSettings 中的最近一次同步状态 */
export interface FreeModelSyncState {
  time: number
  status: 'success' | 'error'
  error: string | null
  added: number
  removed: number
  total: number
}
