import type { ThemeMode } from '@/lib/theme-mode'
import { createPersistedStore } from './persisted-store'

interface AppUiState {
  themeMode: ThemeMode
  setThemeMode: (mode: ThemeMode) => void
  /**
   * 新用户引导是否已经走完。
   *
   * 存在本地 UI 偏好里（而不是服务端设置）：它描述的是「这台机器上这个人见没见过引导」，
   * 换一台机器重新见一次引导是对的；放进服务端设置反而会跟着同步走。
   * 首页据此决定落在引导页还是智能路由。
   */
  onboardingComplete: boolean
  setOnboardingComplete: (complete: boolean) => void
  /**
   * 侧边栏是否被钉住。
   *
   * 默认不钉：轨道平时只占 48px，鼠标扫过才推开 —— 这是「看一眼就收起」的默认节奏，
   * 不给内容区让位，屏宽不浪费。但有些人就是常驻在某几页之间来回切，
   * 每次都要再 hover 一次才能读全分组标题，这个默认反而成了每步操作都要付一次的手续费，
   * 所以把「钉住」交给用户自己选。
   *
   * 和主题、引导一样存本地：它是「这台机器上这个人怎么看这个界面」，不是服务端事实。
   */
  sidebarPinned: boolean
  setSidebarPinned: (pinned: boolean) => void
  /**
   * 渠道诊断面板是否开着。
   *
   * 面板从「模型管理页里的一个局部弹窗」提成了**外壳级的非模态浮窗**：它挂在 `App`
   * 上、跟着窗口走，所以开关也归外壳的 UI 状态，而不是某一页的 `useState`。
   * 和侧栏一样存本机：它描述的是「这台机器上这个人怎么看这个界面」。
   */
  testPanelOpen: boolean
  setTestPanelOpen: (open: boolean) => void
  /**
   * 面板是否收成了右下角那枚角标。
   *
   * **最小化 ≠ 关闭**：收起来只是少占地方，任务照跑、角标照报进度；关闭（`testPanelOpen`
   * 为假）才会在确认之后取消这一批。
   */
  testPanelMinimized: boolean
  setTestPanelMinimized: (minimized: boolean) => void
}

type PersistedAppUiState = Pick<AppUiState, 'themeMode' | 'onboardingComplete' | 'sidebarPinned' | 'testPanelOpen' | 'testPanelMinimized'>

const appUi = createPersistedStore<AppUiState, PersistedAppUiState>({
  key: 'osw-ui',
  // 这台机器上这个人怎么看这个界面：关掉应用再打开还在，换台机器重新来一遍是对的。
  scope: 'machine',
  create: set => ({
    themeMode: 'system',
    setThemeMode: themeMode => set({ themeMode }),
    onboardingComplete: false,
    setOnboardingComplete: onboardingComplete => set({ onboardingComplete }),
    sidebarPinned: false,
    setSidebarPinned: sidebarPinned => set({ sidebarPinned }),
    testPanelOpen: false,
    setTestPanelOpen: testPanelOpen => set({ testPanelOpen }),
    testPanelMinimized: false,
    setTestPanelMinimized: testPanelMinimized => set({ testPanelMinimized }),
  }),
  pick: state => ({
    themeMode: state.themeMode,
    onboardingComplete: state.onboardingComplete,
    sidebarPinned: state.sidebarPinned,
    testPanelOpen: state.testPanelOpen,
    testPanelMinimized: state.testPanelMinimized,
  }),
  defaults: { themeMode: 'system', onboardingComplete: false, sidebarPinned: false, testPanelOpen: false, testPanelMinimized: false },
})

export const useAppUiStore = appUi.store
