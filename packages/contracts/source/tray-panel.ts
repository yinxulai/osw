import type { Protocol } from './schemas'

/**
 * 托盘面板的主进程与渲染层契约。
 *
 * 这里只描述「主进程已经决定好、渲染层原样展示」的数据：文案在进入面板前已按当前
 * 语言解析，渲染层不重复业务判断，主进程也不需要知道 DOM 里的元素结构。
 */

export type TrayPanelTheme = 'light' | 'dark'

export interface TrayProviderModelSummary {
  id: string
  providerId: string
  providerName: string
  modelName: string
  protocols: Protocol[]
  conversionProtocols: Protocol[]
  enabled: boolean
  modelEnabled: boolean
  cooling: boolean
  avgTps: number | null
  avgTtftMilliseconds: number | null
}

/**
 * 托盘面板只需要展示逻辑模型的摘要，不携带完整调度配置。
 *
 * 面板宽度有限，只保留逻辑模型切换与模型行展示所需字段；完整端点、权重和调度
 * 配置仍归控制台，避免把业务详情复制进托盘。
 */
export interface TrayLogicalModelSummary {
  id: string
  name: string
  models: TrayProviderModelSummary[]
}

export interface TrayProviderModelView extends Omit<TrayProviderModelSummary, 'avgTps' | 'avgTtftMilliseconds'> {
  tps: string
  ttft: string
}

export interface TrayLogicalModelView extends Omit<TrayLogicalModelSummary, 'models'> {
  models: TrayProviderModelView[]
}

export interface TrayPanelLabels {
  subtitle: string
  running: string
  stopped: string
  openApp: string
  footnote: string
  startProxy: string
  stopProxy: string
  quit: string
  opening: string
  actionFailed: string
  logicalModels: string
  logicalModelsCount: string
  logicalModelsEmpty: string
  logicalModelsEmptyHint: string
  logicalModelTabs: string
  modelConversion: string
  providerModelsEmpty: string
  providerModelsEmptyHint: string
  modelStandby: string
  modelCooling: string
  modelBindingDisabled: string
  modelDisabled: string
  unknownProvider: string
}

export interface TrayPanelState {
  running: boolean
  theme: TrayPanelTheme
  locale: 'zh-CN' | 'en'
  iconUrl: string
  labels: TrayPanelLabels
  protocolNames: Record<Protocol, string>
  logicalModels: TrayLogicalModelView[]
}
