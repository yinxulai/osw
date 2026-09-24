import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { create } from 'zustand'

import { settingsApi } from '@/api/runtime'
import { unwrap } from '@/api/unwrap'
import { useToast } from '@/components/ui/toast'
import { settingsKeys, useSettings, useSettingsLoading } from '@/data/settings'
import { useTranslation } from '@/i18n/provider'
import type { RouteMode, Settings } from '@common/schemas'

interface RouteModeUiState {
  /** 全局的模式弹窗是否展开。 */
  dialogOpen: boolean
  /** 正在把新模式写回 `settings.routeMode`。 */
  switching: boolean
  setDialogOpen: (open: boolean) => void
  setSwitching: (switching: boolean) => void
}

/**
 * 模式弹窗与「切换中」放在模块级 store 里，而不是某个页面的 state 里。
 *
 * 因为触发它的按钮长在页头、弹窗挂在 `App` 上，两者不在同一棵子树里，props 传不过去；
 * 而这两件事又各自只有一个答案 —— 同一时刻只该有一个弹窗、只该有一次切换，
 * 「谁都能打开同一个弹窗」本来就是这个控件的语义。
 */
export const useRouteModeStore = create<RouteModeUiState>()(set => ({
  dialogOpen: false,
  switching: false,
  setDialogOpen: dialogOpen => set({ dialogOpen }),
  setSwitching: switching => set({ switching }),
}))

/** 打开全局的路由模式弹窗。任何位置都能调用，不依赖组件树，也不需要包一层 Provider。 */
export function openRouteModeDialog(): void {
  useRouteModeStore.setState({ dialogOpen: true })
}

export interface RouteModeState {
  /** 当前生效的模式。设置到达之前按工作流模式渲染,它是既有行为,不会闪错。 */
  mode: RouteMode
  loading: boolean
  switching: boolean
  /** 切换模式。返回是否真的切过去了 —— 调用方（弹窗）据此决定要不要收起。 */
  switchMode: (mode: RouteMode) => Promise<boolean>
}

/**
 * 当前生效的路由模式。
 *
 * 模式存在全局设置里(`settings.routeMode`),而不是页面自己的状态里:
 * 它决定代理**执行哪一份定义**,是一条服务端事实,页面只是它的读数。
 * 「同一时刻只有一种生效」因此不需要任何同步逻辑 —— 只有一个地方在回答这个问题。
 */
export function useRouteMode(): RouteModeState {
  const client = useQueryClient()
  const settings = useSettings()
  const loading = useSettingsLoading()
  const toast = useToast()
  const t = useTranslation()
  const switching = useRouteModeStore(state => state.switching)
  const setSwitching = useRouteModeStore(state => state.setSwitching)

  /** 设置里的 `routeMode` 由 schema 兜底(默认 `workflow`),读到的永远是一个合法模式。 */
  const mode = settings?.routeMode ?? 'workflow'

  /**
   * 切换模式。
   *
   * 切换**只改这一项设置**,不会去碰另一份定义 —— 两份定义各自独立存在,切过去再切回来必须还是原样。
   * 写回缓存而不是让页面各自去重新拉取:两个工作台读的是同一份设置缓存,这里就是它们唯一的状态来源。
   *
   * 「切换中」按当下的 store 值判断而不是闭包里的 `switching`：这样这个函数不必跟着它重建，
   * 页头和弹窗拿到的是同一个身份的 `switchMode`，谁调都拦得住并发的第二次。
   */
  const switchMode = useCallback(async (next: RouteMode): Promise<boolean> => {
    if (next === mode) return true
    if (useRouteModeStore.getState().switching) return false
    setSwitching(true)
    try {
      const updated = await unwrap(settingsApi.update({ routeMode: next }))
      client.setQueryData<Settings>(settingsKeys.all, updated)
      const label = t(next === 'rules' ? 'router.mode.rules' : 'router.mode.workflow')
      toast.success(t('router.mode.toast.switched', { mode: label }))
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('router.mode.error.switchFailed'))
      return false
    } finally {
      setSwitching(false)
    }
  }, [client, mode, setSwitching, t, toast])

  return { mode, loading, switching, switchMode }
}
