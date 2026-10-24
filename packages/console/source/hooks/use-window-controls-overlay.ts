import { getPlatformCapabilities } from '@/platform/capabilities'
import { hasWindowControlsOverlay } from '@/platform/window-controls'
import { useWindowFullScreen } from './use-window-full-screen'

/**
 * 系统窗口控件是否正压在渲染层的右上角（判定理由见 `@/platform/window-controls`）。
 *
 * 跟着原生全屏状态实时变：进出全屏时系统控件会隐藏 / 归位，预留的那块地要立刻还回去，
 * 所以不能只在挂载时算一次。
 */
export function useWindowControlsOverlay(): boolean {
  const fullScreen = useWindowFullScreen()
  const { name, os } = getPlatformCapabilities()
  return hasWindowControlsOverlay({ platform: name, os, fullScreen })
}
