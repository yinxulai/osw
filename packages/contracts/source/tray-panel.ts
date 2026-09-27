/**
 * 托盘面板的主进程与渲染层契约。
 *
 * 这里只描述「主进程已经决定好、渲染层原样展示」的数据：文案在进入面板前已按当前
 * 语言解析，地址也已按代理快照算成客户端应填的 Base URL。渲染层不重复业务判断，
 * 主进程也不需要知道 DOM 里的元素结构。
 */

export type TrayPanelTheme = 'light' | 'dark'

export type TrayPanelEndpointId = 'openai' | 'anthropic'

export interface TrayPanelEndpoint {
  id: TrayPanelEndpointId
  label: string
  url: string
}

export interface TrayPanelLabels {
  subtitle: string
  running: string
  stopped: string
  listeningAddress: string
  ready: string
  unavailable: string
  quickCopy: string
  baseUrl: string
  openApp: string
  footnote: string
  copied: string
  startProxy: string
  stopProxy: string
  quit: string
  opening: string
  actionFailed: string
}

export interface TrayPanelState {
  running: boolean
  address: string
  theme: TrayPanelTheme
  locale: 'zh-CN' | 'en'
  iconUrl: string
  labels: TrayPanelLabels
  endpoints: TrayPanelEndpoint[]
}
