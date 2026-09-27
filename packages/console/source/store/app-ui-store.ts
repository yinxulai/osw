import { create } from 'zustand'
import { persist, type PersistStorage } from 'zustand/middleware'
import type { ThemeMode } from '@/components/app-sidebar'
import { createLocalStorage } from '@/lib/persist-storage'

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
}

type PersistedAppUiState = Pick<AppUiState, 'themeMode' | 'onboardingComplete' | 'sidebarPinned'>

const appUiStorage: PersistStorage<PersistedAppUiState> | undefined = createLocalStorage<PersistedAppUiState>()

export const useAppUiStore = create<AppUiState>()(persist(
  set => ({
    themeMode: 'system',
    setThemeMode: themeMode => set({ themeMode }),
    onboardingComplete: false,
    setOnboardingComplete: onboardingComplete => set({ onboardingComplete }),
    sidebarPinned: false,
    setSidebarPinned: sidebarPinned => set({ sidebarPinned }),
  }),
  {
    name: 'osw-ui',
    storage: appUiStorage,
    partialize: state => ({
      themeMode: state.themeMode,
      onboardingComplete: state.onboardingComplete,
      sidebarPinned: state.sidebarPinned,
    }),
  },
))
