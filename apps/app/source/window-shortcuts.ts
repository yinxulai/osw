export type WindowAction =
  | 'minimize'
  | 'close'
  | 'quit'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'reload'
  | 'forceReload'
  | 'resetZoom'
  | 'zoomIn'
  | 'zoomOut'
  | 'toggleFullScreen'
  | 'toggleDevTools'

export interface WindowShortcutInput {
  key: string
  meta: boolean
  control: boolean
  shift: boolean
  alt: boolean
}

/**
 * 系统菜单被移除后，快捷键不能再依赖 Electron 的 role。
 *
 * 这里只负责把按键组合映射成动作，真正执行仍集中在 `window-actions.ts`；
 * 纯函数形式便于把跨平台差异完整覆盖在单测里。
 */
export function resolveWindowShortcut(input: WindowShortcutInput, platform: NodeJS.Platform): WindowAction | null {
  const key = input.key.toLowerCase()
  const primary = platform === 'darwin' ? input.meta : input.control

  if (platform !== 'darwin' && key === 'f11') return 'toggleFullScreen'
  if (!primary) return null

  if (platform === 'darwin' && input.control && key === 'f') return 'toggleFullScreen'

  if (platform === 'darwin' && input.alt && key === 'i') return 'toggleDevTools'
  if (platform !== 'darwin' && input.shift && key === 'i') return 'toggleDevTools'

  if (input.shift && key === 'r') return 'forceReload'
  if (!input.alt && key === 'r') return 'reload'
  if (!input.alt && key === 'q') return 'quit'
  if (!input.alt && key === 'm') return 'minimize'
  if (!input.alt && key === 'w') return 'close'
  if (!input.alt && key === 'a') return 'selectAll'
  if (!input.alt && key === 'x') return 'cut'
  if (!input.alt && key === 'c') return 'copy'
  if (!input.alt && key === 'v') return 'paste'
  if (!input.alt && key === 'z') return input.shift ? 'redo' : 'undo'
  if (!input.alt && platform !== 'darwin' && key === 'y') return 'redo'
  if (!input.alt && (key === '=' || key === '+')) return 'zoomIn'
  if (!input.alt && key === '-') return 'zoomOut'
  if (!input.alt && key === '0') return 'resetZoom'

  return null
}
