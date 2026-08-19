/**
 * 全局应用状态 store。
 * 持有跨页面共享的数据：代理状态、供应商列表、健康状态、逻辑模型等。
 * 由 services/app-service.ts 统一管理数据获取和轮询。
 */

import { createStore } from './create-store'
import type {
  Provider,
  ProviderHealth,
  LogicalModel,
  ProxyServerStatus,
  Settings,
} from '@common/schemas'

export interface AppState {
  // 健康状态
  health: Record<string, ProviderHealth>
  healthLoading: boolean

  // 代理生命周期
  proxyStatus: ProxyServerStatus | null
  proxyStatusLoading: boolean

  // 供应商
  providers: Provider[]
  providersLoading: boolean

  // 设置
  settings: Settings | null
  settingsLoading: boolean

  // 逻辑模型
  logicalModels: LogicalModel[]
  logicalModelsLoading: boolean

  // 全局错误
  lastError: string | null
}

const initialState: AppState = {
  proxyStatus: null,
  proxyStatusLoading: false,
  providers: [],
  providersLoading: false,
  health: {},
  healthLoading: false,
  logicalModels: [],
  logicalModelsLoading: false,
  settings: null,
  settingsLoading: false,
  lastError: null,
}

export const appStore = createStore<AppState>(initialState)
